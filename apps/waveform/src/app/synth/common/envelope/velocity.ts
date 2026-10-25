import { curveShape } from './envelope-curve';

// the velocity of a note: MIDI 1..127 (a note on of 0 is a note off)
export const MAX_VELOCITY = 127;

// the share of the velocity, VELO on a line: 1/127 .. 1
export const velocityShare = (velocity: number) => velocity / MAX_VELOCITY;

// VELO, the level of the velocity as a source of the routes: its share curved by k (curveShape, 0 a line)
export const velocityLevel = (k: number, velocity: number) => curveShape(k, velocityShare(velocity));

// the volume of a note after ENV 1: Amp of it follows VELO (0: none, 1: VELO itself)
export const velocityAmp = (amp: number, level: number) => 1 - amp + amp * level;
