import { DEMOS } from '../data/demos';
import { MESSAGES } from '../i18n';
import { jsonLd } from './json-ld';

type Node = Record<string, unknown> & { '@type': string };

const graph = (lang: 'en' | 'es' | 'de') =>
  jsonLd(lang, MESSAGES[lang], '/_astro/synth.webp')['@graph'] as unknown as Node[];

describe('jsonLd', () => {
  it('describes the synth as a free web application with its features and profiles', () => {
    const app = graph('de').find((node) => node['@type'] === 'WebApplication');
    expect(app).toMatchObject({
      name: 'Waveform',
      url: 'https://waveform.qvantor.org/',
      applicationCategory: 'MultimediaApplication',
      operatingSystem: 'Any (web browser)',
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
      featureList: MESSAGES.de.featureList,
      screenshot: 'https://waveform.qvantor.org/_astro/synth.webp',
      inLanguage: 'en',
      sameAs: [
        'https://github.com/qvantor/waveform',
        'https://www.instagram.com/waveformsound/',
        'https://www.youtube.com/@waveform-sound',
      ],
    });
  });

  it('has the questions of the page in its language', () => {
    const faq = graph('es').find((node) => node['@type'] === 'FAQPage');
    expect(faq).toMatchObject({
      url: 'https://waveform.qvantor.org/es/sintetizador-wavetable/',
      inLanguage: 'es',
    });
    expect(faq?.['mainEntity']).toEqual(
      MESSAGES.es.faq.items.map(({ q, a }) => ({
        '@type': 'Question',
        name: q,
        acceptedAnswer: { '@type': 'Answer', text: a },
      }))
    );
  });

  it('has every clip as an audio object of absolute URL and ISO duration', () => {
    const clips = graph('en').filter((node) => node['@type'] === 'AudioObject');
    expect(clips.map((clip) => clip['name'])).toEqual(DEMOS.map((demo) => demo.name));
    expect(clips[0]).toEqual({
      '@type': 'AudioObject',
      '@id': 'https://waveform.qvantor.org/wavetable-synth/#zesty-drive-bass',
      name: 'Zesty Drive Bass',
      description: MESSAGES.en.demos['zesty-drive-bass'],
      contentUrl: 'https://waveform.qvantor.org/demos/zesty-drive-bass.mp3',
      encodingFormat: 'audio/mpeg',
      duration: 'PT9.7S',
    });
  });
});
