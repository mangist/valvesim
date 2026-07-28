/**
 * Type declarations for Verly.js (github:anuraghazra/Verly.js).
 *
 * The package ships untyped ES-module source under /src. We import the
 * physics primitives (Vector, Point, Stick) directly rather than the
 * full engine, since rendering is done by PixiJS, not canvas 2D.
 */

declare module 'verlyjs/src/Vector.js' {
  export default class Vector {
    x: number;
    y: number;
    constructor(x?: number, y?: number);
    add(v: Vector | number): Vector;
    sub(v: Vector | number): Vector;
    mult(v: Vector | number): Vector;
    div(v: Vector | number): Vector;
    setXY(x: number, y: number): Vector;
    dist(v: Vector): number;
    mag(): number;
    magSq(): number;
    static add(v1: Vector, v2: Vector): Vector;
    static sub(v1: Vector, v2: Vector): Vector;
  }
}

declare module 'verlyjs/src/Point.js' {
  import Vector from 'verlyjs/src/Vector.js';

  /** Verlet point. `update()` reads `WIDTH`/`HEIGHT` from the passed engine-like object. */
  export default class Point {
    pos: Vector;
    oldpos: Vector;
    pinned: boolean;
    mass: number;
    friction: number;
    gravity: Vector;
    radius: number;
    sticks: unknown[];
    constructor(x: number, y: number, vx?: number, vy?: number, radius?: number);
    setGravity(g: Vector): Point;
    setFriction(f: number): Point;
    setMass(m: number): Point;
    pin(): Point;
    unpin(): Point;
    resetVelocity(): void;
    applyForce(f: Vector): void;
    update(verlyInstance: { WIDTH: number; HEIGHT: number }): void;
    constrain(verlyInstance: { WIDTH: number; HEIGHT: number }): void;
  }
}

declare module 'verlyjs/src/Stick.js' {
  import Point from 'verlyjs/src/Point.js';

  /** Distance constraint between two verlet points. */
  export default class Stick {
    startPoint: Point;
    endPoint: Point;
    length: number;
    stiffness: number;
    constructor(p1: Point, p2: Point, length?: number, stiffness?: number, hidden?: boolean);
    setLength(length: number): Stick;
    setStiffness(value: number): Stick;
    update(stepCoef?: number): void;
  }
}
