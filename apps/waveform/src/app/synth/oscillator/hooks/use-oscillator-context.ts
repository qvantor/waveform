import React from 'react';
import { useNullableContext } from '@waveform/rxjs-react';
import { useOscillator1 } from '../../common/modules';

export const OscillatorContext = React.createContext<ReturnType<typeof useOscillator1> | null>(null);

export const useOscillatorContext = () => useNullableContext(OscillatorContext);
