import { skipSingleFolders, wavetablesToOptions } from './use-wavetables';

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

describe('skipSingleFolders', () => {
  const files = [
    { value: 'ESW/Analog/Saw.wav', label: 'Saw' },
    { value: 'ESW/Analog/Square.wav', label: 'Square' },
  ];
  const categories = [
    { value: 'Analog', label: 'Analog', children: files },
    { value: 'Basics', label: 'Basics', children: [{ value: 'ESW/Basics/Sine.wav', label: 'Sine' }] },
  ];

  it('starts inside the only top folder', () => {
    expect(skipSingleFolders([{ value: 'ESW', label: 'ESW', children: categories }])).toEqual({
      prefix: ['ESW'],
      options: categories,
    });
  });

  it('skips nested single folders too', () => {
    expect(
      skipSingleFolders([
        { value: 'ESW', label: 'ESW', children: [{ value: 'Core', label: 'Core', children: categories }] },
      ])
    ).toEqual({ prefix: ['ESW', 'Core'], options: categories });
  });

  it('keeps several top folders', () => {
    expect(skipSingleFolders(categories)).toEqual({ prefix: [], options: categories });
  });

  it('keeps a single file', () => {
    const single = [{ value: 'Sine.wav', label: 'Sine' }];
    expect(skipSingleFolders(single)).toEqual({ prefix: [], options: single });
  });

  it('stops at a file', () => {
    const single = [{ value: 'Sine.wav', label: 'Sine' }];
    expect(skipSingleFolders([{ value: 'ESW', label: 'ESW', children: single }])).toEqual({
      prefix: ['ESW'],
      options: single,
    });
  });

  it('returns an empty list for no data', () => {
    expect(skipSingleFolders([])).toEqual({ prefix: [], options: [] });
  });
});
