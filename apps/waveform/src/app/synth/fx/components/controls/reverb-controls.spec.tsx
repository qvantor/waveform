import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { FX_PARAMS } from '@waveform/preset-schema';
import { mapValues } from 'lodash';
import { withElementSize } from '../../../../../test-utils/element-size';
import { createLiveRoutes } from '../../../../../test-utils/live-routes';
import { reverb } from '../../effects/reverb';
import { ReverbControls } from './reverb-controls';

const params = mapValues(FX_PARAMS.reverb, (param) => param.default);

const setup = (props: Partial<React.ComponentProps<typeof ReverbControls>> = {}) => {
  const setParam = jest.fn();
  const user = userEvent.setup();
  const result = render(
    <ReverbControls params={params} setParam={setParam} on sampleRate={48000} {...props} />
  );
  return { ...result, setParam, user };
};

const labelsIn = (group: HTMLElement) => {
  const text = group.textContent ?? '';
  return (labels: string[]) => {
    const order = labels.map((label) => text.indexOf(label));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  };
};

describe('ReverbControls', () => {
  it('puts the era first, then the sections, left to right', () => {
    setup();
    const groups = screen.getAllByRole('group');
    expect(groups.map((group) => group.getAttribute('aria-label'))).toEqual([
      'Era',
      'Input',
      'Time',
      'Decay',
      'Levels',
    ]);
    const [, input, time, decay, levels] = groups;
    labelsIn(input)(['Low cut']);
    labelsIn(time)(['Predelay', 'Size']);
    expect(time.textContent).not.toContain('ER');
    labelsIn(decay)(['Decay', 'Hi damp', 'Bass']);
    labelsIn(levels)(['ER', 'Sep', 'Mod']);
  });

  it('puts ER, Sep and Mod on faders, the rest stay knobs', () => {
    setup();
    const levels = screen.getByRole('group', { name: 'Levels' });
    expect(
      within(levels)
        .getAllByRole('slider')
        .map((slider) => slider.getAttribute('aria-label'))
    ).toEqual(['Early reflections', 'Stereo width', 'Modulation']);
    expect(screen.getAllByRole('slider')).toHaveLength(3);
    const faders = Object.entries(reverb.params).filter(([, def]) => def.control === 'fader');
    expect(faders.map(([key]) => key).sort()).toEqual(['depth', 'er', 'sep']);
    // the stereo width fills from its natural 100%
    expect(reverb.params.sep.fillFrom).toBe(1);
  });

  it('the faders show and set their params', () => {
    const { setParam } = setup();
    const [er, sep, mod] = screen.getAllByRole('slider');
    expect([er, sep, mod].map((slider) => slider.getAttribute('aria-valuetext'))).toEqual([
      '50%',
      '100%',
      '20%',
    ]);
    fireEvent.keyDown(er, { key: 'ArrowUp' });
    expect(setParam).toHaveBeenLastCalledWith('er', 0.51);
    fireEvent.keyDown(sep, { key: 'ArrowDown' });
    expect(setParam).toHaveBeenLastCalledWith('sep', 0.98);
    fireEvent.keyDown(mod, { key: 'End' });
    expect(setParam).toHaveBeenLastCalledWith('depth', 1);
  });

  it('a knob or a fader held shows the full name of what it changes before the value', () => {
    setup();
    const tooltip = () => document.getElementById('tooltip')?.textContent ?? '';
    // jsdom has no PointerEvent: a mouse event with a pointerId
    const pointer = (type: string, target: EventTarget) => {
      const event = new MouseEvent(type, { bubbles: true, button: 0 });
      Object.defineProperty(event, 'pointerId', { value: 1 });
      act(() => {
        target.dispatchEvent(event);
      });
    };
    pointer('pointerdown', screen.getByText('Hi damp'));
    expect(tooltip()).toBe('High damping6.0kHz');
    pointer('pointerup', document);
    pointer('pointerdown', screen.getByText('ER'));
    expect(tooltip()).toBe('Early reflections50%');
    pointer('pointerup', document);
  });

  // the wet level is the common mix of FxPanel
  it('has no wet knob', () => {
    setup();
    expect(screen.queryByText('Wet')).not.toBeInTheDocument();
    expect(Object.keys(reverb.params)).not.toContain('tail');
  });

  it('has 6 knobs, 3 faders and the era switch, diffusion, crossover, mod speed and high cut are fixed', () => {
    setup();
    expect(Object.keys(reverb.params)).toHaveLength(10);
    expect(Object.values(reverb.params).filter((def) => !def.options && !def.control)).toHaveLength(6);
    expect(reverb.params.era.options?.map(({ label }) => label)).toEqual(['Now', '80s', '70s']);
    ['High cut', 'Diffusion', 'X-over', 'Speed'].forEach((label) =>
      expect(screen.queryByText(label)).not.toBeInTheDocument()
    );
  });

  it('shows the decay chart before the decay knobs', () => {
    setup();
    const decay = screen.getByRole('group', { name: 'Decay' });
    const chart = within(decay).getByTestId('reverb-decay');
    expect(chart.compareDocumentPosition(within(decay).getByText('Hi damp'))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );
  });

  it('starts in the 80s and shows the current era with its icon', () => {
    const { rerender, setParam } = setup();
    const era = screen.getByRole('group', { name: 'Era' });
    const shows = (label: string, id: string) => {
      expect(within(era).getByRole('button', { name: label })).toBeInTheDocument();
      expect(
        within(era)
          .getAllByTestId(/^reverb-era-/)
          .map((icon) => icon.dataset['testid'])
      ).toEqual([`reverb-era-${id}`]);
    };
    shows('80s', '80s');
    rerender(<ReverbControls params={{ ...params, era: 0 }} setParam={setParam} on sampleRate={48000} />);
    shows('Now', 'now');
    rerender(<ReverbControls params={{ ...params, era: 2 }} setParam={setParam} on sampleRate={48000} />);
    shows('70s', '70s');
  });

  it('steps the era by index and wraps around', async () => {
    const { user, setParam, rerender } = setup();
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(setParam).toHaveBeenLastCalledWith('era', 2);
    await user.click(screen.getByRole('button', { name: 'Previous' }));
    expect(setParam).toHaveBeenLastCalledWith('era', 0);

    rerender(<ReverbControls params={{ ...params, era: 2 }} setParam={setParam} on sampleRate={48000} />);
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(setParam).toHaveBeenLastCalledWith('era', 0);
    rerender(<ReverbControls params={{ ...params, era: 0 }} setParam={setParam} on sampleRate={48000} />);
    await user.click(screen.getByRole('button', { name: 'Previous' }));
    expect(setParam).toHaveBeenLastCalledWith('era', 2);
  });

  it('greys out the groups and the chart, disables the era switch and the faders while bypassed', () => {
    const { rerender, setParam } = setup();
    expect(screen.queryByTestId('reverb-decay-deactivated')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();
    screen.getAllByRole('slider').forEach((slider) => expect(slider).toHaveAttribute('tabindex', '0'));
    rerender(<ReverbControls params={params} setParam={setParam} on={false} sampleRate={48000} />);
    expect(screen.getByTestId('reverb-decay-deactivated')).toBeInTheDocument();
    screen.getAllByRole('group').forEach((group) => expect(group).toHaveClass('disabled'));
    for (const name of ['80s', 'Previous', 'Next'])
      expect(screen.getByRole('button', { name })).toBeDisabled();
    screen.getAllByRole('slider').forEach((slider) => {
      expect(slider).toHaveAttribute('aria-disabled', 'true');
      expect(slider).toHaveAttribute('tabindex', '-1');
    });
  });
});

describe('reverb param formatting', () => {
  const format = (key: keyof typeof reverb.params, value: number) => reverb.params[key].formatValue?.(value);

  it.each([
    ['lowcut', 20, '20Hz'],
    ['damp', 6000, '6.0kHz'],
    ['pre', 0.02, '20ms'],
    ['size', 0.5, '50%'],
    ['decay', 0.25, '250ms'],
    ['decay', 12.34, '12.3s'],
    ['bass', 0.25, '×0.25'],
    ['depth', 0.2, '20%'],
    ['sep', 2, '200%'],
    ['er', 0.8, '80%'],
  ] as const)('%s %p is shown as %s', (key, value, text) => {
    expect(format(key, value)).toBe(text);
  });

  it('uses log knobs for the frequencies, the decay and bass', () => {
    const logs = Object.entries(reverb.params)
      .filter(([, def]) => def.mode === 'log')
      .map(([key]) => key);
    expect(logs.sort()).toEqual(['bass', 'damp', 'decay', 'lowcut']);
  });

  it('the decay curve follows where the routes of its knobs move them while they sound', () => {
    const restore = withElementSize(160, 80);
    const curve = (
      changes: Partial<typeof params>,
      Wrapper?: React.JSXElementConstructor<React.PropsWithChildren>
    ) => {
      const { unmount } = render(
        <ReverbControls params={{ ...params, ...changes }} setParam={jest.fn()} on sampleRate={48000} />,
        { wrapper: Wrapper }
      );
      const d = Array.from(screen.getByTestId('reverb-decay').querySelectorAll('path')).map((path) =>
        path.getAttribute('d')
      );
      unmount();
      return d;
    };
    const { Wrapper, route, play } = createLiveRoutes();
    route('reverb.size', 0.5);
    route('reverb.bass', -0.5);
    play(0.5);
    // a quarter of the travel each: Size 0.5 → 0.75, Bass (log 0.25..4) 1 → 0.5
    const moved = curve({ size: 0.5, bass: 1 }, Wrapper);
    expect(moved).toEqual(curve({ size: 0.75, bass: 0.5 }));
    expect(moved).not.toEqual(curve({ size: 0.5, bass: 1 }));
    restore();
  });
});
