import { mapValues } from 'lodash';
import { FX_MIX_PARAM, FX_PARAMS } from '@waveform/preset-schema';
import { FxPreset } from './types';

export type DelayParam = keyof typeof FX_PARAMS.delay;

const NORMAL = 0;
const PING_PONG = 1;

// tempo-synced times are at 120 bpm (1/8 = 250ms)
export const DELAY_PRESETS: FxPreset<DelayParam>[] = [
  // the schema defaults, the state of a freshly added effect
  {
    id: 'default',
    name: 'Default',
    mix: FX_MIX_PARAM.default,
    params: mapValues(FX_PARAMS.delay, (param) => param.default),
  },
  {
    id: 'slapback',
    name: 'Slapback',
    mix: 0.3,
    params: { mode: NORMAL, time: 0.09, fb: 0.1, pan: 0, freq: 2500, q: 0.3 },
  },
  {
    id: 'doubler',
    name: 'Doubler',
    mix: 0.4,
    params: { mode: NORMAL, time: 0.02, fb: 0, pan: 0.015, freq: 4000, q: 0.1 },
  },
  {
    id: 'ping-pong-8th',
    name: 'Ping-pong 1/8',
    mix: 0.3,
    params: { mode: PING_PONG, time: 0.25, fb: 0.45, pan: 0, freq: 2000, q: 0.2 },
  },
  {
    id: 'dotted-8th',
    name: 'Dotted 1/8',
    mix: 0.25,
    params: { mode: NORMAL, time: 0.375, fb: 0.4, pan: 0.01, freq: 1800, q: 0.3 },
  },
  {
    id: 'tape-echo',
    name: 'Tape echo',
    mix: 0.3,
    params: { mode: NORMAL, time: 0.33, fb: 0.55, pan: 0, freq: 1200, q: 0.8 },
  },
  {
    id: 'dub',
    name: 'Dub',
    mix: 0.35,
    params: { mode: PING_PONG, time: 0.5, fb: 0.75, pan: 0, freq: 800, q: 1.2 },
  },
  {
    id: 'ambient-wash',
    name: 'Ambient wash',
    mix: 0.4,
    params: { mode: PING_PONG, time: 0.6, fb: 0.85, pan: 0.03, freq: 3000, q: 0.05 },
  },
  {
    id: 'lo-fi',
    name: 'Lo-fi',
    mix: 0.35,
    params: { mode: NORMAL, time: 0.16, fb: 0.5, pan: 0, freq: 1500, q: 2.5 },
  },
  {
    id: 'flutter',
    name: 'Flutter',
    mix: 0.25,
    params: { mode: NORMAL, time: 0.03, fb: 0.8, pan: 0, freq: 5000, q: 0.5 },
  },
];
