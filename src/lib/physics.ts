import * as p2 from "p2-es";
import { CollisionAudio, getCollisionImpact } from "./collision-audio";

type BodyBinding = {
  body: p2.Body;
  el: HTMLElement;
};

type DynamicBodyBinding = BodyBinding & {
  style: CSSStyleDeclaration;
};

type ViewportState = {
  x: number;
  y: number;
  w: number;
  h: number;
};

// -----------------------------------------------------------------------------
// Config
// -----------------------------------------------------------------------------

const SCALE = 5;
const DENSITY = 0.00001;
const MOUSE_MAX_FORCE = 1e4;

const FIXED_TIME_STEP = 1 / 60;
const MAX_SUB_STEPS = 10;
const MAX_FRAME_TIME = FIXED_TIME_STEP * MAX_SUB_STEPS;

const SETTLE_MAX_STEPS = 2000;
const SETTLE_TIME_STEP = 1 / 30;

// -----------------------------------------------------------------------------
// World
// -----------------------------------------------------------------------------

const world = new p2.World({
  gravity: [0, -2000 / SCALE],
  broadphase: new p2.SAPBroadphase(),
});

world.sleepMode = p2.World.BODY_SLEEPING;
// world.setGlobalStiffness(1e7);
// world.solver.iterations = 100;
// world.solver.tolerance = 0.001;

// -----------------------------------------------------------------------------
// Materials
// -----------------------------------------------------------------------------

const borderMaterial = new p2.Material();
const boxMaterial = new p2.Material();

world.addContactMaterial(new p2.ContactMaterial(borderMaterial, boxMaterial, { friction: 0.2 }));

world.addContactMaterial(new p2.ContactMaterial(boxMaterial, boxMaterial, { friction: 0.5 }));

// -----------------------------------------------------------------------------
// Audio
// -----------------------------------------------------------------------------

const collisionAudio = new CollisionAudio();
let isSettling = true;

world.on("beginContact", (evt) => {
  if (isSettling) return;
  const impact = getCollisionImpact(
    evt.contactEquations,
    SCALE,
    monitorOffset.x,
    window.innerWidth,
  );
  if (impact) collisionAudio.play(impact);
});

// -----------------------------------------------------------------------------
// Viewport / monitor offset
// -----------------------------------------------------------------------------

const monitorOffset = { x: 0, y: 0 };

function updateMonitorOffset() {
  monitorOffset.x = window.screenX / SCALE;
  monitorOffset.y = -window.screenY / SCALE;
}

function readViewportState(): ViewportState {
  return {
    x: window.screenX,
    y: window.screenY,
    w: window.innerWidth,
    h: window.innerHeight,
  };
}

let viewportState = readViewportState();

function applyViewportState() {
  updateMonitorOffset();
  updateBoundaries();
}

function syncViewportState() {
  const next = readViewportState();

  const changed =
    next.x !== viewportState.x ||
    next.y !== viewportState.y ||
    next.w !== viewportState.w ||
    next.h !== viewportState.h;

  if (!changed) return;

  const resized = next.w !== viewportState.w || next.h !== viewportState.h;
  viewportState = next;
  applyViewportState();

  if (resized) syncDynamicBodies();

  for (const body of world.bodies) {
    body.wakeUp();
  }
}

// -----------------------------------------------------------------------------
// Boundaries
// -----------------------------------------------------------------------------

function createPlane(angle = 0) {
  const body = new p2.Body({ type: p2.Body.KINEMATIC });
  body.addShape(new p2.Plane({ material: borderMaterial }), [0, 0], angle);
  world.addBody(body);
  return body;
}

const planeBottom = createPlane(0);
const planeRight = createPlane(Math.PI / 2);
const planeTop = createPlane(Math.PI);
const planeLeft = createPlane(-Math.PI / 2);

function updateBoundaries() {
  planeLeft.position[0] = monitorOffset.x;
  planeRight.position[0] = monitorOffset.x + window.innerWidth / SCALE;
  planeTop.position[1] = monitorOffset.y;
  planeBottom.position[1] = monitorOffset.y - window.innerHeight / SCALE;
}

