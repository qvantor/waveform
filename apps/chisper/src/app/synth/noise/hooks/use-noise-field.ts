import React from 'react';
import { distinctUntilChanged, map } from 'rxjs';
import { useObservable } from '@chisper/rxjs-react';
import type { NoiseKnobs, NoiseModel } from '../../common/modules/noise';

// one value of $noise: a component renders on its change only (every step of a knob is a new $noise)
export const useNoiseField = <K extends keyof NoiseKnobs>($noise: NoiseModel['$noise'], field: K) => {
  const $value = React.useMemo(
    () =>
      $noise.pipe(
        map((noise) => noise[field]),
        distinctUntilChanged()
      ),
    [$noise, field]
  );
  return useObservable($value, $noise.value[field]);
};
