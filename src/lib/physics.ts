import Matter from "matter-js";

// module aliases
const Engine = Matter.Engine,
    Bodies = Matter.Bodies,
    Composite = Matter.Composite;

// create an engine
const engine = Engine.create();

const boxAElement = document.getElementById("boxA") as HTMLDivElement;
const boxBElement = document.getElementById("boxB") as HTMLDivElement;

// create two boxes and a ground
const boxA = Bodies.rectangle(400, 200, boxAElement.offsetWidth, boxAElement.offsetHeight);
const boxB = Bodies.rectangle(450, 50, boxBElement.offsetWidth, boxBElement.offsetHeight);
const ground = Bodies.rectangle(400, 610, 810, 60, { isStatic: true });

// add all of the bodies to the world
Composite.add(engine.world, [boxA, boxB, ground]);


// Create a main loop
function mainLoop() {
    // run the engine
    Engine.update(engine, 1000 / 60);
    requestAnimationFrame(mainLoop);
    
    // log the position of the boxes
    console.log(`Box A position: x=${boxA.position.x}, y=${boxA.position.y}`);
    console.log(`Box B position: x=${boxB.position.x}, y=${boxB.position.y}`);

    // update the position of the boxes
    boxAElement.style.left = `${boxA.position.x - 40}px`;
    boxAElement.style.top = `${boxA.position.y - 40}px`;

    boxBElement.style.left = `${boxB.position.x - 40}px`;
    boxBElement.style.top = `${boxB.position.y - 40}px`;

    boxAElement.style.transform = `rotate(${boxA.angle}rad)`;
    boxBElement.style.transform = `rotate(${boxB.angle}rad)`;
}

// Start the main loop
mainLoop();