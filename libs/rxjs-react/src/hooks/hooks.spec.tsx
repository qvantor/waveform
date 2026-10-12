import React from 'react';
import { act, renderHook } from '@testing-library/react';
import { BehaviorSubject, Subject } from 'rxjs';
import { rxModel } from '../services/rx-model';
import { useBehaviorSubject } from './use-behavior-subject';
import { useNullableContext } from './use-nullable-context';
import { useObservable } from './use-observable';
import { useRxModel } from './use-rx-model';

describe('useObservable', () => {
  it('starts with the initial value and follows emissions', () => {
    const subject = new Subject<number>();
    const { result } = renderHook(() => useObservable(subject, 0));
    expect(result.current).toBe(0);

    act(() => subject.next(5));
    expect(result.current).toBe(5);
  });

  it('unsubscribes on unmount', () => {
    const subject = new Subject<number>();
    const { unmount } = renderHook(() => useObservable(subject, 0));
    expect(subject.observed).toBe(true);
    unmount();
    expect(subject.observed).toBe(false);
  });

  it('resubscribes when the observable changes', () => {
    const first = new BehaviorSubject(1);
    const second = new BehaviorSubject(2);
    const { result, rerender } = renderHook(({ observable }) => useObservable(observable, 0), {
      initialProps: { observable: first },
    });
    expect(result.current).toBe(1);

    rerender({ observable: second });
    expect(result.current).toBe(2);
    expect(first.observed).toBe(false);
  });
});

describe('useBehaviorSubject', () => {
  it('returns the current value and updates on next', () => {
    const subject = new BehaviorSubject('a');
    const { result } = renderHook(() => useBehaviorSubject(subject));
    expect(result.current).toBe('a');

    act(() => subject.next('b'));
    expect(result.current).toBe('b');
  });
});

describe('useNullableContext', () => {
  const Context = React.createContext<number | null>(null);

  it('returns the context value inside a provider', () => {
    const wrapper = ({ children }: React.PropsWithChildren) => (
      <Context.Provider value={0}>{children}</Context.Provider>
    );
    const { result } = renderHook(() => useNullableContext(Context), { wrapper });
    expect(result.current).toBe(0);
  });

  it('throws outside of a provider', () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => renderHook(() => useNullableContext(Context, 'useFoo'))).toThrow(
      'Do not use useFoo outside of it Provider'
    );
    jest.restoreAllMocks();
  });
});

describe('useRxModel', () => {
  it('inits the model once with deps and initial value and stops it on unmount', () => {
    const destroy = jest.fn();
    const factory = jest.fn((deps: { step: number }) =>
      rxModel((initial: number) => ({ $value: new BehaviorSubject(initial) }))
        .actions(({ $value }) => ({ inc: () => $value.next($value.value + deps.step) }))
        .destroy(destroy)
    );

    const { result, rerender, unmount } = renderHook(() => useRxModel('counter', factory, { step: 2 }, 1));
    const [model, actions] = result.current;
    expect(model.$value.value).toBe(1);

    actions.inc();
    expect(model.$value.value).toBe(3);

    rerender();
    expect(factory).toHaveBeenCalledTimes(1);
    expect(result.current[0]).toBe(model);

    unmount();
    expect(destroy).toHaveBeenCalledWith(model);
  });
});
