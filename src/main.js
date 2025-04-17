import * as p2 from 'p2-es'

const SCALE = 100;
const DENSITY = 0.0001; // Ratio of area to mass of elements

// Create a physics world, where bodies and constraints live
const world = new p2.World({
    gravity: [0, -10],
    broadphase: new p2.SAPBroadphase()
})

world.sleepMode = p2.World.BODY_SLEEPING

const borderMaterial = new p2.Material()
const boxMaterial = new p2.Material()

var border = new p2.ContactMaterial(borderMaterial, boxMaterial, {
    friction: 0.8,
});

world.addContactMaterial(border);

// Add planes for browser window "walls"
var body = document.body,
    html = document.documentElement;
var height = Math.max(body.scrollHeight, body.offsetHeight,
    html.clientHeight, html.scrollHeight, html.offsetHeight);
var planeBottomBody = new p2.Body({
    position: [0, - (height) / SCALE],
    type: p2.Body.KINEMATIC
});
planeBottomBody.addShape(new p2.Plane({ material: borderMaterial }));
world.addBody(planeBottomBody);
var planeTopBody = new p2.Body({
    position: [0, 0],
    type: p2.Body.KINEMATIC
});
planeTopBody.addShape(new p2.Plane({ material: borderMaterial }), [0, 0], Math.PI);
world.addBody(planeTopBody);
var planeLeftBody = new p2.Body({ type: p2.Body.KINEMATIC });
planeLeftBody.addShape(new p2.Plane({ material: borderMaterial }), [0, 0], -Math.PI / 2);
world.addBody(planeLeftBody);
var planeRightBody = new p2.Body({
    position: [(document.body.getBoundingClientRect().width) / SCALE, 0],
    type: p2.Body.KINEMATIC
});
planeRightBody.addShape(new p2.Plane({ material: borderMaterial }), [0, 0], Math.PI / 2);
world.addBody(planeRightBody);

let currentWindowSize = {
    x: window.screenLeft,
    y: window.screenTop,
    w: window.innerWidth,
    h: window.innerHeight
}

const mouseBody = new p2.Body({
    mass: 1,
    position: [2, 2],
    gravityScale: 0,
    collisionResponse: false
    // type: p2.Body.KINEMATIC
})

mouseBody.allowSleep = false;

mouseBody.addShape(new p2.Circle({radius: 0.15, material: borderMaterial}))

world.addBody(mouseBody)

// To animate the bodies, we must step the world forward in time, using a fixed time step size.
// The World will run substeps and interpolate automatically for us, to get smooth animation.
const fixedTimeStep = 1 / 60 // seconds
const maxSubSteps = 10 // Max sub steps to catch up with the wall clock

const bodies = [];

let lastTime = 0

document.querySelectorAll(".box").forEach(element => {
    createBody(element)
    console.log("body created!")
});

function createBody(element) {
    var rect = element.getBoundingClientRect();
    var body = new p2.Body({
        mass: rect.width * rect.height * DENSITY,
        position: [
            (rect.left + rect.width / 2) / SCALE,
            -(rect.top + rect.height / 2) / SCALE
        ],
        angle: 0
    });

    body.damping = 0.2

    console.log(body.mass)

    var shape = new p2.Box({
        width: rect.width / SCALE,
        height: rect.height / SCALE,
        material: boxMaterial
    });

    body.allowSleep = true;
    body.sleepSpeedLimit = 0.05;
    body.sleepTimeLimit = 1;

    body.addShape(shape);

    world.addBody(body);

    bodies.push({ physics: body, dom: element })

    element.style.position = 'absolute';
    element.style.top = 0;
    element.style.left = 0;
    element.style.transformOrigin = '50% 50%';
    updateTransform(body, element);
}

let mouseEvent = null
let lastMouseEvent = Date.now()

addEventListener("mousemove", (event) => mouseEvent = event)
addEventListener("mouseup", (event) => mouseEvent = event)
addEventListener("mousedown", (event) => mouseEvent = event)

