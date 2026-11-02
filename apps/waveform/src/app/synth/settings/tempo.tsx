import { TEMPO_DEFAULT, TEMPO_MAX, TEMPO_MIN } from '@waveform/preset-schema';
import { TempoField } from '@waveform/ui-kit';
import { useBehaviorSubject } from '@waveform/rxjs-react';
import { useTransport } from '../common/modules';

// the tempo of the synth in the header, next to Midi: the field's own (kept by the browser, a preset switch keeps
// it), or the one a MIDI Clock leads (EXT: shown only, not kept)
export const Tempo = () => {
  const [{ $bpm, $tempo, $source }, { setBpm }] = useTransport();
  const bpm = useBehaviorSubject($bpm);
  const tempo = useBehaviorSubject($tempo);
  const external = useBehaviorSubject($source) === 'midi';
  return external ? (
    <TempoField value={tempo} min={TEMPO_MIN} max={TEMPO_MAX} label='EXT' />
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
