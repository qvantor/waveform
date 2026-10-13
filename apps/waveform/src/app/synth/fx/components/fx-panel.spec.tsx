import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { AppProvider } from '../../../app';
import { SynthCoreProvider, useSynthCore } from '../../common/modules';
import { FxProvider, useFx } from '../modules';
import { FxPanel } from './fx-panel';

type FxModule = ReturnType<typeof useFx>;

const Capture = ({ onModel }: { onModel: (module: FxModule) => void }) => {
  onModel(useFx());
  return null;
};

const Fx = ({ children }: React.PropsWithChildren) => (
  <FxProvider initial={{}} synthCore={useSynthCore()}>
    {children}
  </FxProvider>
);

const setup = () => {
  let fx: FxModule | undefined;
  render(
    <AppProvider initial={{}}>
      <SynthCoreProvider initial={undefined}>
        <Fx>
          <Capture onModel={(module) => (fx = module)} />
          <FxPanel type='delay' />
        </Fx>
      </SynthCoreProvider>
    </AppProvider>
  );
  if (!fx) throw new Error('fx model is not initialized');
  return { fx, user: userEvent.setup() };
};

describe('FxPanel', () => {
  it('shows the effect name first, then the presets, then the controls', () => {
    setup();
    const header = screen.getByRole('button', { name: 'Delay' });
    const preset = screen.getByRole('group', { name: 'Preset' });
    const mode = screen.getByRole('group', { name: 'Mode' });
    expect(header).toHaveTextContent('Delay');
    expect(header.compareDocumentPosition(preset)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(preset.compareDocumentPosition(mode)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect((within(preset).getByRole('combobox') as HTMLSelectElement).value).toBe('default');
  });

  it('the name toggles the effect on and off', async () => {
    const { fx, user } = setup();
    const header = screen.getByRole('button', { name: 'Delay' });
    expect(header).toHaveAttribute('aria-pressed', 'true');

    await user.click(header);
    expect(fx[0].$effects.value.delay.on).toBe(false);
    expect(header).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('group', { name: 'Out' })).toHaveClass('disabled');

    await user.click(header);
    expect(fx[0].$effects.value.delay.on).toBe(true);
  });

  it('selecting a preset applies it to the model', async () => {
    const { fx, user } = setup();
    await user.selectOptions(screen.getByRole('combobox'), 'Dub');
    expect(fx[0].$effects.value.delay).toMatchObject({ mix: 0.35, params: { mode: 1, time: 0.5 } });
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('dub');
  });
});
