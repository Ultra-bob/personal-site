// Drop-in replacement for tex-linebreak's justifyContent that uses
// canvas-based text measurement instead of DOM measurement.
// Eliminates per-word layout reflows (the main bottleneck).

import { breakLines, forcedBreak, MaxAdjustmentExceededError } from "tex-linebreak";

// ─── Types ───────────────────────────────────────────────────────────────

interface Box { type: "box"; width: number }
interface Glue { type: "glue"; width: number; shrink: number; stretch: number }
interface Penalty { type: "penalty"; width: number; cost: number; flagged: boolean }

interface NodeOffset { node: Node; start: number; end: number }
type DOMBox = Box & NodeOffset;
type DOMGlue = Glue & NodeOffset;
type DOMPenalty = Penalty & NodeOffset;
type DOMItem = DOMBox | DOMGlue | DOMPenalty;

// ─── Canvas-based text measurement (zero layout reflow) ─────────────────

const _canvas = document.createElement("canvas");
const _ctx = _canvas.getContext("2d")!;
const _widthCache = new Map<string, number>();
const _fontMap = new Map<Element, string>();
let _currentFont = "";

function measureCanvas(el: Element, word: string): number {
  let font = _fontMap.get(el);
  if (font === undefined) {
    const s = getComputedStyle(el);
    font = `${s.fontStyle} ${s.fontWeight} ${s.fontSize} ${s.fontFamily}`;
    _fontMap.set(el, font);
  }
  const key = font + "\0" + word;
  const cached = _widthCache.get(key);
  if (cached !== undefined) return cached;
  if (font !== _currentFont) {
    _ctx.font = font;
    _currentFont = font;
  }
  const w = _ctx.measureText(word).width;
  _widthCache.set(key, w);
  return w;
}

// ─── DOM tagging (track nodes we insert) ────────────────────────────────

const NODE_TAG = "insertedByTexLinebreak";

function tagNode(node: Node) {
  (node as any)[NODE_TAG] = true;
}

function isTaggedNode(node: Node) {
  return Object.prototype.hasOwnProperty.call(node, NODE_TAG);
}

function taggedChildren(node: Node): Node[] {
  const result: Node[] = [];
  for (let i = 0; i < node.childNodes.length; i++) {
    const child = node.childNodes[i];
    if (isTaggedNode(child)) result.push(child);
    if (child.childNodes.length > 0) result.push(...taggedChildren(child));
  }
  return result;
}

// ─── DOM utilities ──────────────────────────────────────────────────────

function isTextOrInlineElement(node: Node): boolean {
  if (node instanceof Text) return true;
  if (node instanceof Element) return getComputedStyle(node).display === "inline";
  return false;
}

function textNodesInRange(range: Range, filter: (node: Node) => boolean): Text[] {
  const result: Text[] = [];
  const ancestor = range.commonAncestorContainer;

  function walk(node: Node) {
    if (!range.intersectsNode(node)) return;
    if (node instanceof Text) {
      result.push(node);
    } else if (filter(node)) {
      for (let child = node.firstChild; child; child = child.nextSibling) {
        walk(child);
      }
    }
  }

  if (ancestor instanceof Text) {
    result.push(ancestor);
  } else {
    for (let child = ancestor.firstChild; child; child = child.nextSibling) {
      walk(child);
    }
  }
  return result;
}

function elementLineWidth(el: HTMLElement): number {
  const { width, boxSizing, paddingLeft, paddingRight } = getComputedStyle(el);
  let w = parseFloat(width);
  if (boxSizing === "border-box") {
    w -= parseFloat(paddingLeft) + parseFloat(paddingRight);
  }
  return w;
}

// ─── Item builders ──────────────────────────────────────────────────────

