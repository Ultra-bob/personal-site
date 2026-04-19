import * as p2 from "p2-es";

type BodyBinding = {
  body: p2.Body;
  el: HTMLElement;
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

const SETTLE_MAX_STEPS = 2000;
const SETTLE_TIME_STEP = 1 / 30;

const COLLISION_AUDIO_URL = "/collide.ogg";

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

world.addContactMaterial(
  new p2.ContactMaterial(borderMaterial, boxMaterial, { friction: 0.9 }),
);

world.addContactMaterial(
  new p2.ContactMaterial(boxMaterial, boxMaterial, { friction: 0.5 }),
);

// -----------------------------------------------------------------------------
// Audio
// -----------------------------------------------------------------------------

const audioCtx = new AudioContext();
let collisionBuffer: AudioBuffer | null = null;
let isSettling = true;

async function initAudio() {
  try {
    const resp = await fetch(COLLISION_AUDIO_URL);
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}`);
    }

    const arrayBuffer = await resp.arrayBuffer();
    collisionBuffer = await audioCtx.decodeAudioData(arrayBuffer);
  } catch (error) {
    console.error("Failed to load collision audio:", error);
  }
}

function playCollisionSound(bodyA: p2.Body, bodyB: p2.Body) {
  if (audioCtx.state !== "running" || !collisionBuffer) return;
  if (!bodyA.collisionResponse || !bodyB.collisionResponse) return;

  const relativeSpeed = p2.vec2.distance(bodyA.velocity, bodyB.velocity);
  const volume = Math.min(1, relativeSpeed / 1000);

  if (volume <= 0.01) return;

  const source = audioCtx.createBufferSource();
  source.buffer = collisionBuffer;

  const gain = audioCtx.createGain();
  gain.gain.setValueAtTime(volume, audioCtx.currentTime);

  source.connect(gain).connect(audioCtx.destination);
  source.start();
}

world.on("beginContact", (evt) => {
  if (isSettling) return;
  if (!evt.bodyA || !evt.bodyB) return;

  playCollisionSound(evt.bodyA, evt.bodyB);
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

  viewportState = next;
  applyViewportState();

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

function mouseToWorld(clientX: number, clientY: number): [number, number] {
  return [monitorOffset.x + clientX / SCALE, monitorOffset.y - clientY / SCALE];
}

function getLocalPoint(
  body: p2.Body,
  worldPoint: [number, number],
): [number, number] {
  const local: [number, number] = [0, 0];
  p2.vec2.toLocalFrame(local, worldPoint, body.position, body.angle);
  return local;
}

function onMouseDown(event: MouseEvent) {
  if (event.button !== 0) return;

  void audioCtx.resume();

  const worldPos = mouseToWorld(event.clientX, event.clientY);
  mouseBody.position[0] = worldPos[0];
  mouseBody.position[1] = worldPos[1];

  const hitBodies = world.hitTest(
    worldPos,
    dynamicBodies.map(({ body }) => body),
  );

  const targetBody = hitBodies.find((body) => body.type === p2.Body.DYNAMIC);
  if (!targetBody) return;

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
  world.addConstraint(mouseConstraint);
}

function onMouseUp(event: MouseEvent) {
  if (event.button !== 0) return;

  if (grabbedElement) {
    grabbedElement.style.cursor = "";
    grabbedElement = null;
  }
  document.body.style.cursor = "default";

  if (!mouseConstraint) return;

  mouseConstraint.bodyB.wakeUp();
  world.removeConstraint(mouseConstraint);
  mouseConstraint = null;
}

function onMouseMove(event: MouseEvent) {
  const [x, y] = mouseToWorld(event.clientX, event.clientY);
  mouseBody.position[0] = x;
  mouseBody.position[1] = y;
}

// -----------------------------------------------------------------------------
// Body bindings
// -----------------------------------------------------------------------------

const dynamicBodies: BodyBinding[] = [];
const kinematicBodies: BodyBinding[] = [];
let kinematicResizeObserver: ResizeObserver | null = null;

function getElementWorldCenter(rect: DOMRect): [number, number] {
  return [
    monitorOffset.x + (rect.left + rect.width / 2) / SCALE,
    monitorOffset.y - (rect.top + rect.height / 2) / SCALE,
  ];
}

function applyDynamicElementStyles(el: HTMLElement) {
  el.style.position = "fixed";
  el.style.top = "0";
  el.style.left = "0";
  el.style.margin = "0";
  el.style.transformOrigin = "50% 50%";
  el.style.willChange = "transform";
}

function createDynamicBody(el: HTMLElement) {
  const rect = el.getBoundingClientRect();
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

  applyDynamicElementStyles(el);
  dynamicBodies.push({ body, el });

  updateTransform(body, el);
}

function createKinematicBody(el: HTMLElement) {
  const rect = el.getBoundingClientRect();
  const width = rect.width / SCALE;
  const height = rect.height / SCALE;

  const body = new p2.Body({
    type: p2.Body.KINEMATIC,
    position: getElementWorldCenter(rect),
  });

  body.addShape(new p2.Box({ width, height, material: boxMaterial }));
  world.addBody(body);

  if (kinematicResizeObserver) {
    kinematicResizeObserver.observe(el);
  }

  kinematicBodies.push({ body, el });
}

function syncKinematicBody(binding: BodyBinding) {
  const { body, el } = binding;
  const rect = el.getBoundingClientRect();
  const shape = body.shapes[0] as p2.Box;

  const [x, y] = getElementWorldCenter(rect);
  const width = rect.width / SCALE;
  const height = rect.height / SCALE;

  body.position[0] = x;
  body.position[1] = y;

  if (shape.width !== width || shape.height !== height) {
    shape.width = width;
    shape.height = height;
    body.updateAABB();
  }
}

function syncKinematicBodies() {
  for (const binding of kinematicBodies) {
    syncKinematicBody(binding);
  }
}

function createBodies() {
  const elements = Array.from(
    document.querySelectorAll<HTMLElement>(".box, .kinematic-box"),
  ).reverse();

  for (const el of elements) {
    if (el.classList.contains("kinematic-box")) {
      createKinematicBody(el);
    } else {
      createDynamicBody(el);
    }
  }
}

// -----------------------------------------------------------------------------
// Rendering
// -----------------------------------------------------------------------------

function updateTransform(body: p2.Body, el: HTMLElement) {
  const shape = body.shapes[0] as p2.Box;

  const px = body.interpolatedPosition[0];
  const py = body.interpolatedPosition[1];

  const viewportX = px - monitorOffset.x;
  const viewportY = py - monitorOffset.y;

  const x = viewportX * SCALE - (shape.width * SCALE) / 2;
  const y = -viewportY * SCALE - (shape.height * SCALE) / 2;
  const angleDeg = (-body.interpolatedAngle * 180) / Math.PI;

  const transform = `translate(${x}px, ${y}px) rotate(${angleDeg}deg)`;

  el.style.transform = transform;
  el.style.webkitTransform = `${transform} translateZ(0)`;
}

function updateDynamicTransforms() {
  for (const { body, el } of dynamicBodies) {
    updateTransform(body, el);
  }
}

// -----------------------------------------------------------------------------
// Settling
// -----------------------------------------------------------------------------

function allDynamicBodiesSleeping() {
  return dynamicBodies.every(
    ({ body }) => body.sleepState === p2.Body.SLEEPING,
  );
}

function settleWorld(
  maxSteps = SETTLE_MAX_STEPS,
  dt = SETTLE_TIME_STEP,
) {
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

function animate(time: number) {
  rafId = requestAnimationFrame(animate);

  if (document.hidden) {
    lastTime = time;
    return;
  }

  syncViewportState();
  syncKinematicBodies();

  const dt = lastTime ? (time - lastTime) / 1000 : 0;
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
}

function removeEventListeners() {
  removeEventListener("mousedown", onMouseDown);
  removeEventListener("mouseup", onMouseUp);
  removeEventListener("mousemove", onMouseMove);
}

export function init() {
  if (initialized) return;
  initialized = true;

  kinematicResizeObserver = new ResizeObserver(() => {
    syncKinematicBodies();
  });

  viewportState = readViewportState();
  applyViewportState();

  createBodies();
  addEventListeners();

  void initAudio();

  settleWorld();
  isSettling = false;

  lastTime = performance.now();
  rafId = requestAnimationFrame(animate);
}

export function destroy() {
  if (!initialized) return;
  initialized = false;

  cancelAnimationFrame(rafId);
  removeEventListeners();

  kinematicResizeObserver?.disconnect();
  kinematicResizeObserver = null;

  if (mouseConstraint) {
    world.removeConstraint(mouseConstraint);
    mouseConstraint = null;
  }
}
