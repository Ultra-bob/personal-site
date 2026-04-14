import {
  prepareWithSegments,
  type LayoutCursor,
  type PreparedTextWithSegments,
} from '@chenglou/pretext'

const SOFT_HYPHEN = '\u00AD'
const INF = 1e15

type PreparedWithRawSegments = PreparedTextWithSegments & {
  segments: readonly string[]
  widths: readonly number[]
}

type BreakKind = 'start' | 'space' | 'soft-hyphen' | 'end'

type BreakCandidate = {
  // Where the next line starts if this break is chosen
  segIndex: number
  // Exclusive visual end of the current line
  lineEndSegIndex: number
  kind: BreakKind
  penalty: number
  flagged: boolean
}

type PrefixSums = {
  wordWidthPrefix: number[]
  spaceWidthPrefix: number[]
  spaceCountPrefix: number[]
}

type KnuthPlassOptions = {
  normalSpaceWidth: number
  hyphenWidth: number

  // glue behavior
  spaceStretch?: number // default 0.5
  spaceShrink?: number // default 0.333

  // demerits
  linePenalty?: number // default 10
  hyphenPenalty?: number // default 50
  fitnessDemerit?: number // default 3000
  flaggedDemerit?: number // default 100

  // try wider feasibility if needed
  tolerances?: number[] // default [1, 2, 3, 5]
}

export type KnuthPlassLine = {
  text: string
  width: number
  start: LayoutCursor
  end: LayoutCursor
  endsWithHyphen: boolean
  spaceCount: number
  isLastLine: boolean
}

type LineMeasure = {
  wordWidth: number
  spaceWidth: number
  spaceCount: number
  naturalWidth: number
  stretch: number
  shrink: number
}

export function measureBreakGlyphs(font: string): {
  normalSpaceWidth: number
  hyphenWidth: number
} {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2D canvas context required')
  ctx.font = font
  return {
    normalSpaceWidth: ctx.measureText(' ').width,
    hyphenWidth: ctx.measureText('-').width,
  }
}

export function layoutKnuthPlass(
  preparedInput: PreparedTextWithSegments,
  maxWidth: number,
  options: KnuthPlassOptions,
): KnuthPlassLine[] {
  const prepared = preparedInput as PreparedWithRawSegments
  const segments = prepared.segments
  const widths = prepared.widths

  if (segments.length === 0) return []

  const opts = {
    spaceStretch: 0.5,
    spaceShrink: 0.333,
    linePenalty: 10,
    hyphenPenalty: 50,
    fitnessDemerit: 3000,
    flaggedDemerit: 100,
    tolerances: [1, 2, 3, 5],
    ...options,
  }

  const candidates = buildBreakCandidates(segments, opts.hyphenPenalty)
  const prefixes = buildPrefixSums(segments, widths)

  let chosenBreaks: number[] | null = null
  for (let i = 0; i < opts.tolerances.length; i++) {
    const tolerance = opts.tolerances[i]!
    chosenBreaks = findOptimalBreaks(
      candidates,
      prefixes,
      maxWidth,
      opts,
      tolerance,
    )
    if (chosenBreaks !== null) break
  }

  if (chosenBreaks === null) {
    // Fallback: very narrow columns / no feasible KP path
    return layoutGreedyFallback(prepared, maxWidth, options.hyphenWidth)
  }

  const lines: KnuthPlassLine[] = []
  let fromCandidate = 0
  for (let i = 0; i < chosenBreaks.length; i++) {
    const toCandidate = chosenBreaks[i]!
    lines.push(buildLine(prepared, candidates, fromCandidate, toCandidate, options.hyphenWidth))
    fromCandidate = toCandidate
  }

  return lines
}

function buildBreakCandidates(
  segments: readonly string[],
  hyphenPenalty: number,
): BreakCandidate[] {
  const candidates: BreakCandidate[] = [
    {
      segIndex: 0,
      lineEndSegIndex: 0,
      kind: 'start',
      penalty: 0,
      flagged: false,
    },
  ]

  for (let i = 0; i < segments.length; i++) {
    const text = segments[i]!

    if (text === SOFT_HYPHEN) {
      candidates.push({
        segIndex: i + 1,
        lineEndSegIndex: i,
        kind: 'soft-hyphen',
        penalty: hyphenPenalty,
        flagged: true,
      })
      continue
    }

    if (isSpaceText(text)) {
      const runStart = i
      let runEnd = i + 1
      while (runEnd < segments.length && isSpaceText(segments[runEnd]!)) {
        runEnd++
      }

      if (runEnd < segments.length) {
        candidates.push({
          segIndex: runEnd,
          lineEndSegIndex: runStart,
          kind: 'space',
          penalty: 0,
          flagged: false,
        })
      }

      i = runEnd - 1
    }
  }

  candidates.push({
    segIndex: segments.length,
    lineEndSegIndex: segments.length,
    kind: 'end',
    penalty: 0,
    flagged: false,
  })

  return candidates
}