// -----------------------------------------------------------------------------
// Mouse dragging
// -----------------------------------------------------------------------------

const mouseBody = new p2.Body({
  type: p2.Body.KINEMATIC,
  position: [0, 0],
  gravityScale: 0,
  collisionResponse: false,
});

mouseBody.allowSleep = false;
world.addBody(mouseBody);

let mouseConstraint: p2.RevoluteConstraint | null = null;
let grabbedElement: HTMLElement | null = null;
let grabOwner: "mouse" | "touch" | null = null;

function mouseToWorld(clientX: number, clientY: number): [number, number] {
  return [monitorOffset.x + clientX / SCALE, monitorOffset.y - clientY / SCALE];
}

function getLocalPoint(body: p2.Body, worldPoint: [number, number]): [number, number] {
  const local: [number, number] = [0, 0];
  p2.vec2.toLocalFrame(local, worldPoint, body.position, body.angle);
  return local;
}

function grabBody(clientX: number, clientY: number): boolean {
  if (mouseConstraint) {
    releaseBody();
  }

  const worldPos = mouseToWorld(clientX, clientY);
  mouseBody.position[0] = worldPos[0];
  mouseBody.position[1] = worldPos[1];

  const hitBodies = world.hitTest(
    worldPos,
    dynamicBodies.map(({ body }) => body),
  );

  const targetBody = hitBodies.find((body) => body.type === p2.Body.DYNAMIC);
  if (!targetBody) return false;

  const targetBinding = dynamicBodies.find(({ body }) => body === targetBody);
  if (targetBinding) {
    grabbedElement = targetBinding.el;
    document.body.style.cursor = "grabbing";
    grabbedElement.style.cursor = "grabbing";
  }

  mouseConstraint = new p2.RevoluteConstraint(mouseBody, targetBody, {
    localPivotA: [0, 0],
    localPivotB: getLocalPoint(targetBody, worldPos),
    collideConnected: false,
    maxForce: MOUSE_MAX_FORCE,
  });

  targetBody.wakeUp();
  targetBody.allowSleep = false;
  world.addConstraint(mouseConstraint);
  return true;
}

function releaseBody() {
  if (grabbedElement) {
    grabbedElement.style.cursor = "";
    grabbedElement = null;
  }
  document.body.style.cursor = "default";

  if (mouseConstraint) {
    mouseConstraint.bodyB.wakeUp();
    mouseConstraint.bodyB.allowSleep = true;
    world.removeConstraint(mouseConstraint);
  }
  mouseConstraint = null;
  grabOwner = null;
  activeTouchId = null;
}

function movePointer(clientX: number, clientY: number) {
  const [x, y] = mouseToWorld(clientX, clientY);
  mouseBody.position[0] = x;
  mouseBody.position[1] = y;
}

function onMouseDown(event: MouseEvent) {
  if (event.button !== 0 || activeTouchId !== null || grabOwner === "touch") return;
  collisionAudio.unlock();
  if (grabBody(event.clientX, event.clientY)) {
    grabOwner = "mouse";
  }
}

function onMouseUp(event: MouseEvent) {
  if (event.button !== 0) return;
  if (grabOwner === "mouse" && !(event.buttons & 1)) {
    releaseBody();
  }
}

function onMouseMove(event: MouseEvent) {
  if (activeTouchId !== null || grabOwner === "touch") return;
  if (grabOwner === "mouse" && mouseConstraint && !(event.buttons & 1)) {
    releaseBody();
  }
  movePointer(event.clientX, event.clientY);
}

const DRAG_THRESHOLD = 10;
let touchStartX = 0;
let touchStartY = 0;
let activeTouchId: number | null = null;

function findTouch(event: TouchEvent, id: number | null): Touch | undefined {
  if (id === null) return undefined;
  for (let i = 0; i < event.touches.length; i++) {
    if (event.touches[i].identifier === id) return event.touches[i];
  }
  return undefined;
}

