import { useNullableContext } from '@waveform/rxjs';
import { AppContext } from '../constants';

export const useAppContext = () => useNullableContext(AppContext, 'useAppContext');
