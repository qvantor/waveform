// The promo pages as built (`nx run site:verify` builds them first): what a crawler without JS gets from each
// version, the links between them, the structured data, the sitemap, robots.txt of the synth and every file a
// page refers to.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { JSDOM } from 'jsdom';

const ROOT = join(import.meta.dirname, '../../..');
const DIST = join(ROOT, 'dist/apps/site');
const SITE = 'https://chisper.qvantor.org';

const PAGES = {
  en: { path: '/wavetable-synth/', ogLocale: 'en_US' },
  es: { path: '/es/sintetizador-wavetable/', ogLocale: 'es_ES' },
  de: { path: '/de/wavetable-synthesizer/', ogLocale: 'de_DE' },
};
const LANGS = Object.keys(PAGES);
const CLIPS = [
  'zesty-drive-bass',
  'warehouse-lead',
  'biting-brass-keys',
  'ufo-drone',
  'harp-pluck',
  'noise-riser',
  'acid-bass',
  'helicopter',
  'rhodes-keys',
  'sonar-ping',
  'lo-fi-tape-keys',
  'theremin',
  'sub-bass',
];
// phrases of the features, the clips and the questions each page has to carry in its HTML
const TEXTS = {
  en: [
    'up to 256 frames',
    'Up to 8 voices per oscillator',
    'lowpass, highpass, bandpass',
    'up to 64 routes, 4 per knob',
    'algorithmic reverb of 16 lines',
    'Up to 12 notes in Poly',
    'WAV wavetables you already have from other synths',
    'Save a sound without signing up',
    'A 303 saw table',
    'What is a wavetable synth?',
    'How wavetable synthesis works',
    'Drum and bass',
    'music in any electronic style and beyond',
    'Does Chisper work with my MIDI keyboard?',
    'Does Chisper work on a Chromebook, iPad or iPhone?',
    'Is Chisper good for learning synthesis?',
    'Can I use the sounds in my tracks?',
    'commercial releases included',
    'PolyForm Noncommercial',
  ],
  es: [
    'tablas de ondas',
    'Hasta 8 voces por oscilador',
    'paso bajo',
    'MIDI Clock',
    '¿Qué es un sintetizador wavetable?',
    'Cómo funciona la síntesis wavetable',
    'cualquier estilo electrónico y más allá',
    '¿Chisper funciona en un Chromebook, iPad o iPhone?',
    '¿Chisper sirve para aprender síntesis?',
    '¿Puedo usar los sonidos en mis canciones?',
  ],
  de: [
    'Tiefpass',
    'Bis zu 8 Stimmen pro Oszillator',
    'Hüllkurven',
    'Ist Chisper kostenlos?',
    'Was ist ein Wavetable-Synthesizer?',
    'So funktioniert Wavetable-Synthese',
    'in jedem elektronischen Stil und darüber hinaus',
    'Funktioniert Chisper auf Chromebook, iPad oder iPhone?',
    'Eignet sich Chisper zum Lernen von Synthese?',
    'Darf ich die Sounds in meinen Tracks verwenden?',
  ],
};

const pageOf = (lang) => {
  const file = join(DIST, PAGES[lang].path, 'index.html');
  assert.ok(existsSync(file), `${file} built`);
  return new JSDOM(readFileSync(file, 'utf8')).window.document;
};

const attr = (document, selector, name) => document.querySelector(selector)?.getAttribute(name);

// a path of the site (/_astro/…, /demos/…, /og/…) is a file of the build; the synth's are not ours
const isOwn = (url) => url.startsWith('/') && !url.startsWith('//') && url !== '/' && !url.startsWith('/?');
const fileOf = (url) => join(DIST, decodeURIComponent(new URL(url, SITE).pathname));