function onTouchStart(event: TouchEvent) {
  if (activeTouchId !== null || grabOwner === "mouse") return;
  const touch = event.touches[0];
  if (!touch) return;
  activeTouchId = touch.identifier;
  touchStartX = touch.clientX;
  touchStartY = touch.clientY;
  collisionAudio.unlock();
  movePointer(touch.clientX, touch.clientY);
}

function onTouchEnd(event: TouchEvent) {
  const released = Array.from(event.changedTouches).some((t) => t.identifier === activeTouchId);
  if (!released) return;

  releaseBody();
}

function onTouchMove(event: TouchEvent) {
  if (activeTouchId === null || grabOwner === "mouse") return;
  const touch = findTouch(event, activeTouchId);
  if (!touch) {
    releaseBody();
    return;
  }
  movePointer(touch.clientX, touch.clientY);

  if (grabOwner !== "touch") {
    const dx = touch.clientX - touchStartX;
    const dy = touch.clientY - touchStartY;
    if (dx * dx + dy * dy < DRAG_THRESHOLD * DRAG_THRESHOLD) return;
    if (grabBody(touchStartX, touchStartY)) {
      grabOwner = "touch";
      event.preventDefault();
    }
    return;
  }

  event.preventDefault();
}

function onVisibilityChange() {
  if (document.hidden) {
    releaseBody();
  }
  resetSimulationClock();
}

function onPageShow() {
  resetSimulationClock();
}

function onWindowBlur() {
  releaseBody();
}

function onPointerCancel(event: PointerEvent) {
  // Pen input also produces the mouse events used to grab bodies. Touch
  // cancellation is matched to the active touch separately.
  if (grabOwner !== "mouse" || event.pointerType === "touch") return;
  releaseBody();
}

function onDragEnd() {
  if (grabOwner === "mouse") releaseBody();
}

// -----------------------------------------------------------------------------
// Body bindings
// -----------------------------------------------------------------------------

const dynamicBodies: DynamicBodyBinding[] = [];
const kinematicBodies: BodyBinding[] = [];
let layoutResizeObserver: ResizeObserver | null = null;

// Keep simulation overrides in their own sheet, leaving authored inline
// styles intact. Disabling the sheet restores the complete CSS layout.
const physicsStyleElement = document.createElement("style");
document.head.append(physicsStyleElement);
const physicsStyles = physicsStyleElement.sheet!;

function getElementWorldCenter(rect: DOMRect): [number, number] {
  return [
    monitorOffset.x + (rect.left + rect.width / 2) / SCALE,
    monitorOffset.y - (rect.top + rect.height / 2) / SCALE,
  ];
}

function createDynamicStyle(el: HTMLElement, rect: DOMRect, bodyId: number) {
  el.dataset.physicsBody = String(bodyId);
  const index = physicsStyles.insertRule(`[data-physics-body="${bodyId}"] {}`);
  const style = (physicsStyles.cssRules[index] as CSSStyleRule).style;
  style.cssText = `
    box-sizing: border-box !important;
    position: fixed !important;
    top: 0 !important;
    left: 0 !important;
    margin: 0 !important;
    transform-origin: 50% 50% !important;
    will-change: transform;
  `;
  style.setProperty("width", rect.width + "px", "important");
  style.setProperty("height", rect.height + "px", "important");
  return style;
}

function createDynamicBody(el: HTMLElement, rect: DOMRect) {
  const width = rect.width / SCALE;
  const height = rect.height / SCALE;

  const body = new p2.Body({
    mass: rect.width * rect.height * DENSITY,
    position: getElementWorldCenter(rect),
  });

  body.damping = 0.5;
  body.angularDamping = 0.6;
  body.allowSleep = true;
  body.sleepSpeedLimit = 1;
  body.sleepTimeLimit = 0.25;

  if (el.classList.contains("grav-inverted")) {
    body.gravityScale = -0.5;
  }

  body.addShape(new p2.Box({ width, height, material: boxMaterial }));
  world.addBody(body);

  const binding = { body, el, style: createDynamicStyle(el, rect, body.id) };
  dynamicBodies.push(binding);

  if (layoutResizeObserver) {
    layoutResizeObserver.observe(el);
  }

  updateTransform(binding);
}

