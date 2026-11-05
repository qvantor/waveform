// What the scripts of the promo page share: the site and the presets of its clips (from apps/site/src, Node strips
// their types), ffmpeg, the synth opened on a preset.
import { execFileSync } from 'node:child_process';

const { SITE, presetUrl } = await import('../../apps/site/src/i18n/locales.ts');
const { DEMOS } = await import('../../apps/site/src/data/demos.ts');

export { DEMOS, SITE };

// the preset of a clip (data/demos.ts)
export const presetOf = (slug) => {
  const demo = DEMOS.find((clip) => clip.slug === slug);
  if (!demo) throw new Error(`no clip ${slug}`);
  return demo.presetId;
};

const FFMPEG = process.env.FFMPEG ?? 'ffmpeg';

// ffmpeg (FFMPEG, else the one on the PATH) quiet but for errors, overwriting its outputs: what it writes to stdout
export const ffmpeg = (...args) =>
  execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { maxBuffer: 1 << 30 });

// the synth on a preset, its tables and charts drawn; not the button of the feedback widget (Sleekplan); the mouse
// parked on the bottom edge at x
export const openPreset = async (page, url, presetId, x = 0) => {
  await page.goto(`${url}${presetUrl(presetId)}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  await page.addStyleTag({ content: '#sleek-button { display: none !important; }' });
  await page.mouse.move(x, page.viewportSize().height - 1);
};