describe('every version of the page', () => {
  for (const lang of LANGS) {
    describe(lang, () => {
      const document = pageOf(lang);
      const url = `${SITE}${PAGES[lang].path}`;

      it('has its language, title, description and canonical', () => {
        assert.equal(document.documentElement.lang, lang);
        assert.ok(document.title.includes('Chisper'));
        assert.ok(attr(document, 'meta[name="description"]', 'content').length > 80);
        assert.equal(attr(document, 'link[rel="canonical"]', 'href'), url);
      });

      it('links every version and x-default (English)', () => {
        const links = [...document.querySelectorAll('link[rel="alternate"][hreflang]')].map((link) => [
          link.getAttribute('hreflang'),
          link.getAttribute('href'),
        ]);
        assert.deepEqual(links, [
          ...LANGS.map((other) => [other, `${SITE}${PAGES[other].path}`]),
          ['x-default', `${SITE}${PAGES.en.path}`],
        ]);
      });

      it('has Open Graph and Twitter of its language', () => {
        assert.equal(attr(document, 'meta[property="og:url"]', 'content'), url);
        assert.equal(attr(document, 'meta[property="og:locale"]', 'content'), PAGES[lang].ogLocale);
        const alternates = [...document.querySelectorAll('meta[property="og:locale:alternate"]')].map(
          (meta) => meta.getAttribute('content')
        );
        assert.deepEqual(
          alternates,
          LANGS.filter((other) => other !== lang).map((other) => PAGES[other].ogLocale)
        );
        const image = attr(document, 'meta[property="og:image"]', 'content');
        assert.equal(image, `${SITE}/og/${lang}.png`);
        assert.ok(existsSync(fileOf(image)), image);
        assert.equal(attr(document, 'meta[name="twitter:card"]', 'content'), 'summary_large_image');
        assert.equal(attr(document, 'meta[name="twitter:image"]', 'content'), image);
      });

      it('has one H1 and an H2 per section', () => {
        assert.equal(document.querySelectorAll('h1').length, 1);
        assert.ok(document.querySelectorAll('h2').length >= 10);
      });

      it('has structured data that parses: the app, the questions, every clip', () => {
        const scripts = [...document.querySelectorAll('script[type="application/ld+json"]')];
        assert.equal(scripts.length, 1);
        const graph = JSON.parse(scripts[0].textContent)['@graph'];
        const types = graph.map((node) => node['@type']);
        assert.equal(types.filter((type) => type === 'WebApplication').length, 1);
        assert.equal(types.filter((type) => type === 'FAQPage').length, 1);
        const faq = graph.find((node) => node['@type'] === 'FAQPage');
        assert.equal(faq.mainEntity.length, document.querySelectorAll('#faq details').length);
        const audio = graph.filter((node) => node['@type'] === 'AudioObject');
        assert.deepEqual(
          audio.map((node) => node.contentUrl),
          CLIPS.map((slug) => `${SITE}/demos/${slug}.mp3`)
        );
        for (const node of audio) assert.match(node.duration, /^PT\d+(\.\d)?S$/);
        const app = graph.find((node) => node['@type'] === 'WebApplication');
        // the same app as on the page of the synth (/)
        assert.equal(app['@id'], `${SITE}/#app`);
        assert.ok(existsSync(fileOf(app.screenshot)), app.screenshot);
      });

      it('has every clip with its player, caption and preset link', () => {
        const cards = [...document.querySelectorAll('[data-player]')];
        assert.deepEqual(
          cards.map((card) => card.querySelector('audio').getAttribute('src')),
          CLIPS.map((slug) => `/demos/${slug}.mp3`)
        );
        for (const card of cards) {
          assert.equal(card.querySelector('audio').getAttribute('preload'), 'none');
          assert.ok(Number(card.dataset.duration) > 0);
          assert.ok(card.querySelector('[data-wave] path').getAttribute('d').length > 1000);
          assert.ok(card.querySelector('.caption').textContent.trim().length > 30);
          assert.match(card.querySelector('a.open').getAttribute('href'), /^\/\?preset=[0-9a-f-]{36}$/);
        }
      });

      it('carries the texts of the features, clips and questions without JS', () => {
        const text = document.body.textContent.replace(/\s+/g, ' ');
        for (const phrase of TEXTS[lang]) assert.ok(text.includes(phrase), phrase);
      });

      it('refers only to files the build has', () => {
        const urls = [
          ...[...document.querySelectorAll('[src], [href]')].map(
            (element) => element.getAttribute('src') ?? element.getAttribute('href')
          ),
          ...[...document.querySelectorAll('source[srcset], img[srcset]')].flatMap((element) =>
            element
              .getAttribute('srcset')
              .split(',')
              .map((candidate) => candidate.trim().split(/\s+/)[0])
          ),
        ];
        const own = urls.filter(
          (url) => isOwn(url) && !Object.values(PAGES).some((page) => page.path === url)
        );
        assert.ok(own.length > 20);
        // the favicon is the synth's
        for (const url of own.filter((url) => url !== '/favicon.ico'))
          assert.ok(existsSync(fileOf(url)), url);
      });

      it('links GitHub, Instagram and YouTube by their icons, each named', () => {
        const social = [...document.querySelectorAll('footer .social a')];
        assert.deepEqual(
          social.map((link) => [link.getAttribute('aria-label'), link.getAttribute('href')]),
          [
            ['GitHub', 'https://github.com/qvantor/chisper'],
            ['Instagram', 'https://www.instagram.com/chispersound/'],
            ['YouTube', 'https://www.youtube.com/@chisper-sound'],
          ]
        );
        for (const link of social) assert.ok(link.querySelector('svg path').getAttribute('d').length > 100);
      });

      it('shows the synth playing in a light video, loaded only when played, its first frame under it', () => {
        const video = document.querySelector('.window video');
        for (const name of ['muted', 'loop', 'playsinline', 'data-autoplay'])
          assert.ok(video.hasAttribute(name), name);
        assert.equal(video.getAttribute('preload'), 'none');
        assert.ok(video.getAttribute('aria-label').length > 40);
        const still = document.querySelector('.window .screen img');
        assert.equal(still.getAttribute('loading'), 'lazy');
        assert.ok(existsSync(fileOf(still.getAttribute('src'))));
        const sources = [...video.querySelectorAll('source')];
        assert.deepEqual(
          sources.map((source) => source.getAttribute('type')),
          ['video/mp4', 'video/webm']
        );
        for (const source of sources) {
          const file = fileOf(source.getAttribute('src'));
          assert.ok(existsSync(file));
          assert.ok(statSync(file).size < 1_500_000, 'a light video');
        }
      });

      it('has the pictures of the features (the editor too), a phone among them', () => {
        assert.equal(document.querySelectorAll('.feature figure img').length, 7);
        assert.equal(document.querySelectorAll('.feature figure.phone img').length, 1);
      });

      it('makes the words of the first section stand out, what it has under the synth, no marks left', () => {
        assert.ok(document.querySelectorAll('.hero .lead strong').length >= 2);
        // what it has under the synth playing, not under the title
        assert.equal(document.querySelectorAll('.hero .details').length, 0);
        assert.ok(document.querySelectorAll('.shot-band .details strong').length >= 2);
        assert.ok(!document.body.textContent.includes('**'));
        // a word that stands out keeps the spaces around it
        assert.match(document.querySelector('.hero .lead').textContent, /^Chisper \S/);
      });

      it('explains wavetable synthesis in three cards, each with its picture, title and text', () => {
        const cards = [...document.querySelectorAll('#synthesis .card')];
        assert.equal(cards.length, 3);
        for (const card of cards) {
          assert.ok(card.querySelector('.picture'));
          assert.ok(card.querySelector('h3').textContent.length > 10);
          assert.ok(card.querySelector('p').textContent.length > 80);
        }
        const drawing = cards[0].querySelector('svg.drawing');
        assert.equal(drawing.getAttribute('role'), 'img');
        assert.ok(drawing.getAttribute('aria-label').length > 40);
        assert.equal(drawing.querySelectorAll('polyline').length, 8);
        assert.equal(cards[1].querySelectorAll('.genres li').length, 12);
        assert.equal(cards[2].querySelector('.synth svg text').textContent, 'Wave');
        assert.ok(document.querySelector('#synthesis canvas[data-scene="synthesis"]'));
      });

      it('has images of a known size and text alternatives', () => {
        for (const image of document.querySelectorAll('img')) {
          assert.ok(Number(image.getAttribute('width')) > 0);
          assert.ok(Number(image.getAttribute('height')) > 0);
          // the first frame under the video is decorative: the video has the text
          if (image.closest('.window')) assert.equal(image.getAttribute('alt'), '');
          else assert.ok(image.getAttribute('alt').length > 20);
        }
      });
    });
  }
});

