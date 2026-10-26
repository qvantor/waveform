import React from 'react';
import { BehaviorSubject } from 'rxjs';
import { act, render } from '@testing-library/react';
import { NoteDot, NotePath } from '@waveform/ui-kit';
import { EnvelopeId } from '@waveform/preset-schema';
import { ModulationContext } from '../../common/modules/modulation';
import { SynthContext, SynthModule } from '../../common/modules/synth';
import { SynthCoreContext } from '../../common/modules/synth-core';
import type { FxNote } from '../../fx/effects/fx-modulation';
import type { EnvelopeParams } from '../../common/envelope/envelope-curve';
import { createModulation } from '../../../../test-utils/models';
import { EnvelopeDot } from './envelope-dot';

jest.mock('@waveform/ui-kit', () => ({
  ...jest.requireActual('@waveform/ui-kit'),
  NoteDot: jest.fn(() => null),
}));

const env = (sustain: number) => ({ attack: 0.25, hold: 0, decay: 0.25, sustain, release: 1 });

// the dot of envelope `id` on the chart of `envelope` with the last note of the synth, the routes of the
// modulation and the clock of the core: the output plays 1 s of the context at 2000 ms
const setup = (id: EnvelopeId, envelope = env(0.8)) => {
  const modulation = createModulation();
  const $fxNote = new BehaviorSubject<FxNote | null>(null);
  const synth = [{ $fxNote }, {}] as unknown as SynthModule;
  const getOutputTimestamp = jest.fn(() => ({ contextTime: 1, performanceTime: 2000 }));
  const core = [{ audioCtx: { currentTime: 1, getOutputTimestamp } }, {}] as never;
  const chart = (chartEnv: EnvelopeParams) => (
    <SynthCoreContext.Provider value={core}>
      <SynthContext.Provider value={synth}>
        <ModulationContext.Provider value={modulation}>
          <EnvelopeDot id={id} env={chartEnv} />
        </ModulationContext.Provider>
      </SynthContext.Provider>
    </SynthCoreContext.Provider>
  );
  const { rerender } = render(chart(envelope));
  const props = () => (NoteDot as jest.Mock).mock.lastCall?.[0] as { path: NotePath | null };
  const envelopes = [env(0.1), env(0.2), env(0.3)];
  const play = (release: number | null = null, velocity?: number) =>
    act(() =>
      $fxNote.next({
        envelopes,
        start: 1.5,
        release,
        ...(velocity !== undefined && { velo: velocity, velocity }),
      })
    );
  const turn = (chartEnv: EnvelopeParams) => rerender(chart(chartEnv));
  return { modulation, props, play, turn, getOutputTimestamp };
};

describe('EnvelopeDot', () => {
  afterEach(() => (NoteDot as jest.Mock).mockClear());

  it('draws nothing again for a note at another velocity on the same envelopes (a note of a legato phrase)', () => {
    const { props, play } = setup('env1');
    play(null, 0.4);
    const path = props().path;
    const renders = (NoteDot as jest.Mock).mock.calls.length;
    play(null, 0.9);
    expect((NoteDot as jest.Mock).mock.calls.length).toBe(renders);
    expect(props().path).toBe(path);
    // released: a new path
    play(2, 0.9);
    expect(props().path).not.toBe(path);
  });

  it('ENV 1: the last note on the line of the chart from the time its start is played, without routes too', () => {
    const { props, play } = setup('env1');
    expect(props()).toEqual({ path: null });

    play();
    expect(props().path).toEqual({
      start: 2500,
      corners: [
        [0, 0, 0],
        [0.25, 0.25, 1],
        [0.25, 0.25, 1],
        [0.5, 0.5, 0.8],
      ],
      held: true,
    });

    play(3.5);
    expect(props().path).toMatchObject({ held: false, corners: expect.arrayContaining([[3, 1.5, 0]]) });
  });

  it('a knob turned while the note plays moves the dot with the line, from the same start', () => {
    const { props, play, turn, getOutputTimestamp } = setup('env1');
    play();
    turn(env(0.5));
    expect(props().path?.corners[3]).toEqual([0.5, 0.5, 0.5]);
    expect(props().path?.start).toBe(2500);
    play(3.5);
    expect(props().path?.start).toBe(2500);
    // the clock is read once per note: a knob turned or its release doesn't read it again
    expect(getOutputTimestamp).toHaveBeenCalledTimes(1);
  });

  it('ENV 2 and 3: only while a route reads them, a new amount renders nothing', () => {
    const { modulation, props, play, getOutputTimestamp } = setup('env2', env(0.6));
    const renders = () => (NoteDot as jest.Mock).mock.calls.length;
    const before = renders();
    // not heard: a note renders nothing and doesn't read the clock
    play();
    expect(renders()).toBe(before);
    expect(getOutputTimestamp).not.toHaveBeenCalled();
    expect(props().path).toBeNull();

    act(() => modulation[1].addRoute('env3', 'osc1.wave', 0.5));
    expect(props().path).toBeNull();

    act(() => modulation[1].addRoute('env2', 'osc1.wave', 0.5));
    expect(props().path?.corners[3]).toEqual([0.5, 0.5, 0.6]);

    const shown = renders();
    act(() => modulation[1].setAmount('env2', 'osc1.wave', -0.25));
    expect(renders()).toBe(shown);

    act(() => modulation[1].removeRoute('env2', 'osc1.wave'));
    expect(props().path).toBeNull();
  });
});
