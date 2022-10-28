import React from 'react';

export type Vector2D = [number, number];

const fromValues = (x: number, y?: number): Vector2D => (y !== undefined ? [x, y] : [x, x]);

const fromMouseEvent = (e: MouseEvent | React.MouseEvent): Vector2D => [e.clientX, e.clientY];

const subtract = (a: Vector2D, b: Vector2D): Vector2D => [a[0] - b[0], a[1] - b[1]];

const invertY = (a: Vector2D): Vector2D => [a[0], -a[1]];

const abs = (a: Vector2D): Vector2D => [Math.abs(a[0]), Math.abs(a[1])];

const addition = (a: Vector2D): number => a[0] + a[1];

const isEqual = (a: Vector2D, b: Vector2D) => a[0] === b[0] && a[1] === b[1];

export const vector2d = {
  fromMouseEvent,
  subtract,
  addition,
  abs,
  invertY,
  fromValues,
  isEqual,
};
