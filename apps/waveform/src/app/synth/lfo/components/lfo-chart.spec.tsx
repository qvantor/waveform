import React from 'react';
import { BehaviorSubject } from 'rxjs';
import { act, render, screen } from '@testing-library/react';
import { drawn, withElementSize } from '@waveform/ui-kit/test-utils';
import { NOTE_DOT_COLOR } from '@waveform/ui-kit';
import { createLfos, createModulation, createSynthCore } from '../../../../test-utils/models';
import { LfoContext } from '../../common/modules/lfos';
import { ModulationContext } from '../../common/modules/modulation';
import { SynthContext, SynthModule } from '../../common/modules/synth';
import { SynthCoreContext } from '../../common/modules/synth-core';
import type { FxNote } from '../../fx/effects/fx-modulation';
import { LfoChart } from './lfo-chart';

const RATE = 48000;
// the chart is 300 × 60, its levels padded by 4 px for the points: a cycle over 300 px, the levels over 52
const [WIDTH, HEIGHT] = [300, 52];

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
  const onPointsChange = jest.fn();
  render(
    <SynthCoreContext.Provider value={core}>
      <SynthContext.Provider value={synth}>
        <LfoContext.Provider value={lfos}>
          <ModulationContext.Provider value={modulation}>
            <LfoChart id='lfo1' lfo={lfos[0].$lfos.value.lfo1} onPointsChange={onPointsChange} />
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
  // the dot on the canvas of the chart
  const dot = () => drawn(screen.getByTestId('lfo-dot'));
  return { modulation, audioCtx, play, frame, dot, $voicesCount, onPointsChange };
};

// jsdom has no PointerEvent: a mouse event with the pointer type name and a pointerId works for React and the
// document listeners of the drag
const pointer = (type: string, target: EventTarget, [clientX, clientY]: [number, number]) => {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY, button: 0 });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  act(() => {
    target.dispatchEvent(event);
  });
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

  it('shows a shape of the LFO as its points: dragged, the shape goes as points', () => {
    const { onPointsChange } = setup();
    // the default sine: four curved quarters
    const points = screen.getAllByRole('button', { name: /^Point/ });
    expect(points.map((point) => point.getAttribute('transform'))).toEqual([
      'translate(0, 52)',
      'translate(75, 26)',
      'translate(150, 0)',
      'translate(225, 26)',
    ]);
    expect(screen.getAllByRole('slider')).toHaveLength(4);
    pointer('pointerdown', points[1], [75, 26]);
    pointer('pointermove', document, [75, 0]);
    pointer('pointerup', document, [75, 0]);
    expect(onPointsChange).toHaveBeenCalledWith([
      [0, 0, -1.7],
      [0.25, 1, 1.7],
      [0.5, 1, -1.7],
      [0.75, 0.5, 1.7],
    ]);
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
    // as the dot of a note on the chart of an envelope
    const [face, ...rest] = dot();
    expect(rest).toEqual([]);
    expect(face.arcs).toEqual([{ x: WIDTH / 4, y: HEIGHT / 2, radius: 3 }]);
    expect(face.style).toBe(NOTE_DOT_COLOR);
    // at the crest a quarter of a cycle later
    audioCtx.currentTime = 1.25;
    frame();
    expect(dot()[0].arcs).toEqual([{ x: WIDTH / 2, y: 0, radius: 3 }]);
    act(() => $voicesCount.next(0));
    expect(dot()).toEqual([]);
  });
});
