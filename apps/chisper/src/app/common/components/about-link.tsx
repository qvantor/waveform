import { MdInfoOutline } from 'react-icons/md';
import { styled } from 'styled-components';
import { PanelLink } from '@chisper/ui-kit';

// the promo page of the synth (apps/site), its English version
export const ABOUT_PATH = '/wavetable-synth/';

const ABOUT_LABEL = 'About Chisper';

// a square key of the icon alone, as ◀ above it and the gear of the settings
const Key = styled(PanelLink)`
  flex: 0 0 40px;
  gap: 0;
  padding: 0;
`;

// the first key of the strip of the presets, under ◀ (then Save, Share, MIDI, settings); in a new tab: the synth
// plays on in its own with what no snapshot keeps (a table drawn or imported in the editor)
export const AboutLink = () => (
  <Key
    href={ABOUT_PATH}
    target='_blank'
    rel='noopener'
    icon={<MdInfoOutline />}
    aria-label={ABOUT_LABEL}
    title={ABOUT_LABEL}
  />
);
