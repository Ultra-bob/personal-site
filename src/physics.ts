/* --------------------------------------------------------------
   p2‑js “boxes + walls + mouse‑joint” demo
   -------------------------------------------------------------- */
import * as p2 from "p2-es";

/* --------------------------------------------------------------
   1️⃣  Global constants
   -------------------------------------------------------------- */
const SCALE = 5;                     // world‑units‑→‑pixels
const DENSITY = 0.00001;              // area‑to‑mass ratio

/* --------------------------------------------------------------
   2️⃣  World creation
   -------------------------------------------------------------- */
const world = new p2.World({
  gravity: [0, -1000 / SCALE],
  broadphase: new p2.SAPBroadphase(),
});
world.sleepMode = p2.World.BODY_SLEEPING;

// Set stiffness of all contacts and constraints
world.setGlobalStiffness(1e8);

/* --------------------------------------------------------------
   3️⃣  Materials & sound (unchanged)
   -------------------------------------------------------------- */
const borderMaterial = new p2.Material();
const boxMaterial    = new p2.Material();
const cursorMaterial = new p2.Material();

const audioCtx = new AudioContext();
const resp = await fetch("/collide.ogg");
const arrayBuffer = await resp.arrayBuffer();
const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);

world.on("beginContact", (evt) => {
  if (audioCtx.state == "suspended") return;           // need user interaction
  if (!(evt.bodyA.collisionResponse && evt.bodyB.collisionResponse)) return;

  const vol = p2.vec2.distance(evt.bodyA.velocity, evt.bodyB.velocity) / 1000;
  const src = audioCtx.createBufferSource();
  src.buffer = audioBuffer;
  const gain = audioCtx.createGain();
  gain.gain.setValueAtTime(vol, audioCtx.currentTime);
  src.connect(gain).connect(audioCtx.destination);
  src.start();
});

/* --------------------------------------------------------------
   4️⃣  Contact materials
   -------------------------------------------------------------- */
world.addContactMaterial(new p2.ContactMaterial(borderMaterial, boxMaterial,   { friction: 0.9 }));
world.addContactMaterial(new p2.ContactMaterial(boxMaterial,    boxMaterial,     { friction: 0.5 }));
world.addContactMaterial(new p2.ContactMaterial(boxMaterial,    cursorMaterial,  { friction: 2   }));

/* --------------------------------------------------------------
   5️⃣  Monitor‑offset handling (world units)
   -------------------------------------------------------------- */
let monitorOffset = {
  x: window.screenX / SCALE,
  y: -window.screenY / SCALE,
};
function updateMonitorOffset() {
  monitorOffset.x = window.screenX / SCALE;
  monitorOffset.y = -window.screenY / SCALE;
}

/* --------------------------------------------------------------
   6️⃣  Walls (kinematic planes)
   -------------------------------------------------------------- */
const planeBottom = new p2.Body({ type: p2.Body.KINEMATIC });
planeBottom.addShape(new p2.Plane({ material: borderMaterial }));
world.addBody(planeBottom);

const planeTop = new p2.Body({ type: p2.Body.KINEMATIC });
planeTop.addShape(new p2.Plane({ material: borderMaterial }), [0, 0], Math.PI);
// world.addBody(planeTop); // not added initially – we add it later after boxes

const planeLeft = new p2.Body({ type: p2.Body.KINEMATIC });
planeLeft.addShape(new p2.Plane({ material: borderMaterial }), [0, 0], -Math.PI / 2);
world.addBody(planeLeft);

const planeRight = new p2.Body({ type: p2.Body.KINEMATIC });
planeRight.addShape(new p2.Plane({ material: borderMaterial }), [0, 0], Math.PI / 2);
world.addBody(planeRight);

/* --------------------------------------------------------------
   7️⃣  Keep the walls hugging the viewport rectangle
   -------------------------------------------------------------- */
function updateBoundaries() {
  // left & right
  planeLeft.position[0]  = monitorOffset.x;
  planeRight.position[0] = monitorOffset.x + window.innerWidth / SCALE;
  // top & bottom
  planeTop.position[1]    = monitorOffset.y;
  planeBottom.position[1] = monitorOffset.y - window.innerHeight / SCALE;
}

/* --------------------------------------------------------------
   8️⃣  Mouse “cursor” body (kinematic)
   -------------------------------------------------------------- */
