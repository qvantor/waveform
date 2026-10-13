import { render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { DelayControls } from './delay-controls';

const params = { mode: 0, pan: 0, time: 0.2, fb: 0.5, freq: 1000, q: 0.01 };

const setup = (props: Partial<React.ComponentProps<typeof DelayControls>> = {}) => {
  const setParam = jest.fn();
  const user = userEvent.setup();
  const result = render(
    <DelayControls params={params} setParam={setParam} on sampleRate={48000} {...props} />
  );
  return { ...result, setParam, user };
};

describe('DelayControls', () => {
  it('splits the controls into mode, echo and filter groups, left to right', () => {
    setup();
    const groups = screen.getAllByRole('group');
    expect(groups.map((group) => group.getAttribute('aria-label'))).toEqual(['Mode', 'Echo', 'Filter']);
    const [mode, echo, filter] = groups;

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

  it('disables the mode switch and greys out the filter chart while bypassed', () => {
    const { rerender, setParam } = setup();
    expect(screen.queryByTestId('filter-response-deactivated')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();

    rerender(<DelayControls params={params} setParam={setParam} on={false} sampleRate={48000} />);
    expect(screen.getByTestId('filter-response-deactivated')).toBeInTheDocument();
    for (const name of ['Normal', 'Previous', 'Next'])
      expect(screen.getByRole('button', { name })).toBeDisabled();
    screen.getAllByRole('group').forEach((group) => expect(group).toHaveClass('disabled'));
  });
});
