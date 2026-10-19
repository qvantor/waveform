import { BehaviorSubject } from 'rxjs';
import { envelopes } from '../app/synth/common/modules/envelopes';
import { modulation } from '../app/synth/common/modules/modulation';
import { filter } from '../app/synth/filter/modules/filter';
import { fx } from '../app/synth/fx/modules/fx';
import type { SynthModule } from '../app/synth/common/modules/synth';
import type { FxNote } from '../app/synth/fx/effects/fx-modulation';
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

export const createEnvelopes = () => initModel(envelopes(), 'env', undefined);

export const createModulation = () => initModel(modulation(), 'mod', undefined);

// the whole voice chain: synth core, input, envelopes, modulation, both oscillators and the filter (the loader
// of their tables: never by default)
export const createSynth = (initialWavePath = ['default'], loadWavetable?: LoadWavetable) => {
  const synthCoreModule = createSynthCore();
  const inputControllerModule = createInputController();
  const envelopesModule = createEnvelopes();
  const modulationModule = createModulation();
  const osc1 = createOscillator(synthCoreModule, 'osc1', { active: true, initialWavePath }, loadWavetable);
  const osc2 = createOscillator(synthCoreModule, 'osc2', { active: false, initialWavePath }, loadWavetable);
  const filterModule = initModel(filter({ synthCore: synthCoreModule }), 'filter', undefined);
  const synthModule = initModel(
    synth({
      synthCore: synthCoreModule,
      inputController: inputControllerModule,
      envelopes: envelopesModule,
      modulation: modulationModule,
      oscillator: [osc1, osc2],
      filter: filterModule,
    }),
    'synth',
    undefined
  );
  return {
    synthCore: synthCoreModule,
    inputController: inputControllerModule,
    envelopes: envelopesModule,
    modulation: modulationModule,
    filter: filterModule,
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

// the fx model with the routes of a modulation model and the last note of the synth: a subject the spec drives
export const createFx = (synthCoreModule = createSynthCore(), modulationModule = createModulation()) => {
  const $fxNote = new BehaviorSubject<FxNote | null>(null);
  const synthModule = [{ $fxNote }, {}] as unknown as SynthModule;
  const fxModule = initModel(
    fx({ synthCore: synthCoreModule, synth: synthModule, modulation: modulationModule }),
    'fx',
    undefined
  );
  return { fx: fxModule, modulation: modulationModule, $fxNote };
};
