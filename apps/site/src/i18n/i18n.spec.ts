import { DEMOS } from '../data/demos';
import { LANGS, LOCALES, pageUrl } from './locales';
import { MESSAGES, fill, marks } from './index';

// the paths of every string of a value: `faq.items.0.q`
const leaves = (value: unknown, path = ''): [string, unknown][] =>
  value !== null && typeof value === 'object'
    ? Object.entries(value).flatMap(([key, inner]) => leaves(inner, path ? `${path}.${key}` : key))
    : [[path, value]];

// the names of the synth that stay in English in every language
const GLOSSARY = ['Wave', 'Detune', 'Blend', 'ENV', 'LFO', 'VELO', 'Oct', 'Semi', 'Fine', 'Cutoff', 'Mix'];

describe('the messages', () => {
  const english = leaves(MESSAGES.en);

  it.each(LANGS)('%s has every text of English and no other, none empty', (lang) => {
    const texts = leaves(MESSAGES[lang]);
    expect(texts.map(([path]) => path)).toEqual(english.map(([path]) => path));
    for (const [path, text] of texts) {
      expect(typeof text).toBe('string');
      expect({ path, text: (text as string).trim() }).not.toEqual({ path, text: '' });
    }
  });

  it.each(LANGS)('%s describes every clip', (lang) => {
    expect(Object.keys(MESSAGES[lang].demos).sort()).toEqual(DEMOS.map((demo) => demo.slug).sort());
  });

  it.each(LANGS)('%s keeps the names of the knobs and sections in English', (lang) => {
    const text = leaves(MESSAGES[lang].features)
      .map(([, value]) => value)
      .join(' ');
    for (const name of GLOSSARY) expect(text).toContain(name);
  });

  it('has a title, a description and an H1 of its own in each language', () => {
    for (const key of ['title', 'description'] as const) {
      expect(new Set(LANGS.map((lang) => MESSAGES[lang].meta[key])).size).toBe(LANGS.length);
    }
    expect(new Set(LANGS.map((lang) => MESSAGES[lang].hero.h1)).size).toBe(LANGS.length);
  });

  it('starts every H1 with the name, in the colors of the logo (Hero.astro)', () => {
    for (const lang of LANGS) expect(MESSAGES[lang].hero.h1).toMatch(/^Waveform\b/);
  });

  it('keeps titles and descriptions within what search results show', () => {
    for (const lang of LANGS) {
      expect(MESSAGES[lang].meta.title.length).toBeLessThanOrEqual(60);
      expect(MESSAGES[lang].meta.description.length).toBeLessThanOrEqual(180);
    }
  });

  it.each(LANGS)('%s marks words only under the title, each mark closed', (lang) => {
    for (const [path, text] of leaves(MESSAGES[lang])) {
      const count = (text as string).split('**').length - 1;
      if (path === 'hero.lead' || path === 'hero.details') {
        expect({ path, count: count > 0 && count % 2 === 0 }).toEqual({ path, count: true });
      } else expect({ path, count }).toEqual({ path, count: 0 });
    }
  });

  it('explains the wavetable once in Spanish', () => {
    expect(MESSAGES.es.hero.lead).toContain('tablas de ondas');
  });
});

describe('the locales', () => {
  it('gives each language a path of its own under the site', () => {
    expect(LANGS.map(pageUrl)).toEqual([
      'https://waveform.qvantor.org/wavetable-synth/',
      'https://waveform.qvantor.org/es/sintetizador-wavetable/',
      'https://waveform.qvantor.org/de/wavetable-synthesizer/',
    ]);
    expect(LOCALES.en.ogLocale).toBe('en_US');
  });
});

describe('marks', () => {
  it('splits a text into the words that stand out and the rest, in order', () => {
    expect(marks('a **free synth** in **the browser**.')).toEqual([
      { text: 'a ', strong: false },
      { text: 'free synth', strong: true },
      { text: ' in ', strong: false },
      { text: 'the browser', strong: true },
      { text: '.', strong: false },
    ]);
    expect(marks('**Two** oscillators')).toEqual([
      { text: 'Two', strong: true },
      { text: ' oscillators', strong: false },
    ]);
    expect(marks('plain')).toEqual([{ text: 'plain', strong: false }]);
  });
});

describe('fill', () => {
  it('puts the values into a message and keeps an unknown key', () => {
    expect(fill('Play {name}', { name: 'Acid Bass' })).toBe('Play Acid Bass');
    expect(fill('{name} abspielen {x}', { name: 'Sub Bass' })).toBe('Sub Bass abspielen {x}');
  });
});
