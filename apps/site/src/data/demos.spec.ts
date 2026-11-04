import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { WAVE_HEIGHT, clipOf, isoDuration, wavePath } from './clips';
import { DEMOS, SECTIONS, demoPath, demosOf } from './demos';
import peaks from './peaks.json';

const PUBLIC = join(__dirname, '../../public');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('the clips', () => {
  it('are in the order of the sections of the page', () => {
    const order = DEMOS.map((demo) => SECTIONS.indexOf(demo.section));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    // a bass, a lead and keys
    expect(demosOf('listen').map((demo) => [demo.slug, demo.category])).toEqual([
      ['zesty-drive-bass', 'bass'],
      ['warehouse-lead', 'lead'],
      ['biting-brass-keys', 'keys'],
    ]);
    expect(DEMOS).toHaveLength(13);
  });

  it('give every feature with sound a clip', () => {
    for (const section of SECTIONS) expect(demosOf(section).length).toBeGreaterThan(0);
  });

  it.each(DEMOS.map((demo) => [demo.slug, demo] as const))(
    '%s has its mp3, peaks and a preset',
    (slug, demo) => {
      const file = join(PUBLIC, demoPath(slug));
      expect(existsSync(file)).toBe(true);
      expect(statSync(file).size).toBeGreaterThan(50_000);
      const { duration, peaks: values } = clipOf(slug);
      expect(duration).toBeGreaterThan(5);
      expect(duration).toBeLessThan(20);
      expect(values).toHaveLength(200);
      expect(Math.max(...values)).toBe(1);
      expect(demo.presetId).toMatch(UUID);
      expect(demo.name).not.toMatch(/^\[|^FX /);
    }
  );

  it('has peaks of no clip the page lacks', () => {
    expect(Object.keys(peaks).sort()).toEqual(DEMOS.map((demo) => demo.slug).sort());
  });

  it('throws for a clip without peaks', () => {
    expect(() => clipOf('missing')).toThrow('scripts/site/peaks.mjs');
  });
});

describe('wavePath', () => {
  it('draws a bar per peak around the middle, a line for silence', () => {
    expect(wavePath([1, 0])).toBe(`M0.5 1.0V39.0M1.5 19.4V20.6`);
    expect(WAVE_HEIGHT).toBe(40);
  });
});

describe('isoDuration', () => {
  it('writes the seconds as an ISO 8601 duration', () => {
    expect(isoDuration(16.7)).toBe('PT16.7S');
  });
});
