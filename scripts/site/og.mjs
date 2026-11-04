// The Open Graph images of the promo page (apps/site/public/og/<lang>.png, 1200×630): the wordmark, the line of
// the page in its language (`og` of apps/site/src/i18n/<lang>.ts) and the screenshot of the synth
// (screens.mjs first). Run it when the line or the screenshot changes:
//   npx -y -p playwright@1.50.1 node scripts/site/og.mjs
import fs from 'fs';
import path from 'path';
import { loadPlaywright, root } from '../bench-common.mjs';

const { LANGS, SITE } = await import('../../apps/site/src/i18n/locales.ts');

const OUT = path.join(root, 'apps/site/public/og');
const SCREENSHOT = path.join(root, 'apps/site/src/assets/synth.png');

// the `og` line of a language (its messages, Node strips their types)
const lineOf = async (lang) => (await import(`../../apps/site/src/i18n/${lang}.ts`))[lang].og;

const escape = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;');

const page = (line, screenshot) => `<!doctype html>
<html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Inter+Tight:wght@400;700&display=block" rel="stylesheet">
<style>
  * { margin: 0; box-sizing: border-box; }
  body { width: 1200px; height: 630px; overflow: hidden; font-family: 'Inter Tight', sans-serif; color: #ecf0f1;
    position: relative; background: radial-gradient(520px 360px at 85% 30%, rgb(46 204 113 / 22%), transparent 70%),
      radial-gradient(520px 420px at 0% 0%, rgb(52 152 219 / 24%), transparent 70%), #0e151b; }
  .text { position: absolute; left: 72px; top: 72px; width: 520px; }
  .logo { display: inline-flex; flex-direction: column; align-items: flex-end; line-height: 1; }
  .name { font-weight: 700; font-size: 64px; background: linear-gradient(45deg, #4aa8e8, #3ddc84 80%);
    -webkit-background-clip: text; background-clip: text; color: transparent; }
  .by { font-weight: 700; font-size: 18px; margin-top: 2px; color: #a7b4c1; }
  h1 { margin-top: 48px; font-size: 52px; line-height: 1.08; font-weight: 700; letter-spacing: -0.5px; }
  .url { position: absolute; left: 72px; bottom: 64px; font-size: 22px; color: #a7b4c1; }
  .shot { position: absolute; left: 640px; top: 72px; width: 860px; border-radius: 10px; overflow: hidden;
    box-shadow: 0 0 0 1px rgb(255 255 255 / 14%), 0 30px 60px -20px rgb(0 0 0 / 70%), 0 0 90px -10px rgb(46 204 113 / 35%); }
  .shot img { display: block; width: 100%; }
</style></head>
<body>
  <div class="text">
    <div class="logo"><span class="name">WAVEFORM</span><span class="by">by Qvantor</span></div>
    <h1>${escape(line)}</h1>
  </div>
  <div class="url">${new URL(SITE).host}</div>
  <div class="shot"><img src="${screenshot}"></div>
</body></html>`;

const main = async () => {
  const screenshot = `data:image/png;base64,${fs.readFileSync(SCREENSHOT).toString('base64')}`;
  fs.mkdirSync(OUT, { recursive: true });
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch();
  const tab = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  for (const lang of LANGS) {
    await tab.setContent(page(await lineOf(lang), screenshot), { waitUntil: 'networkidle' });
    await tab.evaluate(() => document.fonts.ready);
    await tab.screenshot({ path: path.join(OUT, `${lang}.png`) });
    console.log(`og/${lang}.png`);
  }
  await browser.close();
};

await main();
