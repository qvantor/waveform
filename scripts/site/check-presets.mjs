// Every clip of the promo page opens its preset on the site: GET /api/presets/:id answers it, under the name of
// its card (less the prefix of the featured presets, [AI], and of the category, FX). Run it before a deploy and
// after presets are edited on the site:
//   node scripts/site/check-presets.mjs [--url=https://chisper.qvantor.org]
import { parseArgs } from '../bench-common.mjs';
import { DEMOS, SITE } from './common.mjs';

const args = parseArgs(process.argv.slice(2));
const URL_BASE = args.url ?? SITE;

const cardName = (name) => name.replace(/^\[[A-Z]+\]\s*/, '').replace(/^FX\s+/, '');

const check = async ({ slug, presetId, name }) => {
  const response = await fetch(`${URL_BASE}/api/presets/${presetId}`);
  if (!response.ok) return `${slug}: ${presetId} answers ${response.status}`;
  const preset = await response.json();
  if (cardName(preset.name) !== name)
    return `${slug}: the preset is "${preset.name}", the card says "${name}"`;
  return null;
};

const problems = (await Promise.all(DEMOS.map(check))).filter(Boolean);
for (const problem of problems) console.error(problem);
console.log(`${DEMOS.length - problems.length} of ${DEMOS.length} presets open as their cards say`);
process.exitCode = problems.length ? 1 : 0;
