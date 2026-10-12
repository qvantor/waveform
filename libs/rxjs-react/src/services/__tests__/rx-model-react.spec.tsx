import React from 'react';
import { act, render, renderHook, screen } from '@testing-library/react';
import { BehaviorSubject } from 'rxjs';
import { useBehaviorSubject } from '../../hooks';
import { Model } from '../../types';
import { rxModel } from '../rx-model';
import { rxModelReact } from '../rx-model-react';

const counter = ({ step }: { step: number }) =>
  rxModel((initial: number) => ({ $count: new BehaviorSubject(initial) })).actions(({ $count }) => ({
    inc: () => $count.next($count.value + step),
  }));

const { ModelProvider, useModel } = rxModelReact('counter', counter);

const Counter = () => {
  const [{ $count }, { inc }] = useModel();
  const count = useBehaviorSubject($count);
  return (
    <button type='button' onClick={inc}>
      {count}
    </button>
  );
};

describe('rxModelReact', () => {
  it('provides the model built from initial and dependency props', () => {
    render(
      <ModelProvider initial={10} step={5}>
        <Counter />
      </ModelProvider>
    );
    const button = screen.getByRole('button');
    expect(button.textContent).toBe('10');

    act(() => button.click());
    expect(button.textContent).toBe('15');
  });

  it('returns the [model, actions] tuple from useModel', () => {
    const wrapper = ({ children }: React.PropsWithChildren) => (
      <ModelProvider initial={1} step={1}>
        {children}
      </ModelProvider>
    );
    const { result } = renderHook(() => useModel(), { wrapper });
    const [model, actions]: Model<{ $count: BehaviorSubject<number> }, { inc: () => void }> = result.current;
    expect(model.$count.value).toBe(1);
    expect(typeof actions.inc).toBe('function');
  });

  it('gives every provider its own model', () => {
    render(
      <>
        <ModelProvider initial={1} step={1}>
          <Counter />
        </ModelProvider>
        <ModelProvider initial={100} step={1}>
          <Counter />
        </ModelProvider>
      </>
    );
    const [first, second] = screen.getAllByRole('button');
    act(() => first.click());
    expect(first.textContent).toBe('2');
    expect(second.textContent).toBe('100');
  });

  it('throws when useModel is used outside of the provider', () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => renderHook(() => useModel())).toThrow();
    jest.restoreAllMocks();
  });
});
