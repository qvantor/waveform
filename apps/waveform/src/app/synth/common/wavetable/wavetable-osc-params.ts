// the names and AudioParams of the wavetable oscillator worklet (wavetable-osc.worklet.ts), shared by the main
// thread, the worklet and the AudioWorkletNode stub of the specs: no imports

// one node per voice plays both oscillators, the store holds the tables of the context
export const VOICE_PROCESSOR = 'waveform-wavetable-voice';
export const STORE_PROCESSOR = 'waveform-wavetable-store';

// the continuous controls of an oscillator, each an AudioParam of the voice node per oscillator (position1,
// position2…): the knob is its own value, envelopes and LFOs add to it through its input
export const OSC_PARAMS = ['position', 'detune', 'spread', 'gain'] as const;
export type OscParam = typeof OSC_PARAMS[number];
export type VoiceParam = 'frequency' | 'gate' | `${OscParam}${1 | 2}`;

// AudioParamDescriptor (not in the dom lib of TypeScript 4.8)
export interface ParamDescriptor {
  name: string;
  defaultValue: number;
  minValue?: number;
  maxValue?: number;
  automationRate: 'a-rate' | 'k-rate';
}

export const oscParamName = (param: OscParam, osc: number): VoiceParam => `${param}${osc === 0 ? 1 : 2}`;

// frequency: Hz of the note (portamento glides it), both oscillators play it; gate: 1 while the note plays,
// 0 stops it at that sample (the end of its release), below 0 fades it out (a stolen voice): automated with
// setValueAtTime, exact to the sample, a message would arrive whenever the audio thread takes it; position:
// share of the table
// (frame k of N at k / (N - 1)); detune: cents (1200 · octave + pitch modulation); spread: cents from the lowest
// unison voice to the highest; gain: linear. The browser clamps base + modulation to min/max, the processor
// clamps the pitch of a voice to 0..nyquist
const oscDescriptors = (osc: number): ParamDescriptor[] => [
  {
    name: oscParamName('position', osc),
    defaultValue: 0,
    minValue: 0,
    maxValue: 1,
    automationRate: 'a-rate',
  },
  { name: oscParamName('detune', osc), defaultValue: 0, automationRate: 'a-rate' },
  { name: oscParamName('spread', osc), defaultValue: 0, minValue: 0, automationRate: 'a-rate' },
  { name: oscParamName('gain', osc), defaultValue: 0.5, automationRate: 'a-rate' },
];

export const VOICE_PARAMETERS: ParamDescriptor[] = [
  { name: 'frequency', defaultValue: 440, minValue: 0, automationRate: 'a-rate' },
  { name: 'gate', defaultValue: 1, automationRate: 'a-rate' },
  ...oscDescriptors(0),
  ...oscDescriptors(1),
];
