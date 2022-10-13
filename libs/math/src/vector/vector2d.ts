import React from 'react';

export type Vector2D = [number, number];

const fromValues = (x: number, y: number): Vector2D => [x, y];

const fromMouseEvent = (e: MouseEvent | React.MouseEvent): Vector2D => [
  e.clientX,
  e.clientY,
];

const subtract = (a: Vector2D, b: Vector2D): Vector2D => [
  a[0] - b[0],
  a[1] - b[1],
];

const invertY = (a: Vector2D): Vector2D => [a[0], -a[1]];

const abs = (a: Vector2D): Vector2D => [Math.abs(a[0]), Math.abs(a[1])];

const getBigger = (a: Vector2D) => {
  const [x, y] = abs(a);
  return x > y ? a[0] : a[1];
};

export const vector2d = {
  fromMouseEvent,
  subtract,
  abs,
  getBigger,
  invertY,
  fromValues,
};
