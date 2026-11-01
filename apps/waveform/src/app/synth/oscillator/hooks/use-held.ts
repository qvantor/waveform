import React from 'react';
import { BehaviorSubject, distinctUntilChanged, map } from 'rxjs';

// controls held at once (two fingers: Phase and Phase rand, Detune, Blend and Unison): `$held` while any of them is;
// the `onActiveChange` of each. An observable, not a state: a press renders the overlay that shows it, not the
// component that holds it
export const useHeld = () => {
  const [$count] = React.useState(() => new BehaviorSubject(0));
  const $held = React.useMemo(
    () =>
      $count.pipe(
        map((count) => count > 0),
        distinctUntilChanged()
      ),
    [$count]
  );
  const onActiveChange = React.useCallback(
    (active: boolean) => $count.next($count.value + (active ? 1 : -1)),
    [$count]
  );
  return [$held, onActiveChange] as const;
};
