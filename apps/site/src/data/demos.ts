// the clips of the page: melodies and phrases played on presets of the site, recorded at the output of the synth
// (mastered to -16 LUFS, a true peak at most -1 dBTP, MP3 48 kHz), in public/demos/<slug>.mp3; what each one lets
// hear is in the messages (`demos.<slug>`), its peaks and length in peaks.json (scripts/site/peaks.mjs)
import type { Messages } from '../i18n/en';

export const SECTIONS = [
  'listen',
  'wavetables',
  'unison',
  'filter',
  'modulation',
  'effects',
  'playing',
] as const;
export type Section = (typeof SECTIONS)[number];

export const CATEGORIES = ['bass', 'lead', 'pluck', 'keys', 'pad', 'fx'] as const;
export type Category = (typeof CATEGORIES)[number];

// a clip has its caption in every language
export type Slug = keyof Messages['demos'];

export type Demo = {
  slug: Slug;
  section: Section;
  category: Category;
  // the preset on the site (/?preset=<id>)
  presetId: string;
  // its name there without the prefix of the featured presets ([AI]) and of the category (FX)
  name: string;
};

export const DEMOS: Demo[] = [
  {
    slug: 'zesty-drive-bass',
    section: 'listen',
    category: 'bass',
    presetId: '8895354c-0cc9-4a1b-9be9-17f632c71819',
    name: 'Zesty Drive Bass',
  },
  {
    slug: 'warehouse-lead',
    section: 'listen',
    category: 'lead',
    presetId: '76fd0301-4a97-4b2f-8230-beb9d610659d',
    name: 'Warehouse Lead',
  },
  {
    slug: 'biting-brass-keys',
    section: 'listen',
    category: 'keys',
    presetId: '5df5543d-2364-43f0-b23f-c473804fce89',
    name: 'Biting Brass Keys',
  },
  {
    slug: 'ufo-drone',
    section: 'wavetables',
    category: 'fx',
    presetId: '780f0d22-5cf6-4e6e-bf05-29cd8989614a',
    name: 'UFO Drone',
  },
  {
    slug: 'harp-pluck',
    section: 'wavetables',
    category: 'pluck',
    presetId: '9bb5dec5-ba2e-4be2-ba3a-95afbcacf88a',
    name: 'Harp Pluck',
  },
  {
    slug: 'noise-riser',
    section: 'unison',
    category: 'fx',
    presetId: 'd1868bba-2a65-49d5-8f6e-6fa93cda1f16',
    name: 'Noise Riser',
  },
  {
    slug: 'acid-bass',
    section: 'filter',
    category: 'bass',
    presetId: 'ad4c9b3c-15aa-47b4-9513-186cf5053e70',
    name: 'Acid Bass',
  },
  {
    slug: 'helicopter',
    section: 'modulation',
    category: 'fx',
    presetId: '74137fe5-0255-4739-ac80-c80e1055faca',
    name: 'Helicopter',
  },
  {
    slug: 'rhodes-keys',
    section: 'modulation',
    category: 'keys',
    presetId: 'ae11af8d-e6b3-4f6a-a4c0-892562156c84',
    name: 'Rhodes Keys',
  },
  {
    slug: 'sonar-ping',
    section: 'effects',
    category: 'fx',
    presetId: '554a8aca-2457-4779-9ff6-188e63354160',
    name: 'Sonar Ping',
  },
  {
    slug: 'lo-fi-tape-keys',
    section: 'effects',
    category: 'keys',
    presetId: 'd767bca7-5a2b-4f79-9620-098cac99a743',
    name: 'Lo-Fi Tape Keys',
  },
  {
    slug: 'theremin',
    section: 'playing',
    category: 'lead',
    presetId: 'fc0ceec1-ecfe-4cf0-9214-4d221e44fa86',
    name: 'Theremin',
  },
  {
    slug: 'sub-bass',
    section: 'playing',
    category: 'bass',
    presetId: '89e9d115-f22b-44c7-871d-481b1e6c1c58',
    name: 'Sub Bass',
  },
];

export const demosOf = (section: Section) => DEMOS.filter((demo) => demo.section === section);

export const demoPath = (slug: string) => `/demos/${slug}.mp3`;