function addItemsForTextNode(
  items: DOMItem[],
  node: Text,
  measureFn: (el: Element, word: string) => number,
  hyphenateFn?: (word: string) => string[],
) {
  const text = node.nodeValue!;
  const el = node.parentNode! as Element;
  const spaceWidth = measureFn(el, " ");
  const shrink = Math.max(0, spaceWidth - 3);
  const hyphenWidth = measureFn(el, "-");
  const chunks = text.split(/(\s+)/).filter((w) => w.length > 0);
  let textOffset = 0;

  for (const w of chunks) {
    if (/\s/.test(w.charAt(0))) {
      items.push({
        type: "glue", width: spaceWidth, shrink, stretch: spaceWidth,
        node, start: textOffset, end: textOffset + w.length,
      });
      textOffset += w.length;
      continue;
    }

    if (hyphenateFn) {
      const syllables = hyphenateFn(w);
      for (let i = 0; i < syllables.length; i++) {
        const c = syllables[i];
        items.push({
          type: "box", width: measureFn(el, c),
          node, start: textOffset, end: textOffset + c.length,
        });
        textOffset += c.length;
        if (i < syllables.length - 1) {
          items.push({
            type: "penalty", width: hyphenWidth, cost: 10, flagged: true,
            node, start: textOffset, end: textOffset,
          });
        }
      }
    } else {
      items.push({
        type: "box", width: measureFn(el, w),
        node, start: textOffset, end: textOffset + w.length,
      });
      textOffset += w.length;
    }
  }
}

function addItemsForElement(
  items: DOMItem[],
  element: Element,
  measureFn: (el: Element, word: string) => number,
  hyphenateFn?: (word: string) => string[],
) {
  const {
    display, width, paddingLeft, paddingRight,
    marginLeft, marginRight, borderLeftWidth, borderRightWidth,
  } = getComputedStyle(element);

  if (display === "inline") {
    const leftMargin =
      parseFloat(marginLeft) + parseFloat(borderLeftWidth) + parseFloat(paddingLeft);
    if (leftMargin > 0) {
      items.push({ type: "box", width: leftMargin, node: element, start: 0, end: 0 });
    }
    addItemsForNode(items, element, measureFn, hyphenateFn, false);
    const rightMargin =
      parseFloat(marginRight) + parseFloat(borderRightWidth) + parseFloat(paddingRight);
    if (rightMargin > 0) {
      const len = element.childNodes.length;
      items.push({ type: "box", width: rightMargin, node: element, start: len, end: len });
    }
  } else {
    items.push({ type: "box", width: parseFloat(width), node: element, start: 0, end: 1 });
  }
}

function addItemsForNode(
  items: DOMItem[],
  node: Node,
  measureFn: (el: Element, word: string) => number,
  hyphenateFn?: (word: string) => string[],
  addParagraphEnd = true,
) {
  for (const child of Array.from(node.childNodes)) {
    if (child instanceof Text) {
      addItemsForTextNode(items, child, measureFn, hyphenateFn);
    } else if (child instanceof Element) {
      addItemsForElement(items, child, measureFn, hyphenateFn);
    }
  }

  if (addParagraphEnd) {
    const end = node.childNodes.length;
    items.push({ type: "glue", width: 0, shrink: 0, stretch: 1000, node, start: end, end });
    items.push({ ...forcedBreak(), node, start: end, end });
  }
}

// ─── Spacing helpers ────────────────────────────────────────────────────

function lineWidthsAndGlueCounts(items: DOMItem[], breakpoints: number[]) {
  const widths: number[] = [];
  const glueCounts: number[] = [];
  for (let b = 0; b < breakpoints.length - 1; b++) {
    let actualWidth = 0;
    let glueCount = 0;
    const start = b === 0 ? breakpoints[b] : breakpoints[b] + 1;
    for (let p = start; p <= breakpoints[b + 1]; p++) {
      const item = items[p];
      if (item.type === "box") {
        actualWidth += item.width;
      } else if (item.type === "glue" && p !== start && p !== breakpoints[b + 1]) {
        actualWidth += item.width;
        ++glueCount;
      } else if (item.type === "penalty" && p === breakpoints[b + 1]) {
        actualWidth += item.width;
      }
    }
    widths.push(actualWidth);
    glueCounts.push(glueCount);
  }
  return [widths, glueCounts] as const;
}