const mouseBody = new p2.Body({
  position: [
    monitorOffset.x + 2,
    monitorOffset.y - 2,
  ],
  gravityScale: 0,
  collisionResponse: false,
  type: p2.Body.KINEMATIC,
});
mouseBody.ccdSpeedThreshold = 1;
mouseBody.allowSleep = false;
mouseBody.addShape(new p2.Circle({ radius: 0.15, material: cursorMaterial }));
world.addBody(mouseBody);

/* --------------------------------------------------------------
   9️⃣  Mouse‑joint state
   -------------------------------------------------------------- */
let mouseConstraint: p2.RevoluteConstraint | null = null; // current joint (if any)
let isMouseDown = false;                                 // true while right button held

/** Convert a MouseEvent → world (physics) coordinates. */
function mouseToWorld(ev: MouseEvent): [number, number] {
  // clientX/Y are CSS pixels → divide by SCALE to get world units,
  // then add the monitor offset (which already contains the sign flip for Y).
  const wx = monitorOffset.x + ev.clientX / SCALE;
  const wy = monitorOffset.y - ev.clientY / SCALE; // minus because +Y is up in p2
  return [wx, wy];
}

/* --------------------------------------------------------------
   10️⃣  Event listeners – create / destroy the mouse joint
   -------------------------------------------------------------- */
addEventListener('mousedown', e => {

  // ---- Right‑click: try to grab a box --------------------------------
  if (e.button !== 2) return; // ignore other buttons

  const worldPos = mouseToWorld(e);
  mouseBody.position[0] = worldPos[0];
  mouseBody.position[1] = worldPos[1];

  // Hit‑test against ALL dynamic boxes
  const hitBodies = world.hitTest(worldPos, bodies.map(b => b.physics));

  if (hitBodies.length > 0) {
    const targetBody = hitBodies[0];

    // Create a revolute (mouse) constraint
    mouseConstraint = new p2.RevoluteConstraint(mouseBody, targetBody, {
      worldPivot: worldPos,
      collideConnected: false,
    });
    world.addConstraint(mouseConstraint);
    isMouseDown = true;

    // Show custom pointer (optional)
    const ptr = document.getElementById('pointer')!;
    ptr.style.display = 'block';
  }
});

addEventListener('mouseup', e => {
  if (e.button !== 2) return; // only right‑button releases matter

  if (mouseConstraint) {
    mouseConstraint.bodyB.wakeUp(); // wake up the body we were dragging (optional)
    world.removeConstraint(mouseConstraint);
    mouseConstraint = null;
  }
  isMouseDown = false;

  // Hide the custom pointer again
  const ptr = document.getElementById('pointer')!;
  ptr.style.display = 'none';
});

addEventListener('mousemove', e => {
  // Keep the kinematic mouse body under the cursor at all times.
  const [wx, wy] = mouseToWorld(e);
  mouseBody.position[0] = wx;
  mouseBody.position[1] = wy;
});

/* --------------------------------------------------------------
   11️⃣  Prevent the context‑menu (right‑click) from appearing
   -------------------------------------------------------------- */
document.addEventListener('contextmenu', e => e.preventDefault());

/* --------------------------------------------------------------
   12️⃣  Box bodies (DOM ↔ physics)
   -------------------------------------------------------------- */
const bodies: { physics: p2.Body; dom: HTMLElement }[] = [];

async function createBodies() {
  const els = Array.from(document.querySelectorAll('.box')).reverse() as HTMLElement[];
  for (const el of els) {
    createBody(el);
    await new Promise(r => setTimeout(r, 400));
  }
  await new Promise(r => setTimeout(r, 500));
  world.addBody(planeTop);          // add ceiling after boxes so they don’t clip initially
}
createBodies();

