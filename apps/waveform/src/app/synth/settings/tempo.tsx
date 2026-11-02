import { TEMPO_DEFAULT, TEMPO_MAX, TEMPO_MIN } from '@waveform/preset-schema';
import { TempoField } from '@waveform/ui-kit';
import { useBehaviorSubject } from '@waveform/rxjs-react';
import { useTransport } from '../common/modules';

// the tempo of the synth in the header, next to Midi: the field's own (kept by the browser, a preset switch keeps
// it), or the one a MIDI Clock leads (EXT: shown only, to 0.1, not kept)
export const Tempo = () => {
  const [{ $bpm, $tempo, $source }, { setBpm }] = useTransport();
  const bpm = useBehaviorSubject($bpm);
  const tempo = useBehaviorSubject($tempo);
  const external = useBehaviorSubject($source) === 'midi';
  // a measured tempo to 0.1: its last digits jitter
  return external ? (
    <TempoField value={Math.round(tempo * 10) / 10} min={TEMPO_MIN} max={TEMPO_MAX} label='EXT' />
  ) : (
    <TempoField
      value={bpm}
      min={TEMPO_MIN}
      max={TEMPO_MAX}
      label='BPM'
      defaultValue={TEMPO_DEFAULT}
      onChange={setBpm}
    />
  );
};