function addWordSpacing(r: Range, wordSpacing: number): Text[] {
  const texts = textNodesInRange(r, isTextOrInlineElement);
  for (const t of texts) {
    const wrapper = document.createElement("span");
    tagNode(wrapper);
    wrapper.style.wordSpacing = `${wordSpacing}px`;
    t.parentNode!.replaceChild(wrapper, t);
    wrapper.appendChild(t);
  }
  return texts;
}

// ─── Public API ─────────────────────────────────────────────────────────

export function unjustifyContent(el: HTMLElement) {
  const tagged = taggedChildren(el);
  for (const node of tagged) {
    const parent = node.parentNode!;
    for (const child of Array.from(node.childNodes)) {
      parent.insertBefore(child, node);
    }
    parent.removeChild(node);
  }
  el.normalize();
}

interface ElementBreakpoints {
  el: HTMLElement;
  items: DOMItem[];
  breakpoints: number[];
  lineWidth: number;
}

export function justifyContent(
  elements: HTMLElement | HTMLElement[],
  hyphenateFn?: (word: string) => string[],
) {
  if (!Array.isArray(elements)) elements = [elements];

  // Undo previous justification
  for (const el of elements) unjustifyContent(el);

  // Clear per-element font cache (styles may have changed)
  _fontMap.clear();

  // ── Read phase: measure + compute breakpoints (no DOM writes) ──
  const elementBreaks: ElementBreakpoints[] = [];

  for (const el of elements) {
    const lineWidth = elementLineWidth(el);
    let items: DOMItem[] = [];
    addItemsForNode(items, el, measureCanvas);

    let breakpoints: number[];
    try {
      breakpoints = breakLines(items, lineWidth, { maxAdjustmentRatio: 2.0 });
    } catch (e) {
      if (e instanceof MaxAdjustmentExceededError) {
        items = [];
        addItemsForNode(items, el, measureCanvas, hyphenateFn);
        breakpoints = breakLines(items, lineWidth);
      } else {
        throw e;
      }
    }
    elementBreaks.push({ el, items, breakpoints, lineWidth });
  }

  // ── Write phase: apply breaks and spacing ──
  for (const { el, items, breakpoints, lineWidth } of elementBreaks) {
    const [actualWidths, glueCounts] = lineWidthsAndGlueCounts(items, breakpoints);

    const endsWithHyphen: boolean[] = [];
    const lineRanges: Range[] = [];
    for (let b = 1; b < breakpoints.length; b++) {
      const prevBreakItem = items[breakpoints[b - 1]];
      const breakItem = items[breakpoints[b]];
      const r = document.createRange();
      if (b > 1) r.setStart(prevBreakItem.node, prevBreakItem.end);
      else r.setStart(el, 0);
      r.setEnd(breakItem.node, breakItem.start);
      lineRanges.push(r);
      endsWithHyphen.push(breakItem.type === "penalty" && breakItem.flagged);
    }

    el.style.whiteSpace = "nowrap";

    lineRanges.forEach((r, i) => {
      if (i === 0) return;
      const brEl = document.createElement("br");
      tagNode(brEl);
      r.insertNode(brEl);
      r.setStart(brEl.nextSibling!, 0);
    });

    lineRanges.forEach((r, i) => {
      const spaceDiff = lineWidth - actualWidths[i];
      const extraSpacePerGlue = spaceDiff / glueCounts[i];
      const isFinalLine = i === lineRanges.length - 1;
      if (isFinalLine && extraSpacePerGlue >= 0) return;

      const wrappedNodes = addWordSpacing(r, extraSpacePerGlue);
      if (endsWithHyphen[i] && wrappedNodes.length > 0) {
        const lastNode = wrappedNodes[wrappedNodes.length - 1];
        const hyphen = document.createTextNode("-");
        tagNode(hyphen);
        lastNode.parentNode!.appendChild(hyphen);
      }
    });
  }
}