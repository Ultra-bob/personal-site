import Matter from "matter-js";

// module aliases
const Engine = Matter.Engine,
    Bodies = Matter.Bodies,
    Composite = Matter.Composite;

// create an engine
export const engine = Engine.create();

export class Box {
    element: HTMLDivElement;
    body: Matter.Body;

    constructor(element: HTMLDivElement) {
        this.element = element;
        this.element.style.position = "absolute";
        const rect = element.getBoundingClientRect();
        this.body = Bodies.rectangle(rect.left + rect.width / 2, rect.top + rect.height / 2, rect.width, rect.height);
        Composite.add(engine.world, this.body);
    }

    update() {
        this.element.style.left = `${this.body.position.x - 40}px`;
        this.element.style.top = `${this.body.position.y - 40}px`;
        this.element.style.transform = `rotate(${this.body.angle}rad)`;
    }
}