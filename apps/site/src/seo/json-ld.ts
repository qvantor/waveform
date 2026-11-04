import { clipOf, isoDuration } from '../data/clips';
import { DEMOS, demoPath } from '../data/demos';
import type { Messages } from '../i18n';
import { LINKS, SYNTH_URL, absolute, pageUrl, type Lang } from '../i18n/locales';

// the structured data of a version of the page: the synth (a web application), the questions of the page and its
// clips; what search engines and AI assistants read as facts
export const jsonLd = (lang: Lang, messages: Messages, screenshot: string) => {
  const url = pageUrl(lang);
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebApplication',
        '@id': `${SYNTH_URL}#app`,
        name: 'Waveform',
        url: SYNTH_URL,
        description: messages.meta.description,
        applicationCategory: 'MultimediaApplication',
        operatingSystem: 'Any (web browser)',
        browserRequirements: 'Web Audio API with AudioWorklet, WebAssembly SIMD',
        // the interface of the synth is in English
        inLanguage: 'en',
        isAccessibleForFree: true,
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
        featureList: messages.featureList,
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