function mouseAction() {

    if (mouseEvent === null) {
        return
    }

    const DOMpointer = document.getElementById("pointer")

    DOMpointer.style.left = mouseBody.interpolatedPosition[0] * SCALE + "px"
    DOMpointer.style.top = -mouseBody.interpolatedPosition[1] * SCALE + "px"

    // if (mouseEvent.button == 2) {
    //     mouseBody.position = [mouseEvent.clientX / SCALE, mouseEvent.clientY / SCALE]
    // }
    DOMpointer.style.background = mouseEvent.buttons == 2 ? "grey" : "transparent"

    mouseBody.collisionResponse = mouseEvent.buttons == 2;

    mouseBody.velocity.set([(mouseEvent.clientX / SCALE - mouseBody.position[0]) * 30, (-mouseEvent.clientY / SCALE - mouseBody.position[1]) * 30])
}

document.addEventListener('contextmenu', event => event.preventDefault());

function resizeWindow() {
    const delta = {
        top: window.screenTop - currentWindowSize.y,
        bottom: (window.screenTop + window.innerHeight) - (currentWindowSize.y + currentWindowSize.h),
        left: window.screenLeft - currentWindowSize.x,
        right: (window.screenLeft + window.innerWidth) - (currentWindowSize.x + currentWindowSize.w)
    }


    if (Object.values(delta).some(item => item !== 0)) {
        // console.log(delta)
        bodies.forEach(element => {
            element.physics.wakeUp()

            var rect = element.dom.getBoundingClientRect();

            element.physics.shapes[0].width = rect.width / SCALE

            element.physics.shapes[0].height = rect.height / SCALE

            if (delta.top !== 0 || delta.left !== 0) { 
                element.physics.applyForce([delta.top/SCALE, delta.left/SCALE], element.physics.position)
            }
        });
    }

    const adjustmentBottom = Math.round(-window.innerHeight - planeBottomBody.position[1]*SCALE)

    const adjustmentRight = Math.round(window.innerWidth - planeRightBody.position[0]*SCALE)

    // console.log(adjustment/SCALE)
    
    planeBottomBody.velocity = [0, -Math.max(-adjustmentBottom/SCALE * 30, -20)]
    planeRightBody.velocity = [Math.min(adjustmentRight/SCALE * 30, 20), 0]

    currentWindowSize = {
        x: window.screenLeft,
        y: window.screenTop,
        w: window.innerWidth,
        h: window.innerHeight
    }

}

world.on('postStep', (event) => {
    resizeWindow()
    mouseAction()
})

function updateTransform(body, element) {

    // Convert physics coordinates to pixels
    var x = SCALE * (body.interpolatedPosition[0] - body.shapes[0].width / 2);
    var y = -SCALE * (body.interpolatedPosition[1] + body.shapes[0].height / 2);

    // element.style.background = ["green", "orange", "gray"][body.sleepState]

    // Set element style
    var style = 'translate(' + x + 'px, ' + y + 'px) rotate(' + (-body.interpolatedAngle * 57.2957795) + 'deg)';
    element.style.transform = style;
    element.style.WebkitTransform = style + ' translateZ(0)'; // Force HW Acceleration
    element.style.MozTransform = style;
    element.style.OTransform = style;
    element.style.msTransform = style;
}

// Animation loop
function animate(time) {
    requestAnimationFrame(animate)


    // Compute elapsed time since last render frame
    const deltaTime = (time - lastTime) / 1000

    // Move bodies forward in time
    world.step(fixedTimeStep, deltaTime, maxSubSteps)

    // updateTransform(mouseBody, document.getElementById("pointer"))

    // console.log(mouseBody.position)

    bodies.forEach(body => {
        updateTransform(body.physics, body.dom)
    });

    lastTime = time
}

// Start the animation loop
requestAnimationFrame(animate)