function createBody(element: HTMLElement) {
  const rect = element.getBoundingClientRect();
  const w = rect.width / SCALE;
  const h = rect.height / SCALE;

  const body = new p2.Body({
    mass: rect.width * rect.height * DENSITY,
    position: [
      monitorOffset.x + (rect.left + rect.width / 2) / SCALE,
      monitorOffset.y - (rect.top + rect.height / 2) / SCALE,
    ],
    angle: 0,
  });
  body.damping = 0.5;
  body.angularDamping = 0.6;
  body.allowSleep = true;
  body.sleepSpeedLimit = 1;
  body.sleepTimeLimit = 0.25;

  if (element.classList.contains('grav-inverted')) {
    body.gravityScale = -0.5;
    body.velocity[1] = -150;               // give it a little initial kick
  }

  body.addShape(new p2.Box({ width: w, height: h, material: boxMaterial }));
  world.addBody(body);

  // Prepare DOM element for CSS‑transform updates
  element.style.position = 'absolute';
  element.style.top = '0';
  element.style.left = '0';
  element.style.transformOrigin = '50% 50%';

  bodies.push({ physics: body, dom: element });
  updateTransform(body, element);
}

/* --------------------------------------------------------------
   13️⃣  Helper – update CSS transform from physics body
   -------------------------------------------------------------- */
function updateTransform(body: p2.Body, el: HTMLElement) {
  const w = (body.shapes[0] as p2.Box).width;
  const h = (body.shapes[0] as p2.Box).height;
  const px = body.interpolatedPosition[0];
  const py = body.interpolatedPosition[1];

  // Shift into viewport coordinates (subtract monitor offset)
  const vx = px - monitorOffset.x;
  const vy = py - monitorOffset.y;

  // Convert to CSS pixels, taking the shape size into account
  const x = (vx - w / 2) * SCALE;
  const y = -(vy + h / 2) * SCALE;
  const angleDeg = -body.interpolatedAngle * 180 / Math.PI;

  const tf = `translate(${x}px, ${y}px) rotate(${angleDeg}deg)`;
  el.style.transform = tf;
  el.style.webkitTransform = tf + ' translateZ(0)';
}

/* --------------------------------------------------------------
   14️⃣  Helper – visual feedback for sleeping bodies
   -------------------------------------------------------------- */
function displaySleeping(body: p2.Body, el: HTMLElement) {
  if (body.sleepState === p2.Body.SLEEPING) {
    el.style.filter = 'opacity(40%)';
  } else if (body.sleepState === p2.Body.SLEEPY) {
    el.style.filter = 'opacity(60%)';
  } else {
    el.style.filter = 'none';
  }
}

/* --------------------------------------------------------------
   15️⃣  Wake‑up all bodies when the window / monitor moves
   -------------------------------------------------------------- */
let prevWindow = {
  x: window.screenX,
  y: window.screenY,
  w: window.innerWidth,
  h: window.innerHeight,
};
function wakeAllOnWindowChange() {
  const x = window.screenX,
        y = window.screenY,
        w = window.innerWidth,
        h = window.innerHeight;

  if (x !== prevWindow.x || y !== prevWindow.y || w !== prevWindow.w || h !== prevWindow.h) {
    world.bodies.forEach(b => b.wakeUp());   // no‑op for static/kinematic bodies
    prevWindow = { x, y, w, h };
  }
}

/* --------------------------------------------------------------
   16️⃣  Minimal mouseAction – only unlock audio / keep pointer
   -------------------------------------------------------------- */
function mouseAction() {
  // The demo needs a user gesture to start audio – keep this.
  if (audioCtx.state === "suspended") {
    audioCtx.resume();
  }
  // No other code needed; the joint does the dragging.
}

/* --------------------------------------------------------------
   17️⃣  Debug UI (optional)
   -------------------------------------------------------------- */
const stepTimeDisplay = document.getElementById('stepTime')!;
const deltaDisplay    = document.getElementById('delta')!;

/* --------------------------------------------------------------
   18️⃣  Main animation loop
   -------------------------------------------------------------- */
const fixedTimeStep = 1 / 60;
const maxSubSteps   = 10;
let lastTime = performance.now();

function animate(time: number) {
  requestAnimationFrame(animate);
  if (document.hidden) { lastTime = time; return; }

  updateMonitorOffset();
  updateBoundaries();
  wakeAllOnWindowChange();

  const dt = (time - lastTime) / 1000;

  world.step(fixedTimeStep, dt, maxSubSteps);

  // Unlock audio / show pointer (still needed)
  mouseAction();

  // Update DOM elements
  bodies.forEach(b => updateTransform(b.physics, b.dom));
  // bodies.forEach(b => displaySleeping(b.physics, b.dom));

  lastTime = time;
}
requestAnimationFrame(animate);