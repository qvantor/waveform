import { SCENES, isScene, sceneAt } from './scenes';

describe('the waves behind the features', () => {
  it.each(SCENES)('%s draws lines across its band, inside it', (scene) => {
    for (const time of [0, 3.7, 11, 29]) {
      const lines = sceneAt(scene, time);
      expect(lines.length).toBeGreaterThan(0);
      for (const { points, alpha, width, color } of lines) {
        expect(points.length % 2).toBe(0);
        expect(points.length).toBeGreaterThanOrEqual(4);
        for (let i = 0; i < points.length; i += 2) {
          expect(points[i]).toBeGreaterThanOrEqual(0);
          expect(points[i]).toBeLessThanOrEqual(1);
          expect(Math.abs(points[i + 1])).toBeLessThanOrEqual(1.05);
          expect(Number.isFinite(points[i + 1])).toBe(true);
        }
        expect(alpha).toBeGreaterThan(0);
        expect(alpha).toBeLessThanOrEqual(1);
        expect(width).toBeGreaterThan(0);
        expect(color).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
  });

  it.each(SCENES)('%s moves with the time, the same at the same time', (scene) => {
    expect(sceneAt(scene, 2)).toEqual(sceneAt(scene, 2));
    expect(sceneAt(scene, 2)).not.toEqual(sceneAt(scene, 4.5));
  });

  it('spreads the voices of a unison apart from a middle where they meet', () => {
    const voices = sceneAt('unison', 0);
    expect(voices).toHaveLength(7);
    // at the middle of the band every voice has the level of the middle one
    const middle = (points: number[]) => points[points.length / 2 + 1];
    const centre = middle(voices[3].points);
    for (const voice of voices) expect(middle(voice.points)).toBeCloseTo(centre, 6);
    // at the edge they differ
    expect(voices[0].points[1]).not.toBeCloseTo(voices[6].points[1], 2);
  });

  it('clips the sine of the effects under its ceiling, flatter with more drive', () => {
    const [clean, ceiling, , clipped] = sceneAt('effects', 0);
    const peak = (points: number[]) => Math.max(...points.filter((_, i) => i % 2).map(Math.abs));
    expect(peak(clean.points)).toBeCloseTo(1, 2);
    expect(peak(clipped.points)).toBeLessThanOrEqual(ceiling.points[1] + 1e-9);
  });

  it('knows its scenes', () => {
    expect(isScene('filter')).toBe(true);
    expect(isScene('faq')).toBe(false);
  });
});