function createKinematicBody(el: HTMLElement, rect: DOMRect) {
  const width = rect.width / SCALE;
  const height = rect.height / SCALE;

  const body = new p2.Body({
    type: p2.Body.KINEMATIC,
    position: getElementWorldCenter(rect),
  });

  body.addShape(new p2.Box({ width, height, material: boxMaterial }));
  world.addBody(body);

  if (layoutResizeObserver) {
    layoutResizeObserver.observe(el);
  }

  kinematicBodies.push({ body, el });
}

function syncKinematicBody(binding: BodyBinding): boolean {
  const { body, el } = binding;
  const rect = el.getBoundingClientRect();

  const [x, y] = getElementWorldCenter(rect);
  const width = rect.width / SCALE;
  const height = rect.height / SCALE;

  body.position[0] = x;
  body.position[1] = y;

  const shape = body.shapes[0] as p2.Box;
  if (shape.width === width && shape.height === height) return false;

  body.removeShape(shape);
  body.addShape(new p2.Box({ width, height, material: boxMaterial }));
  body.updateAABB();
  return true;
}

function wakeBodies() {
  for (const { body } of dynamicBodies) body.wakeUp();
  for (const { body } of kinematicBodies) body.wakeUp();
}

function syncKinematicBodies() {
  let changedAny = false;
  for (const binding of kinematicBodies) {
    if (syncKinematicBody(binding)) changedAny = true;
  }
  if (changedAny) {
    wakeBodies();
  }
}

function syncDynamicBodies() {
  if (dynamicBodies.length === 0) return;

  // Let the browser resolve the authored layout, with all siblings present,
  // before pinning the new border-box sizes for the simulation.
  let rects: DOMRect[];
  physicsStyles.disabled = true;
  try {
    rects = dynamicBodies.map(({ el }) => el.getBoundingClientRect());
  } finally {
    physicsStyles.disabled = false;
  }

  let changedAny = false;

  dynamicBodies.forEach((binding, index) => {
    const rect = rects[index];

    binding.style.setProperty("width", rect.width + "px", "important");
    binding.style.setProperty("height", rect.height + "px", "important");

    const width = rect.width / SCALE;
    const height = rect.height / SCALE;

    const shape = binding.body.shapes[0] as p2.Box;
    if (shape.width !== width || shape.height !== height) {
      binding.body.removeShape(shape);
      binding.body.mass = rect.width * rect.height * DENSITY;
      binding.body.addShape(new p2.Box({ width, height, material: boxMaterial }));
      binding.body.updateAABB();
      changedAny = true;
    }
  });

  if (changedAny) {
    wakeBodies();
    updateDynamicTransforms();
  }
}

function createBodies() {
  const elements = Array.from(
    document.querySelectorAll<HTMLElement>(".box, .kinematic-box"),
  ).reverse();

  // Capture the layout before fixed positioning removes cards from the flow.
  const initialLayout = elements.map((el) => ({ el, rect: el.getBoundingClientRect() }));

  for (const { el, rect } of initialLayout) {
    if (el.classList.contains("kinematic-box")) {
      createKinematicBody(el, rect);
    } else {
      createDynamicBody(el, rect);
    }
  }

  // Observe layout containers as well, so container-only sizing changes
  // (collapsible panels, container queries, parent width changes, etc.)
  // trigger a geometry sync.
  const observedContainers = new Set<HTMLElement>();
  for (const { el } of initialLayout) {
    let parent = el.parentElement;
    while (parent) {
      if (!observedContainers.has(parent)) {
        observedContainers.add(parent);
        layoutResizeObserver?.observe(parent);
      }
      parent = parent.parentElement;
    }
  }
}

// -----------------------------------------------------------------------------
// Rendering
// -----------------------------------------------------------------------------

function updateTransform({ body, style }: DynamicBodyBinding) {
  const shape = body.shapes[0] as p2.Box;

  const px = body.interpolatedPosition[0];
  const py = body.interpolatedPosition[1];

  const viewportX = px - monitorOffset.x;
  const viewportY = py - monitorOffset.y;

  const x = viewportX * SCALE - (shape.width * SCALE) / 2;
  const y = -viewportY * SCALE - (shape.height * SCALE) / 2;

  const transform = `translate(${x}px, ${y}px) rotate(${-body.interpolatedAngle}rad)`;

  style.setProperty("transform", transform, "important");
}

