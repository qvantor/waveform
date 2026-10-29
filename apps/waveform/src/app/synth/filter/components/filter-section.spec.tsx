import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { withElementSize } from '@waveform/ui-kit/test-utils';
import { createModulation, createSynthCore } from '../../../../test-utils/models';
import { ModulationContext } from '../../common/modules/modulation';
import { FilterProvider, useFilter } from '../modules';
import { FilterSection } from './filter-section';

const setup = () => {
  const synthCore = createSynthCore();
  const modulation = createModulation();
  const filter: { current?: ReturnType<typeof useFilter> } = {};
  const Probe = () => {
    filter.current = useFilter();
    return null;
  };
  render(
    <ModulationContext.Provider value={modulation}>
      <FilterProvider initial={{}} synthCore={synthCore}>
        <FilterSection />
        <Probe />
      </FilterProvider>
    </ModulationContext.Provider>
  );
  const [model, actions] = filter.current as ReturnType<typeof useFilter>;
  // a right click on a knob by its label
  const menuOf = (label: string) => {
    fireEvent.contextMenu(screen.getByText(label));
    return screen.getByRole('dialog');
  };
  return { model, actions, modulation, menuOf };
};

// jsdom has no PointerEvent: a mouse event with a pointerId works for React and the document listeners of the
// pointer tracker
const pointer = (type: string, target: EventTarget, clientX: number) => {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY: 0, button: 0 });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  act(() => {
    target.dispatchEvent(event);
  });
};

const dragRight = (element: HTMLElement, px: number) => {
  pointer('pointerdown', element, 0);
  pointer('pointermove', document, px);
  pointer('pointerup', document, px);
};

describe('FilterSection', () => {
  let restoreSize: () => void;
  beforeEach(() => (restoreSize = withElementSize(300, 100)));
  afterEach(() => restoreSize());

  it('the menu of a knob: its routes switched off and on, its default, its routes cleared', () => {
    const { model, actions, modulation, menuOf } = setup();
    act(() => {
      actions.setNumericValue('cutoff', 1000);
      modulation[1].addRoute('env2', 'filter.cutoff', 0.25);
      modulation[1].addRoute('lfo1', 'filter.cutoff');
      modulation[1].addRoute('env2', 'filter.resonance');
    });
    const menu = menuOf('Cutoff');
    expect(
      within(menu)
        .getAllByTestId('menu-route')
        .map((row) => row.textContent?.slice(0, 5))
    ).toEqual(['ENV 2', 'LFO 1']);
    fireEvent.click(within(menu).getByRole('button', { name: 'LFO 1 on' }));
    expect(modulation[0].$routes.value[1]).toMatchObject({ source: 'lfo1', off: true });

    // its row dragged right: the amount of the route, in the units of the knob
    const amount = within(menu).getByRole('slider', { name: 'ENV 2 amount' });
    expect(amount.getAttribute('aria-valuetext')).toBe('+2.8 oct');
    dragRight(amount, 30);
    expect(modulation[0].$routes.value[0]).toMatchObject({ source: 'env2', amount: 0.55 });
    expect(amount.getAttribute('aria-valuetext')).toBe('+6.1 oct');

    fireEvent.click(within(menu).getByRole('button', { name: /Default/ }));
    expect(model.$filter.value.cutoff).toBe(440);

    fireEvent.click(within(menuOf('Cutoff')).getByRole('button', { name: 'Clear modulation' }));
    expect(modulation[0].$routes.value).toEqual([
      { source: 'env2', target: 'filter.resonance', amount: 0.5 },
    ]);
  });

  it('the default of a knob within the range of the type: the resonance of a bandpass at its lowest', () => {
    const { model, actions, menuOf } = setup();
    act(() => {
      actions.setType('bandpass');
      actions.setNumericValue('resonance', 5);
    });
    fireEvent.click(within(menuOf('Res')).getByRole('button', { name: /Default/ }));
    expect(model.$filter.value.resonance).toBe(0.01);
  });
});
