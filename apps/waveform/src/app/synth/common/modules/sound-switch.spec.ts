import { createFx, createSynth, initModel, stopModels } from '../../../../test-utils/models';
import { voiceEvents } from '../../../../test-utils/voice-events';
import { soundSwitch } from './sound-switch';

// the wavetable oscillator loads its module asynchronously
const flush = () => new Promise((resolve) => setTimeout(resolve));

const setup = async ({ running = true } = {}) => {
  const modules = createSynth();
  const [{ audioCtx, fxOut, wavetables, masterLimiter }] = modules.synthCore;
  const fx = createFx(modules.synthCore).fx;
  await flush();
  jest.useFakeTimers();
  // the clock of the context, moved by the spec
  let now = 1;
  Object.defineProperty(audioCtx, 'currentTime', { get: () => now, configurable: true });
  Object.defineProperty(audioCtx, 'state', {
    get: () => (running ? 'running' : 'suspended'),
    configurable: true,
  });
  const synthActions = modules.synth[1] as Pick<typeof modules.synth[1], 'pause' | 'resume'>;
  // the voices of the notes played; the voices node tells one has ended
  const { voices, end } = voiceEvents(audioCtx, wavetables);
  const [, { onPress }] = modules.inputController;
  const pause = jest.spyOn(synthActions, 'pause');
  const resume = jest.spyOn(synthActions, 'resume');
  const clear = jest.spyOn(fx[1] as Pick<typeof fx[1], 'clear'>, 'clear');
  const clearLimiter = jest.spyOn(masterLimiter, 'clear');
  const [osc1, osc2] = [modules.osc1[0], modules.osc2[0]];
  // the tables of both oscillators in the store (createSynth loads none: a loader that never resolves)
  [osc1, osc2].forEach(({ $waveTableLoading }) => $waveTableLoading.next(false));
  wavetables.$tables.next({ [osc1.id]: 'stored', [osc2.id]: 'stored' });
  const [, { switchSound }] = initModel(
    soundSwitch({
      synthCore: modules.synthCore,
      synth: modules.synth,
      fx,
      oscillator: [modules.osc1, modules.osc2],
    }),
    'soundSwitch',
    undefined
  );
  // the context renders up to `time`, the poll sees it after `ms`
  const render = (time: number, ms = 10) => {
    now = time;
    jest.advanceTimersByTime(ms);
  };
  const gain = fxOut.gain as unknown as Record<
    'cancelScheduledValues' | 'setValueAtTime' | 'linearRampToValueAtTime',
    jest.Mock
  >;
  // the order of the last call of a method of the gain among all the mocks
  const last = (method: keyof typeof gain) => gain[method].mock.invocationCallOrder.at(-1) ?? 0;
  // the output opened again: a step to 1 after the ramp to 0
  const opened = () => last('setValueAtTime') > last('linearRampToValueAtTime');
  return {
    switchSound,
    onPress,
    voices,
    end,
    osc1,
    osc2,
    wavetables,
    gain,
    last,
    pause,
    resume,
    clear,
    clearLimiter,
    render,
    opened,
  };
};

afterEach(() => jest.useRealTimers());

