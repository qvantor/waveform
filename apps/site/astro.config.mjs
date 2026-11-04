import sitemap from '@astrojs/sitemap';
import { defineConfig, fontProviders } from 'astro/config';
import { LANGS, SITE, pageUrl } from './src/i18n/locales.ts';

// the versions of the page link to each other in the sitemap: each has a slug of its own, so the i18n option of the
// sitemap (the same path under a locale prefix) wouldn't pair them
const alternates = LANGS.map((lang) => ({ lang, url: pageUrl(lang) }));
const isPage = (url) => LANGS.some((lang) => url === pageUrl(lang));

// the promo pages: static HTML (JS only for the players of the clips), built into dist/apps/site and copied into the
// folder of the synth after its build (scripts/site/merge.mjs: the root and /assets/ are the synth's, ours /_astro/)
export default defineConfig({
  site: SITE,
  outDir: '../../dist/apps/site',
  trailingSlash: 'always',
  // the styles (2.5 kB gzipped) in the page: no request blocks its first paint
  build: { format: 'directory', assets: '_astro', inlineStylesheets: 'always' },
  // the font of the synth, served by us (no request to Google from the page), the weights the page uses
  fonts: [
    {
      provider: fontProviders.google(),
      name: 'Inter Tight',
      cssVariable: '--font-inter-tight',
      weights: [200, 400, 600, 700],
      styles: ['normal'],
      subsets: ['latin'],
      fallbacks: ['sans-serif'],
    },
  ],
  integrations: [
    sitemap({
      // the synth is not a page of Astro
      customPages: [new URL('/', SITE).href],
      serialize: (item) => (isPage(item.url) ? { ...item, links: alternates } : item),
    }),
  ],
});