function buildPrefixSums(
  segments: readonly string[],
  widths: readonly number[],
): PrefixSums {
  const wordWidthPrefix = new Array(segments.length + 1).fill(0)
  const spaceWidthPrefix = new Array(segments.length + 1).fill(0)
  const spaceCountPrefix = new Array(segments.length + 1).fill(0)

  for (let i = 0; i < segments.length; i++) {
    const text = segments[i]!

    wordWidthPrefix[i + 1] = wordWidthPrefix[i]!
    spaceWidthPrefix[i + 1] = spaceWidthPrefix[i]!
    spaceCountPrefix[i + 1] = spaceCountPrefix[i]!

    if (text === SOFT_HYPHEN) continue

    if (isSpaceText(text)) {
      spaceWidthPrefix[i + 1]! += widths[i]!
      spaceCountPrefix[i + 1]! += 1
    } else {
      wordWidthPrefix[i + 1]! += widths[i]!
    }
  }

  return {
    wordWidthPrefix,
    spaceWidthPrefix,
    spaceCountPrefix,
  }
}

function findOptimalBreaks(
  candidates: readonly BreakCandidate[],
  prefixes: PrefixSums,
  maxWidth: number,
  options: Required<KnuthPlassOptions>,
  tolerance: number,
): number[] | null {
  const n = candidates.length

  // TeX-style fitness classes: 0..3
  const demerits: number[][] = Array.from({ length: n }, () => new Array(4).fill(INF))
  const prevCandidate: number[][] = Array.from({ length: n }, () => new Array(4).fill(-1))
  const prevFitness: number[][] = Array.from({ length: n }, () => new Array(4).fill(-1))

  // Start in "normal" fitness class
  demerits[0]![1] = 0

  for (let from = 0; from < n - 1; from++) {
    for (let fromFitness = 0; fromFitness < 4; fromFitness++) {
      const base = demerits[from]![fromFitness]!
      if (!Number.isFinite(base)) continue

      for (let to = from + 1; to < n; to++) {
        const measure = measureLine(candidates, prefixes, from, to, options)
        if (measure === null) continue
        if (measure.wordWidth === 0 && measure.spaceCount === 0) continue

        const isLastLine = candidates[to]!.kind === 'end'
        const ratio = adjustmentRatio(
          measure,
          maxWidth,
          options.normalSpaceWidth,
          isLastLine,
        )

        const minWidth = measure.naturalWidth - measure.shrink
        if (!isLastLine && minWidth > maxWidth) {
          // Adding more content only makes it worse
          break
        }

        if (ratio === null) continue
        if (!isLastLine && ratio > tolerance) continue

        const badness = isLastLine
          ? 0
          : Math.min(10000, 100 * Math.abs(ratio) ** 3)

        const fitness = fitnessClass(ratio)

        let lineDemerits = (options.linePenalty + badness) ** 2

        const penalty = candidates[to]!.penalty
        if (penalty >= 0) {
          lineDemerits += penalty ** 2
        }

        if (
          from > 0 &&
          candidates[from]!.flagged &&
          candidates[to]!.flagged
        ) {
          lineDemerits += options.flaggedDemerit
        }

        if (from > 0 && Math.abs(fitness - fromFitness) > 1) {
          lineDemerits += options.fitnessDemerit
        }

        const total = base + lineDemerits
        if (total < demerits[to]![fitness]!) {
          demerits[to]![fitness] = total
          prevCandidate[to]![fitness] = from
          prevFitness[to]![fitness] = fromFitness
        }
      }
    }
  }

  const end = n - 1
  let bestFitness = -1
  let best = INF

  for (let f = 0; f < 4; f++) {
    const d = demerits[end]![f]!
    if (d < best) {
      best = d
      bestFitness = f
    }
  }

  if (!Number.isFinite(best) || bestFitness === -1) return null

  const breaks: number[] = []
  let current = end
  let fitness = bestFitness

  while (current > 0) {
    breaks.push(current)
    const prev = prevCandidate[current]![fitness]!
    const prevFit = prevFitness[current]![fitness]!
    if (prev < 0) return null
    current = prev
    fitness = prevFit
  }

  breaks.reverse()
  return breaks
}

function measureLine(
  candidates: readonly BreakCandidate[],
  prefixes: PrefixSums,
  from: number,
  to: number,
  options: Required<KnuthPlassOptions>,
): LineMeasure | null {
  const start = candidates[from]!.segIndex
  const end = candidates[to]!.lineEndSegIndex

  if (end < start) return null

  let wordWidth =
    prefixes.wordWidthPrefix[end]! - prefixes.wordWidthPrefix[start]!
  const spaceWidth =
    prefixes.spaceWidthPrefix[end]! - prefixes.spaceWidthPrefix[start]!
  const spaceCount =
    prefixes.spaceCountPrefix[end]! - prefixes.spaceCountPrefix[start]!

  if (candidates[to]!.kind === 'soft-hyphen') {
    wordWidth += options.hyphenWidth
  }

  const naturalWidth = wordWidth + spaceWidth
  const stretch = spaceWidth * options.spaceStretch
  const shrink = spaceWidth * options.spaceShrink

  return {
    wordWidth,
    spaceWidth,
    spaceCount,
    naturalWidth,
    stretch,
    shrink,
  }
}

