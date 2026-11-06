import { DEMOS } from '../data/demos';
import { MESSAGES } from '../i18n';
import { APP_DESCRIPTION, FEATURES, jsonLd } from './json-ld';

type Node = Record<string, unknown> & { '@type': string };

const graph = (lang: 'en' | 'es' | 'de') =>
  jsonLd(lang, MESSAGES[lang], '/_astro/synth.webp')['@graph'] as unknown as Node[];

describe('jsonLd', () => {
  const appOf = (lang: 'en' | 'es' | 'de') => graph(lang).find((node) => node['@type'] === 'WebApplication');

  it('describes the synth as a free web application with its features and profiles', () => {
    expect(appOf('de')).toMatchObject({
      '@id': 'https://chisper.qvantor.org/#app',
      name: 'Chisper',
      url: 'https://chisper.qvantor.org/',
      applicationCategory: 'MultimediaApplication',
      operatingSystem: 'Any (web browser)',
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
      description: APP_DESCRIPTION,
      featureList: FEATURES,
      screenshot: 'https://chisper.qvantor.org/_astro/synth.webp',
      inLanguage: 'en',
      sameAs: [
        'https://github.com/qvantor/chisper',
        'https://www.instagram.com/chispersound/',
        'https://www.youtube.com/@chisper-sound',
      ],
    });
  });

  it('has the same app in English on every version of the page', () => {
    expect(appOf('es')).toEqual(appOf('en'));
    expect(appOf('de')).toEqual(appOf('en'));
  });

  it('has the questions of the page in its language', () => {
    const faq = graph('es').find((node) => node['@type'] === 'FAQPage');
    expect(faq).toMatchObject({
      url: 'https://chisper.qvantor.org/es/sintetizador-wavetable/',
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
      '@id': 'https://chisper.qvantor.org/wavetable-synth/#zesty-drive-bass',
      name: 'Zesty Drive Bass',
      description: MESSAGES.en.demos['zesty-drive-bass'],
      contentUrl: 'https://chisper.qvantor.org/demos/zesty-drive-bass.mp3',
      encodingFormat: 'audio/mpeg',
      duration: 'PT9.7S',
    });
  });
});
