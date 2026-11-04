// the languages of the promo page: each version is a page of its own slug (written for its own searches), so they
// are plain routes, not the i18n routing of Astro (the same path under a prefix); the root (/) is the synth
export const SITE = 'https://waveform.qvantor.org';

export const LANGS = ['en', 'es', 'de'] as const;
export type Lang = (typeof LANGS)[number];

// x-default and the language the synth links to (About)
export const DEFAULT_LANG: Lang = 'en';

type Locale = {
  path: string;
  // og:locale
  ogLocale: string;
  // the name in the language switch, in its own language
  name: string;
};

export const LOCALES: Record<Lang, Locale> = {
  en: { path: '/wavetable-synth/', ogLocale: 'en_US', name: 'English' },
  es: { path: '/es/sintetizador-wavetable/', ogLocale: 'es_ES', name: 'Español' },
  de: { path: '/de/wavetable-synthesizer/', ogLocale: 'de_DE', name: 'Deutsch' },
};

export const pageUrl = (lang: Lang) => new URL(LOCALES[lang].path, SITE).href;

// the absolute URL of a path of the site (the synth, a clip, an image)
export const absolute = (path: string) => new URL(path, SITE).href;

export const SYNTH_URL = absolute('/');

export const presetUrl = (presetId: string) => `/?preset=${presetId}`;

export const LINKS = {
  github: 'https://github.com/qvantor/waveform',
  instagram: 'https://www.instagram.com/waveformsound/',
  youtube: 'https://www.youtube.com/@waveform-sound',
};
