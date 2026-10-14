import { adsrEnvelope } from '../app/synth/common/modules/adsr-envelope';
import { inputController } from '../app/synth/common/modules/input-controller';
import { oscillator } from '../app/synth/common/modules/oscillator';
import { synth } from '../app/synth/common/modules/synth';
import { synthCore } from '../app/synth/common/modules/synth-core';
import type { LoadWavetable } from '../app/synth/services';
import { initModel } from './model-registry';

export { initModel, stopModels } from './model-registry';

export const createSynthCore = () => initModel(synthCore(), 'synthCore', undefined);

export const createInputController = () => initModel(inputController(), 'inputController', undefined);

// the wavetable never loads by default: specs set tables themselves and there is no fetch in jsdom
export const createOscillator = (
  synthCoreModule = createSynthCore(),
  name = 'osc1',
  initial = { active: true, initialWavePath: ['default'] },
  loadWavetable: LoadWavetable = () => new Promise(() => undefined)
) => initModel(oscillator({ synthCore: synthCoreModule, loadWavetable }), name, initial);

export const createAdsrEnvelope = () => initModel(adsrEnvelope(), 'adsr', undefined);

// the whole voice chain: synth core, input, envelope and both oscillators
export const createSynth = () => {
  const synthCoreModule = createSynthCore();
  const inputControllerModule = createInputController();
  const adsrEnvelopeModule = createAdsrEnvelope();
  const osc1 = createOscillator(synthCoreModule, 'osc1');
  const osc2 = createOscillator(synthCoreModule, 'osc2', { active: false, initialWavePath: ['default'] });
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