function updateDynamicTransforms() {
  for (const binding of dynamicBodies) {
    updateTransform(binding);
  }
}

// -----------------------------------------------------------------------------
// Settling
// -----------------------------------------------------------------------------

function allDynamicBodiesSleeping() {
  return dynamicBodies.every(({ body }) => body.sleepState === p2.Body.SLEEPING);
}

function settleWorld(maxSteps = SETTLE_MAX_STEPS, dt = SETTLE_TIME_STEP) {
  syncKinematicBodies();
  for (let i = 0; i < maxSteps; i++) {
    world.step(dt);

    if (allDynamicBodiesSleeping()) {
      break;
    }
  }

  updateDynamicTransforms();

  for (const { el } of dynamicBodies) {
    el.style.visibility = "visible";
  }

  for (const binding of kinematicBodies) {
    syncKinematicBody(binding);
    binding.el.style.visibility = "visible";
  }
}

// -----------------------------------------------------------------------------
// Animation loop
// -----------------------------------------------------------------------------

let lastTime = 0;
let rafId = 0;

function resetSimulationClock() {
  lastTime = performance.now();
}

function animate(time: number) {
  rafId = requestAnimationFrame(animate);

  if (document.hidden) {
    lastTime = time;
    return;
  }

  syncViewportState();
  syncKinematicBodies();

  const elapsed = lastTime ? (time - lastTime) / 1000 : 0;
  const dt = Math.min(Math.max(elapsed, 0), MAX_FRAME_TIME);
  world.step(FIXED_TIME_STEP, dt, MAX_SUB_STEPS);

  updateDynamicTransforms();
  lastTime = time;
}

// -----------------------------------------------------------------------------
// Lifecycle
// -----------------------------------------------------------------------------

let initialized = false;

function addEventListeners() {
  addEventListener("mousedown", onMouseDown);
  addEventListener("mouseup", onMouseUp);
  addEventListener("mousemove", onMouseMove);
  addEventListener("pointercancel", onPointerCancel);
  addEventListener("dragend", onDragEnd);
  addEventListener("touchstart", onTouchStart, { passive: false });
  addEventListener("touchend", onTouchEnd);
  addEventListener("touchmove", onTouchMove, { passive: false });
  addEventListener("touchcancel", onTouchEnd);
  document.addEventListener("visibilitychange", onVisibilityChange);
  addEventListener("pageshow", onPageShow);
  addEventListener("blur", onWindowBlur);
}

function removeEventListeners() {
  removeEventListener("mousedown", onMouseDown);
  removeEventListener("mouseup", onMouseUp);
  removeEventListener("mousemove", onMouseMove);
  removeEventListener("pointercancel", onPointerCancel);
  removeEventListener("dragend", onDragEnd);
  removeEventListener("touchstart", onTouchStart);
  removeEventListener("touchend", onTouchEnd);
  removeEventListener("touchmove", onTouchMove);
  removeEventListener("touchcancel", onTouchEnd);
  document.removeEventListener("visibilitychange", onVisibilityChange);
  removeEventListener("pageshow", onPageShow);
  removeEventListener("blur", onWindowBlur);
}

export function init() {
  if (initialized) return;
  initialized = true;

  layoutResizeObserver = new ResizeObserver(() => {
    syncKinematicBodies();
    syncDynamicBodies();
  });

  viewportState = readViewportState();
  applyViewportState();

  createBodies();
  addEventListeners();

  settleWorld();
  isSettling = false;

  resetSimulationClock();
  rafId = requestAnimationFrame(animate);
}

export function destroy() {
  if (!initialized) return;
  initialized = false;

  cancelAnimationFrame(rafId);
  removeEventListeners();
  collisionAudio.destroy();

  layoutResizeObserver?.disconnect();
  layoutResizeObserver = null;

  releaseBody();
}
