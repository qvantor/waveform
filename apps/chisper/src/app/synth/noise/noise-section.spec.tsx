import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { Handle, HandleProps } from '@chisper/ui-kit';
import { drawn, withElementSize } from '@chisper/ui-kit/test-utils';
import { createModulation, createSynthCore } from '../../../test-utils/models';
import { ModulationContext } from '../common/modules/modulation';
import { SynthCoreContext } from '../common/modules/synth-core';
import { NoiseProvider, useNoise } from '../common/modules';
import { samplePeaks, startSpan } from './components/noise-overview';
import { pathLabel } from './components/noise-selector';
import { sampleStateMessage } from './components/noise-status';
import { samplesToOptions } from './hooks/use-noise-samples';
import { NoiseSection, formatPan } from '.';

// the list of the bucket: two folders
const LIST = [
  {
    name: 'Analog',
    children: [
      { Key: 'Analog/Pink noise.wav', Size: 10 },
      { Key: 'Analog/White.wav', Size: 10 },
    ],
  },
  { name: 'Textures', children: [{ Key: 'Textures/Rain.v2.wav', Size: 10 }] },
];
// the knobs are counted by their renders
jest.mock('@chisper/ui-kit', () => {
  const actual = jest.requireActual('@chisper/ui-kit');
  return { ...actual, Handle: jest.fn(actual.Handle) };
});
jest.mock('./hooks/use-noise-samples', () => {
  const actual = jest.requireActual('./hooks/use-noise-samples');
  return { ...actual, useNoiseSamples: () => actual.samplesToOptions(LIST) };
});

const setup = () => {
  const synthCore = createSynthCore();
  const modulation = createModulation();
  const noise: { current?: ReturnType<typeof useNoise> } = {};
  const Probe = () => {
    noise.current = useNoise();
    return null;
  };
  const { container } = render(
    <SynthCoreContext.Provider value={synthCore}>
      <ModulationContext.Provider value={modulation}>
        <NoiseProvider
          initial={{}}
          synthCore={synthCore}
          loadNoiseSample={() => new Promise(() => undefined)}
        >
          <NoiseSection />
          <Probe />
        </NoiseProvider>
      </ModulationContext.Provider>
    </SynthCoreContext.Provider>
  );
  const [model, actions] = noise.current as ReturnType<typeof useNoise>;
  const menuOf = (label: string) => {
    fireEvent.contextMenu(screen.getByText(label));
    return screen.getByRole('dialog');
  };
  const canvas = () => container.querySelector('canvas[aria-label="The sample of the noise"]');
  return { model, actions, modulation, synthCore, menuOf, canvas };
};

