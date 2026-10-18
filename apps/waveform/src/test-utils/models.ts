import { adsrEnvelope } from '../app/synth/common/modules/adsr-envelope';
import { inputController } from '../app/synth/common/modules/input-controller';
import { oscillator } from '../app/synth/common/modules/oscillator';
import { synth } from '../app/synth/common/modules/synth';
import { synthCore } from '../app/synth/common/modules/synth-core';
import type { LoadWavetable } from '../app/synth/services';
import { initModel } from './model-registry';
import { MessageChannelStub } from './worker-stub';

export { initModel, stopModels } from './model-registry';

// the wavetable oscillator gets a stub channel (jsdom has no MessageChannel): it loads and gets ready
export const createSynthCore = () =>
  initModel(
    synthCore({ wavetables: { createChannel: () => new MessageChannelStub() as unknown as MessageChannel } }),
    'synthCore',
    undefined
  );

export const createInputController = () => initModel(inputController(), 'inputController', undefined);

// the wavetable never loads by default: specs set tables themselves and there is no fetch in jsdom
export const createOscillator = (
  synthCoreModule = createSynthCore(),
  name = 'osc1',
  initial = { active: true, initialWavePath: ['default'] },
  loadWavetable: LoadWavetable = () => new Promise(() => undefined)
) => initModel(oscillator({ synthCore: synthCoreModule, loadWavetable }), name, initial);

export const createAdsrEnvelope = () => initModel(adsrEnvelope(), 'adsr', undefined);

// the whole voice chain: synth core, input, envelope and both oscillators (the loader of their tables: never
// by default)
export const createSynth = (initialWavePath = ['default'], loadWavetable?: LoadWavetable) => {
  const synthCoreModule = createSynthCore();
  const inputControllerModule = createInputController();
  const adsrEnvelopeModule = createAdsrEnvelope();
  const osc1 = createOscillator(synthCoreModule, 'osc1', { active: true, initialWavePath }, loadWavetable);
  const osc2 = createOscillator(synthCoreModule, 'osc2', { active: false, initialWavePath }, loadWavetable);
  const synthModule = initModel(
    synth({
      synthCore: synthCoreModule,
      inputController: inputControllerModule,
      adsrEnvelope: adsrEnvelopeModule,
      oscillator: [osc1, osc2],
    }),
    'synth',
    undefined
  );
  return {
    synthCore: synthCoreModule,
    inputController: inputControllerModule,
    adsrEnvelope: adsrEnvelopeModule,
    osc1,
    osc2,
    synth: synthModule,
  };
};

// an input controller with onPress/onRelease spied, for the controllers that feed it
export const createSpiedInputController = () => {
  const module = createInputController();
  const [, actions] = module;
  const onPress = jest.spyOn(actions as Pick<typeof actions, 'onPress'>, 'onPress');
  const onRelease = jest.spyOn(actions as Pick<typeof actions, 'onRelease'>, 'onRelease');
  return { module, onPress, onRelease };
};
