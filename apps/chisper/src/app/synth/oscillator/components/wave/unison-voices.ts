import { isCentreVoice, voiceLevel } from '../../../common/wavetable/unison-levels';
import type { UnisonDetune, UnisonShape, UnisonStack } from '../../../common/wavetable/voice-options';

// the voices of the unison of an oscillator as its voice plays them (voice.rs of dsp/wavetable-osc): what the chart
// shows while Detune or Blend is turned

export interface UnisonVoice {
  // cents from the note: its share of the spread by the detune mode, plus its stack
  cents: number;
  // the cents its stack moves it by (0 without one)
  stack: number;
  // in its channel against one voice alone (voiceLevel: up to 1.1)
  amplitude: number;
  // a centre voice: the middle one of an odd count, the middle two of an even one
  isCenter: boolean;
}

// the share of the spread of voice v of n (-0.5..0.5), of x = 2v / (n - 1) - 1 by the detune mode (detune_share);
// a random one draws its shares at every note on: shown evenly
const shareOf = (detune: UnisonDetune, v: number, n: number) => {
  const x = (2 * v) / (n - 1) - 1;
  switch (detune) {
    case 'super':
      return Math.tan(x) / Math.tan(1) / 2;
    case 'exp':
      return (x * Math.abs(x)) / 2;
    case 'inv':
      return Math.sin((x * Math.PI) / 2) / 2;
    default:
      return v / (n - 1) - 0.5;
  }
};

// the octaves k of a stack: 12 (kx), 12+7 ((k + 1)x)
const STACK_OCTAVES: Partial<Record<UnisonStack, number>> = {
  '12x1': 1,
  '12x2': 2,
  '12x3': 3,
  '12+7x2': 1,
  '12+7x3': 2,
};
const CENTRE_STACKS: Partial<Record<UnisonStack, number>> = { 'center-12': -12, 'center-24': -24 };

// the semitones a stack moves voice v of n by (stack_semitones): at d = v - floor(n / 2) from the middle, the
// centre (d 0, and -1 of an even count) only by the centre stacks, a single voice too; the others by a = |d|:
// 12·(a mod (k + 1)) of its octaves, a 12+7 one 7 more at a mod 4 = 2
const stackSemitones = (stack: UnisonStack, v: number, n: number) => {
  const d = v - Math.floor(n / 2);
  if (d === 0 || (n % 2 === 0 && d === -1)) return CENTRE_STACKS[stack] ?? 0;
  const a = Math.abs(d);
  const k = STACK_OCTAVES[stack];
  const fifth = stack.startsWith('12+7') && a % 4 === 2 ? 7 : 0;
  return fifth + (k === undefined ? 0 : 12 * (a % (k + 1)));
};

// the voices of a unison of `unison` at a spread (cents) and a blend, from the lowest; one at no spread unless a
// route raises it (`raised`: the voice keeps them for it), a stack or a position spread keeps them
export const unisonVoices = (
  unison: number,
  spread: number,
  blend: number,
  { detune, stack, positionSpread }: Pick<UnisonShape, 'detune' | 'stack' | 'positionSpread'>,
  raised = false
): UnisonVoice[] => {
  const one = spread <= 0 && !raised && stack === 'off' && positionSpread === 0;
  const n = one ? 1 : Math.min(8, Math.max(1, Math.round(unison)));
  return Array.from({ length: n }, (_, v) => {
    const cents = 100 * stackSemitones(stack, v, n);
    return {
      cents: (n === 1 ? 0 : spread * shareOf(detune, v, n)) + cents,
      stack: cents,
      amplitude: voiceLevel(v, n, blend),
      isCenter: isCentreVoice(v, n),
    };
  });
};
