import { MdInfoOutline } from 'react-icons/md';
import { styled } from 'styled-components';
import { PanelLink } from '@waveform/ui-kit';

// the promo page of the synth (apps/site), its English version
export const ABOUT_PATH = '/wavetable-synth/';

export const ABOUT_LABEL = 'About Waveform';

// a square key of the icon alone, as the gear of the settings before it
const Key = styled(PanelLink)`
  flex: 0 0 40px;
  gap: 0;
  padding: 0;
`;

// the last key of the strip of the presets (Save, Share, MIDI, settings); in the same tab: the tab keeps the
// edited preset (presetState) for the way back
export const AboutLink = () => (
  <Key href={ABOUT_PATH} icon={<MdInfoOutline />} aria-label={ABOUT_LABEL} title={ABOUT_LABEL} />
);
