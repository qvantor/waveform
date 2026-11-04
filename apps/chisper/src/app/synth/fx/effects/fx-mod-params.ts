import type { LfosState } from '../../common/lfo/lfo-curve';
import type { FxNote, FxRoute } from './fx-modulation';

// the lines of the fx-mod worklet (fx-mod.worklet.ts) and its messages, shared by the main thread, the worklet and
// the specs: no imports but types. Each line is an output of one channel added to the AudioParams of a knob of
// the native nodes (the delay, the mix of every slot): the offset its routes move the param by from the knob,
// map(the knob moved) - map(the knob), the param itself stays at the knob with its glides

// the knobs of the delay (the feedback on the gains of a line into itself and on those into the other one, pan on
// the delay of each side), then the dry and the wet gain of each slot in the order of FX_TYPES
export const DELAY_LINES = { time: 0, fb: 1, fbX: 2, panL: 3, panR: 4, freq: 5, q: 6 } as const;
export const SLOT_LINES = 7;
export const FX_MOD_LINES = SLOT_LINES + 2 * 3;
export const slotLines = (slot: number) => ({ dry: SLOT_LINES + 2 * slot, wet: SLOT_LINES + 2 * slot + 1 });

// how a knob maps to its param: as it is, the delay of the side of a pan (L: below 0, R: above), the dry and the wet
// gain of a mix (equal power, or linear: mixGains)
export type FxModMap = 'linear' | 'panL' | 'panR' | 'dry' | 'wet' | 'dryLinear' | 'wetLinear';

// [dry, wet] gains of the mix (0: only dry, 1: only wet). Equal power: both at -3 dB at 0.5, the level stays
// flat when wet and dry are unrelated (echoes, reverb); linear: both at -6 dB, for a wet signal in time with
// the dry one (FxCore.linearMix), where equal power would be 3 dB louder
export const mixGains = (mix: number, linear = false): [number, number] =>
  linear ? [1 - mix, mix] : [Math.cos((mix * Math.PI) / 2), Math.sin((mix * Math.PI) / 2)];

export const mapKnob = (map: FxModMap, value: number) => {
  if (map === 'panL') return Math.max(0, value);
  if (map === 'panR') return Math.max(0, -value);
  if (map === 'dry') return Math.cos((value * Math.PI) / 2);
  if (map === 'wet') return Math.sin((value * Math.PI) / 2);
  if (map === 'dryLinear') return 1 - value;
  return value;
};

// a line: the routes of its knob (of one param: the range of the first), the knob, its map
export interface FxModLine {
  routes: FxRoute[];
  base: number;
  map: FxModMap;
}

// main thread → worklet, in order: a line (null: none, its offset goes to 0), the last note (null: none), the
// routes of the note to the knobs of the LFOs, the LFOs
export interface FxModMessage {
  line?: [number, FxModLine | null];
  note?: FxNote | null;
  knobRoutes?: FxRoute[];
  lfos?: LfosState;
  stop?: boolean;
}

// the node options: the lines, the note, the routes and the LFOs as they are when it is made
export interface FxModOptions {
  lines: (FxModLine | null)[];
  note: FxNote | null;
  knobRoutes: FxRoute[];
  lfos: LfosState | null;
}