describe('the build', () => {
  it('leaves the root to the synth', () => {
    assert.equal(existsSync(join(DIST, 'index.html')), false);
    assert.equal(existsSync(join(DIST, 'assets')), false);
  });

  it('has a sitemap of the synth and the versions linked to each other', () => {
    assert.match(readFileSync(join(DIST, 'sitemap-index.xml'), 'utf8'), /sitemap-0\.xml/);
    const sitemap = new JSDOM(readFileSync(join(DIST, 'sitemap-0.xml'), 'utf8'), { contentType: 'text/xml' })
      .window.document;
    const urls = [...sitemap.getElementsByTagName('url')];
    assert.deepEqual(
      urls.map((url) => url.getElementsByTagName('loc')[0].textContent).sort(),
      [`${SITE}/`, ...LANGS.map((lang) => `${SITE}${PAGES[lang].path}`)].sort()
    );
    for (const url of urls) {
      const loc = url.getElementsByTagName('loc')[0].textContent;
      const links = [...url.getElementsByTagName('xhtml:link')].map((link) => link.getAttribute('hreflang'));
      assert.deepEqual(links, loc === `${SITE}/` ? [] : LANGS);
    }
  });
});

describe('the synth', () => {
  it('links the English version (About)', () => {
    const source = readFileSync(join(ROOT, 'apps/chisper/src/app/common/components/about-link.tsx'), 'utf8');
    assert.equal(source.match(/ABOUT_PATH = '([^']+)'/)?.[1], PAGES.en.path);
  });

  // its page (/) is the one links to the site lead to: a title of its searches and the app as structured data
  describe('its page', () => {
    const document = new JSDOM(readFileSync(join(ROOT, 'apps/chisper/src/index.html'), 'utf8')).window
      .document;

    it('has a title and a description of its searches', () => {
      assert.match(document.title, /^Chisper: .*Wavetable Synth/);
      assert.equal(attr(document, 'meta[property="og:title"]', 'content'), document.title);
      const description = attr(document, 'meta[name="description"]', 'content');
      assert.ok(description.length > 80 && description.length <= 180, description);
      assert.equal(attr(document, 'meta[property="og:description"]', 'content'), description);
    });

    it('is the canonical page of its links (?preset=)', () => {
      assert.equal(attr(document, 'link[rel="canonical"]', 'href'), `${SITE}/`);
    });

    // a crawler without JS reads the root; React empties it on its first render
    it('tells what the synth is in its root and links every version of the promo page', () => {
      const root = document.getElementById('root');
      const titles = [...root.querySelectorAll('h1')];
      assert.equal(titles.length, 1);
      assert.match(titles[0].textContent, /^Chisper: .*wavetable synth/i);
      const text = root.textContent.replace(/\s+/g, ' ');
      for (const phrase of [
        'free wavetable synthesizer',
        'no download, no account',
        'up to 8 voices',
        'MIDI',
      ]) {
        assert.ok(text.includes(phrase), phrase);
      }
      assert.deepEqual(
        [...root.querySelectorAll('a')].map((link) => link.getAttribute('href')),
        LANGS.map((lang) => PAGES[lang].path)
      );
    });

    it('is the app of the promo pages, linked to the English one', () => {
      const scripts = [...document.querySelectorAll('script[type="application/ld+json"]')];
      assert.equal(scripts.length, 1);
      const app = JSON.parse(scripts[0].textContent);
      assert.equal(app['@type'], 'WebApplication');
      assert.equal(app['@id'], `${SITE}/#app`);
      assert.equal(app.url, `${SITE}/`);
      assert.equal(app.isAccessibleForFree, true);
      assert.equal(app.subjectOf.url, `${SITE}${PAGES.en.path}`);
    });

    it('describes the app as every version of the page does', () => {
      const app = JSON.parse(document.querySelector('script[type="application/ld+json"]').textContent);
      for (const lang of LANGS) {
        const graph = JSON.parse(
          pageOf(lang).querySelector('script[type="application/ld+json"]').textContent
        )['@graph'];
        const theirs = graph.find((node) => node['@type'] === 'WebApplication');
        assert.equal(theirs.description, app.description, lang);
        assert.equal(theirs.inLanguage, app.inLanguage, lang);
      }
    });
  });
});

describe('robots.txt of the synth', () => {
  const robots = readFileSync(join(ROOT, 'apps/chisper/src/robots.txt'), 'utf8');

  it('lets every crawler in but the API and the functions', () => {
    assert.match(robots, /^User-agent: \*$/m);
    assert.match(robots, /^Allow: \/$/m);
    assert.match(robots, /^Disallow: \/api\/$/m);
    assert.match(robots, /^Disallow: \/\.netlify\/$/m);
    assert.doesNotMatch(robots, /Disallow: \/assets/);
  });

  it('names the sitemap', () => {
    assert.match(robots, new RegExp(`^Sitemap: ${SITE}/sitemap-index\\.xml$`, 'm'));
  });
});
