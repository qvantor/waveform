import { clipOf, isoDuration } from '../data/clips';
import { DEMOS, demoPath } from '../data/demos';
import type { Messages } from '../i18n';
import { LINKS, SYNTH_URL, absolute, pageUrl, type Lang } from '../i18n/locales';

// the synth as a web application: one entity (`#app`) on every version of the page and on the synth's own (/), so
// its texts are in English, the language of its interface, and its description is the one of the JSON-LD of
// apps/chisper/src/index.html (tests/dist.test.mjs holds them equal)
export const APP_DESCRIPTION =
  'Chisper is a free wavetable synthesizer that runs in the browser on a computer, a Chromebook or a phone: two wavetable oscillators with supersaw unison of up to 8 voices, a filter in every voice, three envelopes and four LFOs on any knob, distortion, delay and reverb, MIDI and shareable presets.';

export const FEATURES = [
  'Two wavetable oscillators, tables of up to 256 frames',
  'Supersaw unison of up to 8 voices per oscillator with Detune and Blend',
  'A filter in every voice, 8 types',
  'Three envelopes, four LFOs and velocity routed to any knob',
  'Tempo sync and MIDI Clock',
  'Distortion, delay and reverb in any order, a master limiter',
  'MIDI keyboards, pitch bend, the computer keyboard and an on-screen piano',
  'Poly and mono, legato and portamento',
  'Wavetable editor: drawing, audio files, the WAV wavetables of other synths',
  'Community presets shared by link',
];

// the structured data of a version of the page: the synth, the questions of the page and its clips (in the
// language of the page); what search engines and AI assistants read as facts
export const jsonLd = (lang: Lang, messages: Messages, screenshot: string) => {
  const url = pageUrl(lang);
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebApplication',
        '@id': `${SYNTH_URL}#app`,
        name: 'Chisper',
        url: SYNTH_URL,
        description: APP_DESCRIPTION,
        applicationCategory: 'MultimediaApplication',
        operatingSystem: 'Any (web browser)',
        browserRequirements: 'Web Audio API with AudioWorklet, WebAssembly SIMD',
        inLanguage: 'en',
        isAccessibleForFree: true,
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
        featureList: FEATURES,
        screenshot: absolute(screenshot),
        author: { '@type': 'Person', name: 'Qvantor', url: 'https://github.com/qvantor' },
        sameAs: [LINKS.github, LINKS.instagram, LINKS.youtube],
      },
      {
        '@type': 'FAQPage',
        '@id': `${url}#faq`,
        url,
        name: messages.meta.title,
        inLanguage: lang,
        about: { '@id': `${SYNTH_URL}#app` },
        mainEntity: messages.faq.items.map(({ q, a }) => ({
          '@type': 'Question',
          name: q,
          acceptedAnswer: { '@type': 'Answer', text: a },
        })),
      },
      ...DEMOS.map((demo) => ({
        '@type': 'AudioObject',
        '@id': `${url}#${demo.slug}`,
        name: demo.name,
        description: messages.demos[demo.slug],
        contentUrl: absolute(demoPath(demo.slug)),
        encodingFormat: 'audio/mpeg',
        duration: isoDuration(clipOf(demo.slug).duration),
      })),
    ],
  };
};