describe('NoiseSection', () => {
  let restoreSize: () => void;
  beforeEach(() => (restoreSize = withElementSize(160, 100)));
  afterEach(() => restoreSize());

  it('is switched on and off by its header, off by default', () => {
    const { model } = setup();
    const header = screen.getByRole('button', { name: /Noise/ });
    expect(header).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(header);
    expect(model.$active.value).toBe(true);
    expect(header).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows the name of its sample and steps through the samples of every folder', () => {
    const { model } = setup();
    expect(screen.getByText('White')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: /next/i })[0]);
    expect(model.$samplePath.value).toEqual(['Textures', 'Textures/Rain.v2.wav']);
    expect(screen.getByText('Rain.v2')).toBeInTheDocument();
  });

  it('plays its sample looped or once, Pitch Track on and off', () => {
    const { model } = setup();
    const loop = screen.getByRole('button', { name: 'Loop' });
    const once = screen.getByRole('button', { name: 'One-shot' });
    expect([loop, once].map((key) => key.getAttribute('aria-pressed'))).toEqual(['true', 'false']);
    fireEvent.click(once);
    expect(model.$noise.value.loop).toBe(false);
    expect([loop, once].map((key) => key.getAttribute('aria-pressed'))).toEqual(['false', 'true']);
    // (a lit key pressed again stays lit)
    fireEvent.click(once);
    expect(model.$noise.value.loop).toBe(false);
    fireEvent.click(loop);
    expect(model.$noise.value.loop).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Pitch Track' }));
    expect(model.$noise.value.keytrack).toBe(true);
  });

  it('has its keys in the window, over the overview, Start and Rand under it', () => {
    const { canvas } = setup();
    const overview = canvas() as HTMLCanvasElement;
    const [playback, pitch] = ['Playback', 'Pitch'].map((name) => screen.getByRole('group', { name }));
    const start = screen.getByText('Start');
    expect(playback.parentElement).toBe(pitch.parentElement);
    // in the block, in this order
    const block = playback.parentElement?.parentElement as HTMLElement;
    const elements = Array.from(block.querySelectorAll('*'));
    const order = [playback, pitch, overview, start].map((element) => elements.indexOf(element));
    expect(order).not.toContain(-1);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('shows Start and Rand in percent, and the knobs of the noise', () => {
    const { actions } = setup();
    act(() => {
      actions.setNoiseValue('start', 0.25);
      actions.setNoiseValue('rand', 0.5);
    });
    expect(screen.getByText('25%')).toBeInTheDocument();
    expect(screen.getByText('50%')).toBeInTheDocument();
    ['Pitch', 'Fine', 'Pan', 'Gain'].forEach((label) => expect(screen.getByText(label)).toBeInTheDocument());
  });

  it('routes the knobs (their menus show the routes) and restores their defaults', () => {
    const { model, actions, modulation, menuOf } = setup();
    act(() => {
      actions.setNoiseValue('level', 0.9);
      modulation[1].addRoute('env2', 'noise.pan', 0.5);
      modulation[1].addRoute('lfo1', 'noise.pitch');
    });
    expect(
      within(menuOf('Pan'))
        .getAllByTestId('menu-route')
        .map((row) => row.textContent?.slice(0, 5))
    ).toEqual(['ENV 2']);
    fireEvent.keyDown(document, { key: 'Escape' });
    // an LFO on a centered knob: bipolar
    expect(modulation[0].$routes.value).toContainEqual(
      expect.objectContaining({ source: 'lfo1', target: 'noise.pitch', bipolar: true })
    );
    fireEvent.click(within(menuOf('Gain')).getByRole('button', { name: /Default/ }));
    expect(model.$noise.value.level).toBe(0.25);
  });

  it('draws the sample, normalized, with the span its notes start in', () => {
    const { model, actions, canvas } = setup();
    act(() => {
      model.$sample.next({
        channels: [Float32Array.from({ length: 320 }, (_, i) => (i % 2 ? 0.5 : -0.25))],
        sampleRate: 44100,
      });
      actions.setNoiseValue('start', 0.5);
      actions.setNoiseValue('rand', 0.5);
    });
    const shapes = drawn(canvas());
    // a column of the peaks every pixel (the loudest at the edge: 2 px in), the span (0.5 to 0.75), the line at Start
    const rects = shapes.flatMap(({ rects }) => rects);
    expect(rects).toHaveLength(160 + 2);
    expect(rects[0]).toEqual([0, 2, 1, 72]);
    expect(rects[160]).toEqual([80, 0, 40, 100]);
    expect(rects[161]).toEqual([80, 0, 1, 100]);
  });

  it('renders a knob alone on a step of it, Start and the keys without the knobs', () => {
    const { actions, canvas } = setup();
    // the labels of the knobs a change renders
    const rendered = (change: () => void) => {
      const before = (Handle as jest.Mock).mock.calls.length;
      act(change);
      return (Handle as jest.Mock).mock.calls.slice(before).map(([props]) => (props as HandleProps).label);
    };
    expect(rendered(() => actions.setNoiseValue('pitch', 5))).toEqual(['Pitch']);
    expect(rendered(() => actions.setNoiseValue('level', 0.5))).toEqual(['Gain']);
    expect(rendered(() => actions.setNoiseValue('start', 0.5))).toEqual([]);
    expect(rendered(() => actions.setLoop(false))).toEqual([]);
    // the overview follows Start: its line in the middle
    expect(
      drawn(canvas())
        .flatMap(({ rects }) => rects)
        .at(-1)
    ).toEqual([80, 0, 1, 100]);
    expect(screen.getByRole('button', { name: 'One-shot' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('tells why its sample does not play while it is on, Retry sends it again', () => {
    const { model, actions, synthCore } = setup();
    const { wavetables } = synthCore[0];
    const retryTable = jest.spyOn(wavetables, 'retryTable');
    act(() => wavetables.$tables.next({ [model.id]: 'refused' }));
    expect(screen.queryByRole('alert')).toBeNull();
    act(() => actions.toggleActive());
    expect(screen.getByRole('alert')).toHaveTextContent('Not enough memory for the sample');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retryTable).toHaveBeenCalledWith(model.id);
  });
});

describe('noise section helpers', () => {
  it('names a sample by its file, a folder by its name', () => {
    expect(samplesToOptions(LIST)).toEqual([
      {
        value: 'Analog',
        label: 'Analog',
        children: [
          { value: 'Analog/Pink noise.wav', label: 'Pink noise' },
          { value: 'Analog/White.wav', label: 'White' },
        ],
      },
      {
        value: 'Textures',
        label: 'Textures',
        children: [{ value: 'Textures/Rain.v2.wav', label: 'Rain.v2' }],
      },
    ]);
  });

  it('labels a path by the name of its sample, as its option, also one the list has not', () => {
    const [analog] = samplesToOptions(LIST);
    const [pink] = 'children' in analog ? analog.children : [];
    expect(pathLabel(['Analog', pink.value])).toBe(pink.label);
    expect(pathLabel(['Gone', 'Gone/Old.wav'])).toBe('Old');
    expect(pathLabel([])).toBe('');
  });

  it('takes the lowest and highest values of each column, of every channel', () => {
    const peaks = samplePeaks(
      { channels: [Float32Array.of(0, 1, -0.5, 0.25), Float32Array.of(0, 0, 0, -1)], sampleRate: 44100 },
      2
    );
    expect(Array.from(peaks)).toEqual([0, 1, -1, 0.25]);
  });

  it('starts notes from Start up to Start + Rand², not past the end', () => {
    expect(startSpan(0.2, 0)).toEqual([0.2, 0.2]);
    expect(startSpan(0.2, 0.5)).toEqual([0.2, 0.45]);
    expect(startSpan(0.9, 1)).toEqual([0.9, 1]);
  });

  it('shows the pan as the renders: 0 in the centre, 50 at a side', () => {
    expect([formatPan(-1), formatPan(-0.5), formatPan(0), formatPan(0.004), formatPan(1)]).toEqual([
      '50 L',
      '25 L',
      'C',
      'C',
      '50 R',
    ]);
  });

  it('tells a refused or failed sample', () => {
    expect(sampleStateMessage('refused')).toMatch(/memory/);
    expect(sampleStateMessage('failed')).toMatch(/failed/);
    expect(sampleStateMessage('stored')).toBeUndefined();
  });
});