function adjustmentRatio(
  measure: LineMeasure,
  maxWidth: number,
  normalSpaceWidth: number,
  isLastLine: boolean,
): number | null {
  if (isLastLine) {
    return measure.naturalWidth <= maxWidth ? 0 : null
  }

  const diff = maxWidth - measure.naturalWidth
  if (diff === 0) return 0

  if (diff > 0) {
    if (measure.stretch > 0) return diff / measure.stretch
    return diff / normalSpaceWidth
  }

  if (measure.shrink <= 0) return null

  const ratio = diff / measure.shrink
  if (ratio < -1) return null
  return ratio
}

function fitnessClass(ratio: number): number {
  if (ratio < -0.5) return 0
  if (ratio <= 0.5) return 1
  if (ratio <= 1) return 2
  return 3
}

function buildLine(
  prepared: PreparedWithRawSegments,
  candidates: readonly BreakCandidate[],
  from: number,
  to: number,
  hyphenWidth: number,
): KnuthPlassLine {
  const startSeg = candidates[from]!.segIndex
  const visualEndSeg = candidates[to]!.lineEndSegIndex
  const nextSeg = candidates[to]!.segIndex
  const endsWithHyphen = candidates[to]!.kind === 'soft-hyphen'

  let text = ''
  let width = 0
  let spaceCount = 0

  for (let i = startSeg; i < visualEndSeg; i++) {
    const seg = prepared.segments[i]!
    if (seg === SOFT_HYPHEN) continue
    text += seg
    width += prepared.widths[i]!
    if (isSpaceText(seg)) spaceCount++
  }

  if (endsWithHyphen) {
    text += '-'
    width += hyphenWidth
  }

  return {
    text,
    width,
    start: { segmentIndex: startSeg, graphemeIndex: 0 },
    end: { segmentIndex: nextSeg, graphemeIndex: 0 },
    endsWithHyphen,
    spaceCount,
    isLastLine: candidates[to]!.kind === 'end',
  }
}

function layoutGreedyFallback(
  prepared: PreparedWithRawSegments,
  maxWidth: number,
  hyphenWidth: number,
): KnuthPlassLine[] {
  const lines: KnuthPlassLine[] = []
  let start = 0

  while (start < prepared.segments.length) {
    let bestBreak = -1
    let bestKind: BreakKind = 'end'
    let width = 0
    let lastBreakWidth = 0

    for (let i = start; i < prepared.segments.length; i++) {
      const seg = prepared.segments[i]!
      const segWidth = prepared.widths[i]!

      if (seg === SOFT_HYPHEN) {
        if (width + hyphenWidth <= maxWidth) {
          bestBreak = i + 1
          bestKind = 'soft-hyphen'
          lastBreakWidth = width + hyphenWidth
        }
        continue
      }

      width += segWidth

      if (isSpaceText(seg)) {
        bestBreak = i + 1
        bestKind = 'space'
        lastBreakWidth = width - segWidth
      }

      if (width > maxWidth) break
    }

    if (bestBreak === -1) {
      // emergency break at next segment
      bestBreak = Math.min(start + 1, prepared.segments.length)
      bestKind = 'end'
      lastBreakWidth = prepared.widths[start] ?? 0
    }

    let text = ''
    let visualEnd = bestBreak

    if (bestKind === 'space') {
      while (visualEnd > start && isSpaceText(prepared.segments[visualEnd - 1]!)) {
        visualEnd--
      }
    } else if (bestKind === 'soft-hyphen') {
      visualEnd = bestBreak - 1
    }

    let actualWidth = 0
    for (let i = start; i < visualEnd; i++) {
      const seg = prepared.segments[i]!
      if (seg === SOFT_HYPHEN) continue
      text += seg
      actualWidth += prepared.widths[i]!
    }

    const endsWithHyphen = bestKind === 'soft-hyphen'
    if (endsWithHyphen) {
      text += '-'
      actualWidth += hyphenWidth
    }

    lines.push({
      text,
      width: actualWidth || lastBreakWidth,
      start: { segmentIndex: start, graphemeIndex: 0 },
      end: { segmentIndex: bestBreak, graphemeIndex: 0 },
      endsWithHyphen,
    })

    start = bestBreak
    while (start < prepared.segments.length && isSpaceText(prepared.segments[start]!)) {
      start++
    }
  }

  return lines
}

function isSpaceText(text: string): boolean {
  return text.trim().length === 0
}