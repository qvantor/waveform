// The screenshots of the promo page (apps/site/src/assets), from the production site, so they show what a visitor
// gets: the synth on the preset of the first clip and its wavetable editor; the parts each feature shows, on the
// presets of its clips, upright (each fits the height of the text beside it): both oscillators one over the
// other, the unison with Detune held, the filter, Osc 2 over the envelopes and the LFO, the effects of a phone
// (their order and the first two); the keys of a phone, its whole screen. Run it when the interface changes:
//   npx -y -p playwright@1.50.1 node scripts/site/screens.mjs [--url=https://waveform.qvantor.org]
import fs from 'fs';
import path from 'path';
import { loadPlaywright, parseArgs, root } from '../bench-common.mjs';
import { SITE, openPreset, presetOf } from './common.mjs';

const args = parseArgs(process.argv.slice(2));
const URL_BASE = args.url ?? SITE;
const OUT = path.join(root, 'apps/site/src/assets');
const VIEWPORT = { width: 1440, height: 900 };
// the sections of the synth screen in their order: Osc 1, Osc 2, Filter, ENV, LFO
const SECTION = '[class*="section__Root"]';
const OSC1 = 0;
const OSC2 = 1;
const FILTER = 2;
const ENV = 3;
const LFO = 4;
// a phone, its whole screen (the browser's bars of the iPhone 13 of Playwright left out)
const phoneOf = (devices) => ({ ...devices['iPhone 13'], viewport: { width: 390, height: 844 } });
// the color of the synth's panel, between pictures put together
const PANEL = '#ecf0f1';
// the first row of the app is its header
const HEADER = 80;

// a page of the synth on the preset of a clip (closed once shot: a synth plays on in a page left open)
const open = async (browser, slug, options = { viewport: VIEWPORT, deviceScaleFactor: 2 }) => {
  const page = await browser.newPage(options);
  await openPreset(page, URL_BASE, presetOf(slug));
  return page;
};

const file = (name) => path.join(OUT, `${name}.png`);

// pictures (PNG buffers of one scale) one over the other on the synth's panel, as one PNG
const stack = async (browser, pictures, scale, gap = 12) => {
  const page = await browser.newPage({ deviceScaleFactor: scale, viewport: { width: 800, height: 800 } });
  const images = pictures
    .map((png) => `<img src="data:image/png;base64,${png.toString('base64')}" style="display:block">`)
    .join('');
  await page.setContent(
    `<body style="margin:0;background:${PANEL}"><div id="stack" style="display:inline-flex;flex-direction:column;gap:${gap}px">${images}</div></body>`
  );
  // each image at its CSS size: its pixels over the scale
  await page.evaluate((ratio) => {
    for (const image of document.images) image.style.width = `${image.naturalWidth / ratio}px`;
  }, scale);
  const shot = await page.locator('#stack').screenshot();
  await page.close();
  return shot;
};

const main = async () => {
  const { chromium, devices } = loadPlaywright();
  const browser = await chromium.launch();

  const synth = await open(browser, 'biting-brass-keys', { viewport: VIEWPORT, deviceScaleFactor: 1.5 });
  await synth.screenshot({ path: file('synth') });
  await synth.locator('.anticon-edit').first().click();
  // the dots of the routes of the knobs under the editor show through its modal (their z-index)
  await synth.addStyleTag({ content: '[class*="amount-dot__Root"] { visibility: hidden; }' });
  await synth.waitForTimeout(1500);
  await synth.screenshot({
    path: file('editor'),
    clip: { x: 0, y: HEADER, width: VIEWPORT.width, height: VIEWPORT.height - HEADER },
  });
  await synth.close();

  // both oscillators, one over the other
  const osc = await open(browser, 'ufo-drone');
  const oscillators = [
    await osc.locator(SECTION).nth(OSC1).screenshot(),
    await osc.locator(SECTION).nth(OSC2).screenshot(),
  ];
  await osc.close();
  fs.writeFileSync(file('osc'), await stack(browser, oscillators, 2));

  // Detune held: the unison voices (8 of a saw) over the wave, not the tooltip of its value
  const unison = await open(browser, 'biting-brass-keys');
  await unison.addStyleTag({ content: '[class*="ooltip"] { visibility: hidden !important; }' });
  const section = unison.locator(SECTION).nth(OSC1);
  const label = await section.getByText('Detune', { exact: true }).boundingBox();
  await unison.mouse.move(label.x + label.width / 2, label.y - 24);
  await unison.mouse.down();
  await unison.waitForTimeout(600);
  await section.screenshot({ path: file('unison') });
  await unison.mouse.up();
  await unison.close();

  const filter = await open(browser, 'acid-bass');
  await filter
    .locator(SECTION)
    .nth(FILTER)
    .screenshot({ path: file('filter') });
  await filter.close();

  // the sources and where they go: Osc 2 (the route of LFO 1 on its gain), the envelopes, LFO 1 (its shape, the
  // route of ENV 2 on its rate), one over the other
  const sources = await open(browser, 'helicopter');
  const panels = [];
  for (const index of [OSC2, ENV, LFO]) panels.push(await sources.locator(SECTION).nth(index).screenshot());
  await sources.close();
  fs.writeFileSync(file('modulation'), await stack(browser, panels, 2));

  // the effects of a phone: their order, the distortion and the delay
  const fx = await open(browser, 'warehouse-lead', phoneOf(devices));
  await fx.getByRole('button', { name: 'Synth' }).click();
  await fx.getByText('FX', { exact: true }).first().click();
  await fx.waitForTimeout(1500);
  const screen = await fx.locator('[class*="fx-screen__Root"]').boundingBox();
  const reverb = await fx.getByText('Reverb', { exact: true }).nth(1).boundingBox();
  await fx.screenshot({
    path: file('fx'),
    clip: { x: screen.x, y: screen.y, width: screen.width, height: reverb.y - 14 - screen.y },
  });
  await fx.close();

  const phone = await open(browser, 'theremin', phoneOf(devices));
  await phone.getByRole('button', { name: 'Keys' }).click();
  await phone.waitForTimeout(1000);
  await phone.screenshot({ path: file('phone') });

  await browser.close();
};

await main();
