import React from 'react';
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppProvider } from '../app/app';
import { SynthCoreProvider, InputControllerProvider } from '../app/synth/common/modules';
import { PresetsProvider, usePresets } from '../app/presets/modules/presets';

type PresetsModule = ReturnType<typeof usePresets>;

// antd animations, tab measuring and debounce timers update state after user-event's act() scope ends,
// those warnings are noise for these tests
const consoleError = console.error.bind(console);
beforeAll(() => {
  jest.spyOn(console, 'error').mockImplementation((message: unknown, ...rest: unknown[]) => {
    if (typeof message === 'string' && message.includes('not wrapped in act(')) return;
    consoleError(message, ...rest);
  });
});
afterAll(() => jest.mocked(console.error).mockRestore());

const Capture = ({ onModel }: { onModel: (module: PresetsModule) => void }) => {
  onModel(usePresets());
  return null;
};

// renders the ui inside the providers the preset components need, returns the presets model to drive it
export const renderWithPresets = (ui: React.ReactElement) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    logger: { log: () => undefined, warn: () => undefined, error: () => undefined },
  });
  let presets: PresetsModule | undefined;
  // a wrapper, not a parent element, so rerender() keeps the same providers and models
  const wrapper = ({ children }: React.PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>
      <AppProvider initial={{}}>
        <SynthCoreProvider initial={undefined}>
          <InputControllerProvider initial={undefined}>
            <PresetsProvider initial={undefined}>
              <Capture onModel={(module) => (presets = module)} />
              {children}
            </PresetsProvider>
          </InputControllerProvider>
        </SynthCoreProvider>
      </AppProvider>
    </QueryClientProvider>
  );
  const result = render(ui, { wrapper });
  if (!presets) throw new Error('presets model is not initialized');
  return { ...result, presets };
};
