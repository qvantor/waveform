import React from 'react';
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { createOscillator } from '../../../../../../test-utils/models';
import { WaveSelector } from './index';

const setup = (frames: number) => {
  const [model, actions] = createOscillator();
  actions.setWaveTable(Array.from({ length: frames }, () => [0, 1, 0, -1]));
  const cloneCurrent = jest.fn();
  render(
    <WaveSelector
      $wave={model.$wave}
      $waveTable={model.$waveTable}
      $position={model.$position}
      setPosition={actions.setPosition}
      cloneCurrent={cloneCurrent}
    />
  );
  return { cloneCurrent, user: userEvent.setup() };
};

describe('editor WaveSelector', () => {
  it('adds a wave', async () => {
    const { cloneCurrent, user } = setup(2);
    const add = screen.getByRole('button', { name: 'Add a wave' });
    expect(add).toBeEnabled();
    await user.click(add);
    expect(cloneCurrent).toHaveBeenCalled();
  });

  it('adds no wave to a table of 256, and says why', () => {
    setup(256);
    const add = screen.getByRole('button', { name: 'Add a wave' });
    expect(add).toBeDisabled();
    expect(add).toHaveAttribute('title', 'A table holds 256 waves at most');
  });
});
