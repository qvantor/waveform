import { render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { drawn, svgPath, switchKeyTip as tip, withElementSize } from '@chisper/ui-kit/test-utils';
import { divisionIndex, TEMPO_DIVISIONS } from '@chisper/preset-schema';
import { Handle, HandleProps } from '@chisper/ui-kit';
import { createLiveRoutes } from '../../../../../test-utils/live-routes';
import { DelayControls } from './delay-controls';

// the knobs render as ever, their props are recorded
jest.mock('@chisper/ui-kit', () => {
  const actual = jest.requireActual('@chisper/ui-kit');
  return { ...actual, Handle: jest.fn((props) => actual.Handle(props)) };
});
const knob = (label: string) =>
  (Handle as unknown as jest.Mock).mock.calls
    .map(([props]) => props as HandleProps)
    .filter((props) => props.label === label)
    .at(-1) as HandleProps;

const params = { mode: 0, pan: 0, time: 0.2, sync: 0, div: 9, trip: 0, dot: 0, fb: 0.5, freq: 1000, q: 0.01 };

const setup = (props: Partial<React.ComponentProps<typeof DelayControls>> = {}) => {
  const setParam = jest.fn();
  const user = userEvent.setup();
  const result = render(
    <DelayControls params={params} setParam={setParam} on sampleRate={48000} {...props} />
  );
  return { ...result, setParam, user };
};

describe('DelayControls', () => {
  afterEach(() => jest.useRealTimers());

  it('splits the controls into mode, echo and filter groups, left to right', () => {
    setup();
    const groups = screen.getAllByRole('group');
    expect(groups.map((group) => group.getAttribute('aria-label'))).toEqual([
      'Mode',
      'Echo',
      'Tempo',
      'Filter',
    ]);
    const [mode, echo, tempo, filter] = groups;
    // the keys of the tempo in the echo group beside Time, between it and Feedback, not under the mode
    expect(echo).toContainElement(tempo);
    expect(tempo).toHaveClass('stack');
    expect(within(echo).getByText('Time').compareDocumentPosition(tempo)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );
    expect(tempo.compareDocumentPosition(within(echo).getByText('Feedback'))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );
    expect(within(mode).queryByRole('button', { name: 'Tempo sync' })).not.toBeInTheDocument();

    expect(within(mode).getByRole('button', { name: 'Normal' })).toBeInTheDocument();

    const echoText = echo.textContent ?? '';
    const echoOrder = ['Pan', 'Time', 'Feedback'].map((label) => echoText.indexOf(label));
    expect(echoOrder.every((index) => index >= 0)).toBe(true);
    expect([...echoOrder].sort((a, b) => a - b)).toEqual(echoOrder);

    const chart = within(filter).getByTestId('filter-response');
    const freq = within(filter).getByText('Freq');
    expect(chart.compareDocumentPosition(freq)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(freq.compareDocumentPosition(within(filter).getByText('Q'))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );
  });

  it('shows the current mode with its icon', () => {
    const { rerender, setParam } = setup();
    expect(screen.getByRole('button', { name: 'Normal' })).toBeInTheDocument();
    expect(screen.getByTestId('delay-mode-normal')).toBeInTheDocument();
    expect(screen.queryByTestId('delay-mode-ping-pong')).not.toBeInTheDocument();

    rerender(<DelayControls params={{ ...params, mode: 1 }} setParam={setParam} on sampleRate={48000} />);
    expect(screen.getByRole('button', { name: 'Ping-pong' })).toBeInTheDocument();
    expect(screen.getByTestId('delay-mode-ping-pong')).toBeInTheDocument();
    expect(screen.queryByTestId('delay-mode-normal')).not.toBeInTheDocument();
  });

  it('steps the mode by index and wraps around', async () => {
    const { user, setParam, rerender } = setup();
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(setParam).toHaveBeenLastCalledWith('mode', 1);
    await user.click(screen.getByRole('button', { name: 'Previous' }));
    expect(setParam).toHaveBeenLastCalledWith('mode', 1);

    rerender(<DelayControls params={{ ...params, mode: 1 }} setParam={setParam} on sampleRate={48000} />);
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(setParam).toHaveBeenLastCalledWith('mode', 0);
    await user.click(screen.getByRole('button', { name: 'Ping-pong' }));
    expect(setParam).toHaveBeenLastCalledWith('mode', 0);
  });

  it('switches BPM beside Time, TRIP and DOT only in BPM', async () => {
    const { user, setParam, rerender } = setup();
    const key = (name: string) => screen.getByRole('button', { name });
    expect(key('Tempo sync')).toHaveAttribute('aria-pressed', 'false');
    expect(key('Triplets')).toBeDisabled();
    await user.click(key('Tempo sync'));
    expect(setParam).toHaveBeenLastCalledWith('sync', 1);
    rerender(<DelayControls params={{ ...params, sync: 1 }} setParam={setParam} on sampleRate={48000} />);
    await user.click(key('Dotted'));
    expect(setParam).toHaveBeenLastCalledWith('dot', 1);
    rerender(
      <DelayControls params={{ ...params, sync: 1, dot: 1 }} setParam={setParam} on sampleRate={48000} />
    );
    await user.click(key('Dotted'));
    expect(setParam).toHaveBeenLastCalledWith('dot', 0);
  });

  it('has BPM over the triplets and the dotted ones on one plate, the last two as icons', () => {
    setup();
    const keys = within(screen.getByRole('group', { name: 'Tempo' })).getAllByRole('button');
    expect(keys.map((key) => key.getAttribute('aria-label'))).toEqual(['Tempo sync', 'Triplets', 'Dotted']);
    expect(keys.map((key) => key.textContent)).toEqual(['BPM', '', '']);
    expect(keys.slice(1).every((key) => key.querySelector('svg'))).toBe(true);
  });

  it('hovered, a key tells what it does, a dimmed one why: BPM off, or the delay', () => {
    jest.useFakeTimers();
    const { rerender, setParam } = setup();
    expect(tip('Tempo sync')).toBe('Tempo syncTime in note values');
    expect(tip('Triplets')).toBe('TripletsTime in triplets: ⅔ as longTurn on BPM to use it');
    rerender(<DelayControls params={params} setParam={setParam} on={false} sampleRate={48000} />);
    expect(tip('Dotted')).toBe('DottedTime in dotted notes: 1.5× as longTurn on the delay');
    expect(tip('Tempo sync')).toBe('Tempo syncTime in note valuesTurn on the delay');
  });

  it('shows Time as its division in BPM', () => {
    const { rerender, setParam } = setup();
    expect(knob('Time').value).toBe(0.2);
    expect(knob('Time').step).toBeUndefined();
    rerender(
      <DelayControls
        params={{ ...params, sync: 1, dot: 1, div: divisionIndex('1/8D') }}
        setParam={setParam}
        on
        sampleRate={48000}
      />
    );
    const time = knob('Time');
    expect(time).toMatchObject({ value: divisionIndex('1/8D'), precision: 1 });
    expect(time.formatValue?.(time.value as number)).toBe('1/8D');
    expect(time.step?.map((division) => TEMPO_DIVISIONS[division].id)).toEqual([
      '1/64',
      '1/64D',
      '1/32',
      '1/32D',
      '1/16',
      '1/16D',
      '1/8',
      '1/8D',
      '1/4',
      '1/4D',
      '1/2',
      '1/2D',
      '1 bar',
      '1 bar D',
    ]);
    time.onChange?.(divisionIndex('1/4'));
    expect(setParam).toHaveBeenLastCalledWith('div', divisionIndex('1/4'));
    // without DOT its straight one
    rerender(
      <DelayControls
        params={{ ...params, sync: 1, div: divisionIndex('1/8D') }}
        setParam={setParam}
        on
        sampleRate={48000}
      />
    );
    expect(knob('Time').value).toBe(divisionIndex('1/8'));
  });

  it('in BPM puts the routes of Time on its steps in seconds: 1/8D + 0.375 s is 1/4D at 120', () => {
    const { rerender, setParam } = setup();
    expect(knob('Time').modTravel).toBeUndefined();
    rerender(
      <DelayControls
        params={{ ...params, sync: 1, dot: 1, div: divisionIndex('1/8D') }}
        setParam={setParam}
        on
        sampleRate={48000}
      />
    );
    const { step = [], modTravel } = knob('Time');
    const share = (id: string) => step.indexOf(divisionIndex(id)) / (step.length - 1);
    expect(modTravel?.travel(modTravel.position)).toBeCloseTo(share('1/8D'), 12);
    // a share of 0.01..1 s
    expect(modTravel?.travel((modTravel?.position ?? 0) + 0.375 / 0.99)).toBeCloseTo(share('1/4D'), 12);
  });

  it('in BPM keeps the steps of Time and the travel of its routes while another knob moves', () => {
    const { rerender, setParam } = setup();
    const synced = { ...params, sync: 1, div: divisionIndex('1/8') };
    const draw = (fb: number) =>
      rerender(<DelayControls params={{ ...synced, fb }} setParam={setParam} on sampleRate={48000} />);
    draw(0.5);
    const { step, modTravel } = knob('Time');
    draw(0.6);
    expect(knob('Time').step).toBe(step);
    expect(knob('Time').modTravel).toBe(modTravel);
  });

  it('disables the mode switch and greys out the filter chart while bypassed', () => {
    const { rerender, setParam } = setup();
    expect(screen.queryByTestId('filter-response-deactivated')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();

    rerender(<DelayControls params={params} setParam={setParam} on={false} sampleRate={48000} />);
    expect(screen.getByTestId('filter-response-deactivated')).toBeInTheDocument();
    for (const name of ['Normal', 'Previous', 'Next'])
      expect(screen.getByRole('button', { name })).toBeDisabled();
    ['Mode', 'Echo', 'Filter'].forEach((name) =>
      expect(screen.getByRole('group', { name })).toHaveClass('disabled')
    );
    // the keys of the tempo faded as a whole
    expect(screen.getByRole('group', { name: 'Tempo' })).toHaveAttribute('aria-disabled', 'true');
    for (const name of ['Tempo sync', 'Triplets', 'Dotted'])
      expect(screen.getByRole('button', { name })).toBeDisabled();
  });

  it('the bandpass follows where the routes of Freq and Q move them while they sound', () => {
    const restore = withElementSize(160, 80);
    const line = (
      changes: Partial<typeof params>,
      Wrapper?: React.JSXElementConstructor<React.PropsWithChildren>
    ) => {
      const { unmount } = render(
        <DelayControls params={{ ...params, ...changes }} setParam={jest.fn()} on sampleRate={48000} />,
        { wrapper: Wrapper }
      );
      const [line] = drawn(screen.getByTestId('filter-line'));
      const d = svgPath(line);
      unmount();
      return d;
    };
    const { Wrapper, route, play } = createLiveRoutes();
    // Freq 1000 → 2000 Hz in steps of 1/1000 of its travel (log 50..17000), Q 0.1 → 1 (log 0.01..3)
    const octaves = Math.log2(17000 / 50);
    const share = Math.round(((Math.log2(1000 / 50) + 1) / octaves) * 1000) / 1000;
    const qOctaves = Math.log2(3 / 0.01);
    const qShare = Math.round(((Math.log2(0.1 / 0.01) + Math.log2(10)) / qOctaves) * 1000) / 1000;
    route('delay.freq', 2 / octaves);
    route('delay.q', (2 * Math.log2(10)) / qOctaves);
    play(0.5);
    const moved = line({ q: 0.1 }, Wrapper);
    expect(moved).toBe(line({ freq: 50 * 2 ** (share * octaves), q: 0.01 * 2 ** (qShare * qOctaves) }));
    expect(moved).not.toBe(line({ q: 0.1 }));
    restore();
  });
});
