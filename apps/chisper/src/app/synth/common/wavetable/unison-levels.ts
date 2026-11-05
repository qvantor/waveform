// the levels of the voices of a unison as the core plays them (voice.rs of dsp/wavetable-osc: UNISON_LEVELS,
// CENTRE_PAN, blend_gains): those of the reference AU (dsp/measurements/blend.json)

// a voice of a unison of n against one alone: of 2 (no blend), of 3..8 one hard left or right of the centre at the
// blend 0
const UNISON_LEVELS = [1, 0.8077, 1.1041, 1.0738, 1.0416, 1.0126, 0.9841, 0.95426];
// the middle voice of an odd count of 3 or more in each channel against one hard left or right (-8.02 dB)
const CENTRE_PAN = 0.39718;

// the gains of the centre voices and of the others at a blend against the centre at 0: 1 - 0.5549·b² and
// 0.04453 + 1.2887·b² - 0.74024·b⁴ (the others 27 dB under the centre at 0, as loud at 0.86)
export const blendGains = (blend: number): [number, number] => {
  const b = Math.min(1, Math.max(0, blend));
  const b2 = b * b;
  return [1 - 0.554903 * b2, 0.0445334 + b2 * (1.28871 - 0.740236 * b2)];
};

// the centre of a unison of n: the middle one of an odd count, the middle two of an even one
export const isCentreVoice = (v: number, n: number) => Math.floor(Math.abs(v - (n - 1) / 2)) === 0;

// voice v of a unison of n (from the lowest) at a blend in each of its channels, against one voice alone (a unison
// of 1 or 2 is all centre, at its level whatever the blend)
export const voiceLevel = (v: number, n: number, blend: number) => {
  const centre = isCentreVoice(v, n);
  const [center, side] = n > 2 ? blendGains(blend) : [1, 1];
  const pan = centre && n > 1 && n % 2 === 1 ? CENTRE_PAN : 1;
  return UNISON_LEVELS[n - 1] * (centre ? center : side) * pan;
};

// the share of the two channels voice v of n is in: the middle one of an odd count both, the others one each
const channelShare = (v: number, n: number) => (n % 2 === 1 && v === (n - 1) / 2 ? 1 : 0.5);

const sumOfVoices = (n: number, blend: number, power: number) =>
  Array.from({ length: n }, (_, v) => voiceLevel(v, n, blend) ** power * channelShare(v, n)).reduce(
    (a, b) => a + b
  );

// the power of a unison of n at a blend (over both channels, its voices at phases of their own) against one voice
export const unisonPower = (n: number, blend: number) => sumOfVoices(n, blend, 2);

// the level of each channel of a unison of n at a blend with all its voices in phase, against one voice
export const unisonPeak = (n: number, blend: number) => sumOfVoices(n, blend, 1);
