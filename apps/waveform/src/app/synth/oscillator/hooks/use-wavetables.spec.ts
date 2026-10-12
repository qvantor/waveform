import { wavetablesToOptions } from './use-wavetables';

describe('wavetablesToOptions', () => {
  it('maps the folder tree to cascade options with file names and sizes', () => {
    expect(
      wavetablesToOptions([
        {
          name: 'Basic',
          children: [
            { Key: 'Basic/Saw.wav', Size: 2048 },
            { name: 'Deep', children: [{ Key: 'Basic/Deep/Square.v2.wav', Size: 10 }] },
          ],
        },
        { Key: 'Sine.wav', Size: 1500000 },
      ])
    ).toEqual([
      {
        value: 'Basic',
        label: 'Basic',
        children: [
          { value: 'Basic/Saw.wav', label: 'Saw (2.05 kB)' },
          {
            value: 'Deep',
            label: 'Deep',
            children: [{ value: 'Basic/Deep/Square.v2.wav', label: 'Square (10 B)' }],
          },
        ],
      },
      { value: 'Sine.wav', label: 'Sine (1.5 MB)' },
    ]);
  });

  it('returns an empty list for no data', () => {
    expect(wavetablesToOptions([])).toEqual([]);
  });
});
