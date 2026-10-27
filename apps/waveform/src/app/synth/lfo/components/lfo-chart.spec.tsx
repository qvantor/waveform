import React from 'react';
import { BehaviorSubject } from 'rxjs';
import { act, render, screen } from '@testing-library/react';
import { drawn, withElementSize } from '@waveform/ui-kit/test-utils';
import { theme } from '@waveform/ui-kit';
import { createLfos, createModulation, createSynthCore } from '../../../../test-utils/models';
import { LfoContext } from '../../common/modules/lfos';
import { ModulationContext } from '../../common/modules/modulation';
import { SynthContext, SynthModule } from '../../common/modules/synth';
import { SynthCoreContext } from '../../common/modules/synth-core';
import type { FxNote } from '../../fx/effects/fx-modulation';
import { LfoChart } from './lfo-chart';

const RATE = 48000;
// the chart is 300 × 60, padded by the radius of the dot (4): a cycle over 292 px, the levels over 52
const [WIDTH, HEIGHT] = [292, 52];

// the chart of LFO 1 with the models it reads: the routes, the LFOs, the last note of the synth and its voices, the
// clock of a core (moved by the spec)
const setup = () => {
  const modulation = createModulation();
  const lfos = createLfos(createSynthCore());
  const $fxNote = new BehaviorSubject<FxNote | null>(null);
  const $voicesCount = new BehaviorSubject(0);
  const synth = [{ $fxNote, $voicesCount }, {}] as unknown as SynthModule;
  const audioCtx = { currentTime: 0, sampleRate: RATE };
  const core = [{ audioCtx }, {}] as never;
  render(
    <SynthCoreContext.Provider value={core}>
      <SynthContext.Provider value={synth}>
        <LfoContext.Provider value={lfos}>
          <ModulationContext.Provider value={modulation}>
            <LfoChart id='lfo1' lfo={lfos[0].$lfos.value.lfo1} />
          </ModulationContext.Provider>
        </LfoContext.Provider>
      </SynthContext.Provider>
    </SynthCoreContext.Provider>
  );
  const flat = { attack: 0, hold: 0, decay: 0, sustain: 1, release: 0 };
  const play = (start: number) =>
    act(() => {
      $fxNote.next({ envelopes: [flat, flat, flat], start, release: null });
      $voicesCount.next(1);
    });
  const frame = () =>
    act(() => {
      jest.advanceTimersByTime(20);
    });
  // the dot on the canvas of the chart: its ring and its face
  const dot = () => drawn(screen.getByTestId('lfo-dot'));
  return { modulation, audioCtx, play, frame, dot, $voicesCount };
};

describe('LfoChart', () => {
  let restoreSize: () => void;
  beforeEach(() => {
    jest.useFakeTimers();
    restoreSize = withElementSize(300, 60);
  });
  afterEach(() => {
    restoreSize();
    jest.useRealTimers();
  });

  it('paints the dot of the last note on its cycle while a route reads the LFO and voices sound', () => {
    const { modulation, audioCtx, play, frame, dot, $voicesCount } = setup();
    // no route reads it
    play(1);
    frame();
    expect(dot()).toEqual([]);
    act(() => modulation[1].addRoute('lfo1', 'osc1.wave'));
    // a sine of 0.5 s an eighth of a second after the note on: a quarter of the cycle, the middle level
    audioCtx.currentTime = 1.125;
    frame();
    const [ring, face] = dot();
    expect(ring.arcs).toEqual([{ x: WIDTH / 4, y: HEIGHT / 2, radius: 5 }]);
    expect(ring.style).toBe(theme.colors.primaryDark);
    expect(face.arcs).toEqual([{ x: WIDTH / 4, y: HEIGHT / 2, radius: 4 }]);
    expect(face.style).toBe(theme.colors.white);
    // at the crest a quarter of a cycle later
    audioCtx.currentTime = 1.25;
    frame();
    expect(dot()[1].arcs).toEqual([{ x: WIDTH / 2, y: 0, radius: 4 }]);
    act(() => $voicesCount.next(0));
    expect(dot()).toEqual([]);
  });
});
