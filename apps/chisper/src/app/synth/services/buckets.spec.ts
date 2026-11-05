import { bucketUrl, NOISES_ORIGIN, WAVETABLES_ORIGIN } from './buckets';

describe('bucketUrl', () => {
  it('is the key as the path on the domain of the bucket, each part of it encoded', () => {
    expect(bucketUrl(WAVETABLES_ORIGIN, 'ESW Core Tables/Basics/Basic Shapes.wav')).toBe(
      'https://wavetables.chisper.qvantor.org/ESW%20Core%20Tables/Basics/Basic%20Shapes.wav'
    );
    expect(bucketUrl(NOISES_ORIGIN, 'Analog/White.wav')).toBe(
      'https://noises.chisper.qvantor.org/Analog/White.wav'
    );
  });

  it('keeps a part from being read as a query, a fragment or another path', () => {
    const url = new URL(bucketUrl(WAVETABLES_ORIGIN, 'Pads/A?b & c #1 100%+ä.wav'));
    expect(url.search).toBe('');
    expect(url.hash).toBe('');
    expect(decodeURIComponent(url.pathname)).toBe('/Pads/A?b & c #1 100%+ä.wav');
  });
});
