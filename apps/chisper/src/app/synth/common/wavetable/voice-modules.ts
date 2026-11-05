import type { KnobsModule, VoiceModuleKnobs } from './voice-options';

// the modules of a voice whose knobs the routes move, in the order of their ids in the core (targets.rs of
// dsp/wavetable-osc): knob k of instance i of a module has the id of the first knob of the module + i · its knobs +
// k, so a new module goes last and the ids of the others never move (voice-modules.spec compares the table with the
// core). `name`: a route to a knob on the wire (VoiceRoute.param, as the app names them)
export const VOICE_MODULES = [
  {
    module: 'osc',
    instances: 2,
    knobs: ['position', 'spread', 'gain', 'pitch', 'fine', 'blend'],
    name: (knob: string, instance: number) => `${knob}${instance + 1}`,
  },
  {
    module: 'filter',
    instances: 1,
    knobs: ['cutoff', 'resonance', 'gain'],
    name: (knob: string) => knob,
  },
  {
    module: 'noise',
    instances: 1,
    knobs: ['level', 'pan', 'pitch', 'fine'],
    name: (knob: string) => `noise.${knob}`,
  },
  {
    module: 'lfo',
    instances: 4,
    knobs: ['rate', 'delay', 'rise', 'smooth', 'phase'],
    name: (knob: string, instance: number) => `lfo${instance + 1}.${knob}`,
  },
] as const;

export type VoiceModule = (typeof VOICE_MODULES)[number]['module'];
type ModuleOf<M extends VoiceModule> = Extract<(typeof VOICE_MODULES)[number], { module: M }>;
export type VoiceModuleKnob<M extends VoiceModule> = ModuleOf<M>['knobs'][number];

// the id of each module in the core (its index in the table)
export const MODULE_IDS = Object.fromEntries(VOICE_MODULES.map(({ module }, id) => [module, id])) as Record<
  VoiceModule,
  number
>;

const moduleOf = <M extends VoiceModule>(module: M) => VOICE_MODULES[MODULE_IDS[module]] as ModuleOf<M>;

// the name of a route to knob `knob` of instance `instance` of `module`
export const routeParam = <M extends VoiceModule>(module: M, instance: number, knob: VoiceModuleKnob<M>) =>
  moduleOf(module).name(knob, instance);

// the id of the knob of each name in the core (the names in the order of their ids)
export const ROUTE_IDS: Readonly<Record<string, number>> = Object.fromEntries(
  VOICE_MODULES.flatMap(({ instances, knobs, name }) =>
    Array.from({ length: instances }, (_, instance) =>
      knobs.map((knob: string) => name(knob, instance))
    ).flat()
  ).map((route, id) => [route, id])
);

// the values of a `knobs` event of a module in the order the core takes them (Source::set_knobs of its source): the
// knobs no param of the voice carries
export const KNOB_ORDER: { [M in KnobsModule]: readonly (keyof VoiceModuleKnobs[M])[] } = {
  noise: ['level', 'pan', 'cents'],
};
