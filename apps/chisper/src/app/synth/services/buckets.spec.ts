import { bucketUrl, NOISES_ORIGIN, NOISES_PROXY, WAVETABLES_ORIGIN, WAVETABLES_PROXY } from './buckets';

describe('bucketUrl', () => {
  it('is the key as the path on the domain of the bucket, each part of it encoded', () => {
    expect(bucketUrl(WAVETABLES_ORIGIN, 'ESW Core Tables/Basics/Basic Shapes.wav')).toBe(
      'https://wavetables.chisper.qvantor.org/ESW%20Core%20Tables/Basics/Basic%20Shapes.wav'
    );
    expect(bucketUrl(NOISES_ORIGIN, 'Analog/White.wav')).toBe(
      'https://noises.chisper.qvantor.org/Analog/White.wav'
    );
  });

  it('is the key as the path under the rewrites of the site', () => {
    expect(bucketUrl(WAVETABLES_PROXY, 'ESW Core Tables/Basics/Basic Shapes.wav')).toBe(
      '/files/wavetables/ESW%20Core%20Tables/Basics/Basic%20Shapes.wav'
    );
    expect(bucketUrl(NOISES_PROXY, 'Analog/White.wav')).toBe('/files/noises/Analog/White.wav');
  });

  it('keeps a part from being read as a query, a fragment or another path', () => {
    const url = new URL(bucketUrl(WAVETABLES_ORIGIN, 'Pads/A?b & c #1 100%+ä.wav'));
    expect(url.search).toBe('');
    expect(url.hash).toBe('');
    expect(decodeURIComponent(url.pathname)).toBe('/Pads/A?b & c #1 100%+ä.wav');
  });
});