describe('soundSwitch', () => {
  it('fades the output out and pauses the voices, applies the preset once the fade is rendered', async () => {
    const { switchSound, gain, pause, clear, clearLimiter, render, opened } = await setup();
    const apply = jest.fn();

    switchSound(apply);

    expect(gain.cancelScheduledValues).toHaveBeenLastCalledWith(1);
    expect(gain.setValueAtTime).toHaveBeenLastCalledWith(1, 1);
    expect(gain.linearRampToValueAtTime).toHaveBeenLastCalledWith(0, 1.02);
    expect(pause).toHaveBeenCalledTimes(1);
    render(1.01);
    expect(apply).not.toHaveBeenCalled();
    expect(clear).not.toHaveBeenCalled();

    render(1.02);
    expect(apply).toHaveBeenCalledTimes(1);
    // after it: the delay makes its nodes at the knobs of the preset, from those before Time would glide
    expect(clear.mock.invocationCallOrder[0]).toBeGreaterThan(apply.mock.invocationCallOrder[0]);
    expect(clearLimiter.mock.invocationCallOrder[0]).toBeGreaterThan(apply.mock.invocationCallOrder[0]);
    expect(opened()).toBe(false);
  });

  it('applies the preset once the voices it faded out have ended: their processors see the gate late', async () => {
    const { switchSound, onPress, voices, end, render } = await setup();
    onPress([4, 'C']);
    onPress([4, 'E']);
    const apply = jest.fn();
    switchSound(apply);
    render(1.03);
    expect(apply).not.toHaveBeenCalled();
    end(voices()[0]);
    render(1.035);
    expect(apply).not.toHaveBeenCalled();
    end(voices()[1]);
    render(1.04);
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it('a voice that never ends is waited for 200 ms at most', async () => {
    const { switchSound, onPress, render } = await setup();
    onPress([4, 'C']);
    const apply = jest.fn();
    switchSound(apply);
    render(1.1, 180);
    expect(apply).not.toHaveBeenCalled();
    render(1.2, 30);
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it('opens the output after the clear messages reached the worklets, then the keys start on the preset', async () => {
    const { switchSound, gain, last, resume, render, opened } = await setup();
    switchSound(jest.fn());
    render(1.02);
    render(1.025);
    expect(opened()).toBe(false);
    expect(resume).not.toHaveBeenCalled();

    render(1.03);

    expect(opened()).toBe(true);
    expect(gain.setValueAtTime).toHaveBeenLastCalledWith(1, 1.03);
    expect(gain.cancelScheduledValues).toHaveBeenLastCalledWith(1.03);
    // at once: nothing sounds before it, a fade would take the attacks of the keys
    expect(resume.mock.invocationCallOrder[0]).toBeGreaterThan(last('setValueAtTime'));
    // over: the next preset fades out again
    switchSound(jest.fn());
    expect(gain.linearRampToValueAtTime).toHaveBeenCalledTimes(2);
  });

  it('a preset chosen during the fade replaces the one waiting for it', async () => {
    const { switchSound, pause, render } = await setup();
    const [first, second] = [jest.fn(), jest.fn()];
    switchSound(first);
    switchSound(second);
    render(1.02);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    expect(pause).toHaveBeenCalledTimes(1);
  });

  it('a preset chosen while silent is applied at once, the wait starts again', async () => {
    const { switchSound, osc1, clear, resume, render, opened } = await setup();
    switchSound(jest.fn());
    render(1.02);
    // the next one loads a table
    const next = jest.fn(() => osc1.$waveTableLoading.next(true));

    switchSound(next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(clear).toHaveBeenCalledTimes(2);
    render(1.1);
    expect(opened()).toBe(false);
    osc1.$waveTableLoading.next(false);
    render(1.11);
    expect(opened()).toBe(true);
    expect(resume).toHaveBeenCalledTimes(1);
  });

  it('stays silent until the tables of the oscillators on are in the store', async () => {
    const { switchSound, osc1, wavetables, render, opened } = await setup();
    switchSound(() => osc1.$waveTableLoading.next(true));
    render(1.02);
    render(1.2);
    expect(opened()).toBe(false);
    // loaded: its frames go to the worker, the store hasn't answered yet
    osc1.$waveTableLoading.next(false);
    wavetables.$tables.next({ ...wavetables.$tables.value, [osc1.id]: 'sending' });
    render(1.3);
    expect(opened()).toBe(false);

    wavetables.$tables.next({ ...wavetables.$tables.value, [osc1.id]: 'refused' });
    render(1.31);
    // refused (or failed): the version before plays
    expect(opened()).toBe(true);
  });

  it('an oscillator that is off is not waited for', async () => {
    const { switchSound, osc2, render, opened } = await setup();
    expect(osc2.$active.value).toBe(false);
    switchSound(() => osc2.$waveTableLoading.next(true));
    render(1.02);
    render(1.03);
    expect(opened()).toBe(true);
  });

  it('a table that never comes keeps it silent for MAX_SILENCE at most', async () => {
    const { switchSound, osc1, resume, render, opened } = await setup();
    switchSound(() => osc1.$waveTableLoading.next(true));
    render(1.02);
    render(2, 1980);
    expect(opened()).toBe(false);
    render(2, 20);
    expect(opened()).toBe(true);
    expect(resume).toHaveBeenCalledTimes(1);
  });

  it('a clock that does not move (an iOS interruption) is waited for 200 ms at most', async () => {
    const { switchSound, render } = await setup();
    const apply = jest.fn();
    switchSound(apply);
    render(1, 190);
    expect(apply).not.toHaveBeenCalled();
    render(1, 10);
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it('a clock that stands after the preset is applied is waited for 200 ms at most too', async () => {
    const { switchSound, resume, render, opened } = await setup();
    switchSound(jest.fn());
    render(1.02);
    // the clock stands from here on
    render(1.02, 190);
    expect(opened()).toBe(false);
    render(1.02, 10);
    expect(opened()).toBe(true);
    expect(resume).toHaveBeenCalledTimes(1);
  });

  it('a preset that throws still forgets the sound before and opens the output, its error goes on', async () => {
    const { switchSound, gain, clear, clearLimiter, resume, render, opened } = await setup();
    const error = new Error('broken preset');
    switchSound(() => {
      throw error;
    });

    expect(() => render(1.02)).toThrow(error);

    expect(clear).toHaveBeenCalledTimes(1);
    expect(clearLimiter).toHaveBeenCalledTimes(1);
    render(1.03);
    expect(opened()).toBe(true);
    expect(resume).toHaveBeenCalledTimes(1);
    // over: the next preset fades out again
    switchSound(jest.fn());
    expect(gain.linearRampToValueAtTime).toHaveBeenCalledTimes(2);
  });

  it('a preset that throws while silent: the error reaches its caller, the output opens all the same', async () => {
    const { switchSound, clear, resume, render, opened } = await setup();
    switchSound(jest.fn());
    render(1.02);
    const error = new Error('broken preset');

    expect(() =>
      switchSound(() => {
        throw error;
      })
    ).toThrow(error);

    expect(clear).toHaveBeenCalledTimes(2);
    render(1.03);
    expect(opened()).toBe(true);
    expect(resume).toHaveBeenCalledTimes(1);
  });

  it('a context that does not run is not waited for: applied and opened at once', async () => {
    const { switchSound, pause, resume, opened } = await setup({ running: false });
    const apply = jest.fn();
    switchSound(apply);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(opened()).toBe(true);
    expect(resume).toHaveBeenCalledTimes(1);
    // over: the next one pauses again
    switchSound(jest.fn());
    expect(pause).toHaveBeenCalledTimes(2);
  });

  it('stopped, it waits for nothing', async () => {
    const { switchSound, render } = await setup();
    const apply = jest.fn();
    switchSound(apply);
    stopModels();
    render(1.1);
    expect(apply).not.toHaveBeenCalled();
  });
});
