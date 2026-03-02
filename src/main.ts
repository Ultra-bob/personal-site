import * as p2 from "p2-es";
import { clamp } from "./util";

const SCALE = 50;
const DENSITY = 0.00001; // Ratio of area to mass of elements

// 1) Create world
const world = new p2.World({
  gravity: [0, -1000 / SCALE],
  broadphase: new p2.SAPBroadphase(),
});
world.sleepMode = p2.World.BODY_SLEEPING;

// 2) Materials & audio (unchanged)
const borderMaterial = new p2.Material();
const boxMaterial    = new p2.Material();
const cursorMaterial = new p2.Material();
const audioCtx = new AudioContext();
const resp = await fetch("/collide.ogg");
const arrayBuffer = await resp.arrayBuffer();
const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);

world.on("beginContact", (evt) => {
  if (audioCtx.state == "suspended") {
    // The user needs to click once to allow audio
    return;
  }
  if (!(evt.bodyA.collisionResponse && evt.bodyB.collisionResponse)) {
    return;
  }
  const vol = p2.vec2.distance(evt.bodyA.velocity, evt.bodyB.velocity) / 100;
  const src = audioCtx.createBufferSource();
  src.buffer = audioBuffer;
  const gain = audioCtx.createGain();
  gain.gain.setValueAtTime(vol, audioCtx.currentTime);
  src.connect(gain).connect(audioCtx.destination);
  src.start();
});

// friction, etc
world.addContactMaterial(new p2.ContactMaterial(borderMaterial, boxMaterial,   { friction: 0.9 }));
world.addContactMaterial(new p2.ContactMaterial(boxMaterial,    boxMaterial,     { friction: 0.5 }));
world.addContactMaterial(new p2.ContactMaterial(boxMaterial,    cursorMaterial,  { friction: 2   }));

// 3) Monitor‐based “origin offset” in world units
let monitorOffset = {
  x: window.screenX / SCALE,
  y: -window.screenY / SCALE
};
function updateMonitorOffset() {
  monitorOffset.x = window.screenX / SCALE;
  monitorOffset.y = -window.screenY / SCALE;
}

// 4) Walls as kinematic planes, will reposition them each step
const planeBottom = new p2.Body({ type: p2.Body.KINEMATIC });
planeBottom.addShape(new p2.Plane({ material: borderMaterial }));
world.addBody(planeBottom);

const planeTop = new p2.Body({ type: p2.Body.KINEMATIC });
planeTop.addShape(new p2.Plane({ material: borderMaterial }), [0,0], Math.PI);
world.addBody(planeTop);

const planeLeft = new p2.Body({ type: p2.Body.KINEMATIC });
planeLeft.addShape(new p2.Plane({ material: borderMaterial }), [0,0], -Math.PI/2);
world.addBody(planeLeft);

const planeRight = new p2.Body({ type: p2.Body.KINEMATIC });
planeRight.addShape(new p2.Plane({ material: borderMaterial }), [0,0], Math.PI/2);
world.addBody(planeRight);

// Reposition the four walls to hug the monitor‐window rectangle
function updateBoundaries() {
  // left & right
  planeLeft.position[0]  = monitorOffset.x;
  planeRight.position[0] = monitorOffset.x + window.innerWidth / SCALE;
  // top & bottom
  planeTop.position[1]    = monitorOffset.y;
  planeBottom.position[1] = monitorOffset.y - window.innerHeight / SCALE;
  // no velocities needed; setting position on kinematic bodies is fine
}

// 5) Mouse “pointer” body (unchanged, except we'll interpret its position in world coords)
const mouseBody = new p2.Body({
  mass: 1,
  position: [
    monitorOffset.x + 2,
    monitorOffset.y - 2
  ],
  gravityScale: 0,
  collisionResponse: false,
});
mouseBody.allowSleep = false;
mouseBody.addShape(new p2.Circle({ radius: 0.15, material: cursorMaterial }));
world.addBody(mouseBody);

// 6) Box bodies
const bodies: { physics: p2.Body; dom: HTMLElement }[] = [];
document.querySelectorAll(".box").forEach(el => createBody(el as HTMLElement));

