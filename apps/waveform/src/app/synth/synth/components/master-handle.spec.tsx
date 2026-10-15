import React from 'react';
import { act, render } from '@testing-library/react';
import { Handle, HandleProps } from '@waveform/ui-kit';
import { SynthCoreProvider, useSynthCore } from '../../common/modules';
import { dbToGain, formatDb, gainToDb, MASTER_DB, MasterHandle } from './master-handle';

jest.mock('@waveform/ui-kit', () => ({
  ...jest.requireActual('@waveform/ui-kit'),
  Handle: jest.fn(() => null),
}));

type SynthCoreModule = ReturnType<typeof useSynthCore>;

const Capture = ({ onModel }: { onModel: (module: SynthCoreModule) => void }) => {
  onModel(useSynthCore());
  return null;
};

const setup = () => {
  let synthCore: SynthCoreModule | undefined;
  render(
    <SynthCoreProvider initial={undefined}>
      <Capture onModel={(module) => (synthCore = module)} />
      <MasterHandle />
    </SynthCoreProvider>
  );
  if (!synthCore) throw new Error('synth core is not initialized');
  const props = () => (Handle as jest.Mock).mock.lastCall?.[0] as HandleProps;
  return { synthCore, props };
};

describe('MasterHandle', () => {
  afterEach(() => (Handle as jest.Mock).mockClear());

  it('is a knob in dB from -40 to +12, at 0 dB by default', () => {
    const { props } = setup();
    expect(props()).toMatchObject({ min: -40, max: 12, value: 0, label: 'Master', precision: 10 });
    expect(props().formatValue?.(props().value ?? NaN)).toBe('0.0dB');
  });

  it('sets the master gain from dB, above 0 dB it drives the limiter', () => {
    const { synthCore, props } = setup();
    const [{ $masterGain, masterGain }] = synthCore;
    act(() => props().onChange?.(6));
    expect($masterGain.value).toBeCloseTo(1.9953, 4);
    expect(masterGain.gain.value).toBeCloseTo(1.9953, 4);
    expect(props().value).toBeCloseTo(6, 10);
    act(() => props().onChange?.(-12.5));
    expect($masterGain.value).toBeCloseTo(0.2371, 4);
    expect(props().value).toBeCloseTo(-12.5, 10);
  });

  it('the lowest position is silence', () => {
    const { synthCore, props } = setup();
    act(() => props().onChange?.(MASTER_DB.min));
    expect(synthCore[0].$masterGain.value).toBe(0);
    expect(props().value).toBe(MASTER_DB.min);
    expect(props().formatValue?.(MASTER_DB.min)).toBe('-∞');
  });

  it('hides the label on mobile', () => {
    render(
      <SynthCoreProvider initial={undefined}>
        <MasterHandle label={null} />
      </SynthCoreProvider>
    );
    expect((Handle as jest.Mock).mock.lastCall?.[0].label).toBeNull();
  });
});

describe('master dB', () => {
  it('dbToGain: 0 dB is unity, -6 dB is half, the minimum is silence', () => {
    expect(dbToGain(0)).toBe(1);
    expect(dbToGain(-6.0206)).toBeCloseTo(0.5, 5);
    expect(dbToGain(12)).toBeCloseTo(3.981, 3);
    expect(dbToGain(MASTER_DB.min)).toBe(0);
  });

  it('gainToDb is the inverse, clamped to the range', () => {
    [-30, -6, 0, 3.5, 12].forEach((db) => expect(gainToDb(dbToGain(db))).toBeCloseTo(db, 10));
    expect(gainToDb(0)).toBe(MASTER_DB.min);
    expect(gainToDb(0.001)).toBe(MASTER_DB.min);
    expect(gainToDb(100)).toBe(MASTER_DB.max);
  });

  it('formatDb shows a signed tenth of a dB', () => {
    expect(formatDb(0)).toBe('0.0dB');
    expect(formatDb(-0.04)).toBe('0.0dB');
    expect(formatDb(2.96)).toBe('+3.0dB');
    expect(formatDb(12)).toBe('+12.0dB');
    expect(formatDb(-6.5)).toBe('-6.5dB');
    expect(formatDb(-40)).toBe('-∞');
  });
});