function createBody(element: HTMLElement) {
  const rect = element.getBoundingClientRect();
  const w = rect.width  / SCALE;
  const h = rect.height / SCALE;

  // Phys position = monitorOffset + viewport‐based px→world conversion
  const body = new p2.Body({
    mass: rect.width * rect.height * DENSITY,
    position: [
      monitorOffset.x + (rect.left   + rect.width/2) / SCALE,
      monitorOffset.y - (rect.top    + rect.height/2) / SCALE,
    ],
    angle: 0
  });
  body.damping = 0.5;
  body.allowSleep      = true;
  body.sleepSpeedLimit = 0.05;
  body.sleepTimeLimit  = 1;
  if (element.classList.contains("grav-inverted")) {
    body.gravityScale = -0.5;
  }
  body.addShape(new p2.Box({ width: w, height: h, material: boxMaterial }));
  world.addBody(body);

  element.style.position = "absolute";
  element.style.top      = "0";
  element.style.left     = "0";
  element.style.transformOrigin = "50% 50%";

  bodies.push({ physics: body, dom: element });
  updateTransform(body, element);
}

// 7) Mouse tracking
let mouseEvent: MouseEvent|null = null;
addEventListener("mousemove", e => mouseEvent = e);
addEventListener("mousedown", e => mouseEvent = e);
addEventListener("mouseup",   e => mouseEvent = e);
document.addEventListener("contextmenu", e => e.preventDefault());

function mouseAction() {
  if (!mouseEvent) return;
  if (audioCtx.state == "suspended") {
    audioCtx.resume()
  }
  const px = mouseEvent.clientX / SCALE;
  const py = -mouseEvent.clientY / SCALE;
  // point in world coords:
  const targetX = monitorOffset.x + px;
  const targetY = monitorOffset.y + py;

  // move the pointer body towards the cursor
  const rate = 0.5 / (1/60);
  mouseBody.velocity[0] = (targetX - mouseBody.position[0]) * rate;
  mouseBody.velocity[1] = (targetY - mouseBody.position[1]) * rate;
  mouseBody.collisionResponse = mouseEvent.buttons === 2;

  const DOMp = document.getElementById("pointer")!;
  document.getElementsByTagName("html")[0].style.cursor = (mouseEvent.buttons === 2 ? "none" : "unset")
  DOMp.style.display = (mouseEvent.buttons === 2 ? "block" : "none");
  DOMp.style.left    = (mouseBody.interpolatedPosition[0] - monitorOffset.x) * SCALE + "px";
  DOMp.style.top     = -(mouseBody.interpolatedPosition[1] - monitorOffset.y) * SCALE + "px";
}

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

  // if any metric changed, wake them all
  if (x !== prevWindow.x ||
      y !== prevWindow.y ||
      w !== prevWindow.w ||
      h !== prevWindow.h) {

    // wake *all* bodies in the world
    world.bodies.forEach(body => {
      // only dynamic bodies really need waking, but wakeUp() is
      // a no-op on STATIC/KINEMATIC anyway:
      body.wakeUp();
    });

    // store for next frame
    prevWindow = { x, y, w, h };
  }
}

// 8) Transform update (world→screen)
function updateTransform(body: p2.Body, el: HTMLElement) {
  const w = body.shapes[0].width;
  const h = body.shapes[0].height;
  const px = body.interpolatedPosition[0];
  const py = body.interpolatedPosition[1];

  // first shift into viewport coords by subtracting monitorOffset
  const vx = px - monitorOffset.x;
  const vy = py - monitorOffset.y;

  // then convert to CSS pixels, accounting for box‐width/height
  const x = (vx - w/2) * SCALE;
  const y = -(vy + h/2) * SCALE;

  const angleDeg = -body.interpolatedAngle * 180 / Math.PI;
  const tf = `translate(${x}px, ${y}px) rotate(${angleDeg}deg)`;
  el.style.transform = tf;
  el.style.webkitTransform = tf + " translateZ(0)";
}

// 9) Animation loop
const fixedTimeStep    = 1/60;
const maxSubSteps      = 10;
let lastTime           = performance.now();
function animate(time: number) {
  requestAnimationFrame(animate);
  if (document.hidden) { lastTime = time; return; }

  updateMonitorOffset();
  updateBoundaries();
  wakeAllOnWindowChange();

  const dt = (time - lastTime) / 1000;
  world.step(fixedTimeStep, dt, maxSubSteps);

  mouseAction();

  bodies.forEach(b => updateTransform(b.physics, b.dom));
  lastTime = time;
}

requestAnimationFrame(animate);