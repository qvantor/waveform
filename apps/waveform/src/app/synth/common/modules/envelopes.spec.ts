import { divisionIndex, ENVELOPE_DEFAULTS, ENVELOPE_DIVISIONS } from '@waveform/preset-schema';
import { applySnapshot, getSnapshot } from '../../../app';
import { createEnvelopes, createTransport } from '../../../../test-utils/models';
import { envelopeValue } from '../envelope/envelope-curve';
import { envelopeSeconds } from './envelopes';

// the default shape, in MS: the divisions nearest to the seconds at 120
const curves = { attack: 0, decay: 3.49, release: 3.49 };
const defaults = {
  env1: {
    attack: 0.005,
    hold: 0.1,
    decay: 0,
    sustain: 1,
    release: 0.005,
    curves,
    bpm: false,
    divs: ENVELOPE_DIVISIONS.env1,
  },
  env2: { ...ENVELOPE_DEFAULTS.env2, curves, bpm: false, divs: ENVELOPE_DIVISIONS.env2 },
  env3: { ...ENVELOPE_DEFAULTS.env3, curves, bpm: false, divs: ENVELOPE_DIVISIONS.env3 },
};
const at = (id: string) => divisionIndex(id);

describe('envelopes', () => {
  it('starts with the default envelopes, ENV 1 selected', () => {
    const [{ $envelopes, $selected }] = createEnvelopes();
    expect($envelopes.value).toEqual(defaults);
    expect($selected.value).toBe('env1');
  });

  it('setEnvelopeValue changes one stage of one envelope', () => {
    const [{ $envelopes }, { setEnvelopeValue }] = createEnvelopes();
    setEnvelopeValue('env2', 'attack', 0.5);
    expect($envelopes.value).toEqual({ ...defaults, env2: { ...defaults.env2, attack: 0.5 } });
  });

  it('setEnvelopeCurve changes the curve of one stage of one envelope', () => {
    const [{ $envelopes }, { setEnvelopeCurve }] = createEnvelopes();
    const before = $envelopes.value.env1;
    setEnvelopeCurve('env3', 'decay', -2.5);
    setEnvelopeCurve('env3', 'attack', 4);
    expect($envelopes.value).toEqual({
      ...defaults,
      env3: { ...defaults.env3, curves: { ...curves, decay: -2.5, attack: 4 } },
    });
    // the others keep their objects: the voices of their notes see the same envelopes
    expect($envelopes.value.env1).toBe(before);
  });

  it('selects the envelope the section shows, it is not in the snapshot', () => {
    const [{ $selected, $envelope }, { select }] = createEnvelopes();
    select('env3');
    expect([$selected.value, $envelope.value]).toEqual(['env3', 'env3']);
    expect(JSON.stringify(getSnapshot()['env'])).not.toContain('env3');
  });

  it('the velocity selected, the section keeps showing the last envelope selected', () => {
    const [{ $selected, $envelope }, { select }] = createEnvelopes();
    select('env2');
    select('velo');
    expect([$selected.value, $envelope.value]).toEqual(['velo', 'env2']);
    select('env1');
    expect([$selected.value, $envelope.value]).toEqual(['env1', 'env1']);
  });

  it('exposes the envelopes in the snapshot as env: { e1, e2, e3 }', () => {
    const [, { setEnvelopeValue }] = createEnvelopes();
    setEnvelopeValue('env1', 'release', 2);
    setEnvelopeValue('env3', 'decay', 32);
    expect(getSnapshot()['env']).toEqual({
      e1: { ...defaults.env1, release: 2 },
      e2: defaults.env2,
      e3: { ...defaults.env3, decay: 32 },
      vel: { amp: 1, k: 0 },
    });
  });

  it('holds the knobs of the velocity: Amp 1 and a line by default, in the snapshot as vel: { amp, k }', () => {
    const [{ $velocity }, { setVelocity }] = createEnvelopes();
    expect($velocity.value).toEqual({ amp: 1, k: 0 });
    setVelocity('amp', 0.25);
    setVelocity('k', -3);
    expect(getSnapshot()['env']).toMatchObject({ vel: { amp: 0.25, k: -3 } });
  });

  it('applies the velocity of a snapshot: 0 kept, a missing knob its default, a url one within its range', () => {
    const [{ $velocity }, { setVelocity }] = createEnvelopes();
    setVelocity('k', 4);
    applySnapshot({ env: { vel: { amp: 0 } } });
    expect($velocity.value).toEqual({ amp: 0, k: 0 });
    applySnapshot({ env: { vel: { amp: 3, k: 1e-17 } } });
    expect($velocity.value).toEqual({ amp: 1, k: 0 });
    applySnapshot({ env: {} });
    expect($velocity.value).toEqual({ amp: 1, k: 0 });
    // a url of a legacy param (env-vel=null): its defaults
    setVelocity('amp', 0.5);
    applySnapshot({ env: { vel: null as never } });
    expect($velocity.value).toEqual({ amp: 1, k: 0 });
  });

  it('exposes the curves in the snapshot as curves: { attack, decay, release } of each envelope', () => {
    const [, { setEnvelopeCurve }] = createEnvelopes();
    setEnvelopeCurve('env2', 'release', 0);
    expect(getSnapshot()['env']).toMatchObject({ e1: { curves }, e2: { curves: { ...curves, release: 0 } } });
  });

  it('applies a snapshot, keeps falsy values and restores defaults for missing keys', () => {
    const [{ $envelopes }, { setEnvelopeValue }] = createEnvelopes();
    setEnvelopeValue('env1', 'hold', 3);
    setEnvelopeValue('env2', 'decay', 4);

    applySnapshot({ env: { e1: { attack: 1, sustain: 0 }, e2: { release: 0, hold: 0 } } });

    expect($envelopes.value).toEqual({
      env1: { ...defaults.env1, attack: 1, sustain: 0 },
      env2: { ...defaults.env2, release: 0, hold: 0 },
      env3: defaults.env3,
    });
  });

  it('applies the curves of a snapshot, 0 kept, the default shape for missing ones (a preset saved before them)', () => {
    const [{ $envelopes }, { setEnvelopeCurve }] = createEnvelopes();
    setEnvelopeCurve('env3', 'attack', 5);

    applySnapshot({
      env: { e1: { curves: { decay: 0 } }, e2: { curves: { attack: -6, release: 8 } }, e3: {} },
    });

    expect($envelopes.value).toEqual({
      env1: { ...defaults.env1, curves: { ...curves, decay: 0 } },
      env2: { ...defaults.env2, curves: { attack: -6, decay: 3.49, release: 8 } },
      env3: defaults.env3,
    });
  });

  it('puts the curves of a url snapshot on the grid within their range, one that is not a number is its default', () => {
    const [{ $envelopes }] = createEnvelopes();
    applySnapshot({
      env: {
        e1: { curves: { attack: 1e-17, decay: -Infinity, release: 'x' } },
        e2: { curves: { decay: 2.346 } },
      },
    });
    expect($envelopes.value.env1.curves).toEqual({ attack: 0, decay: -10, release: 3.49 });
    expect($envelopes.value.env2.curves).toEqual({ ...curves, decay: 2.35 });
    for (const t of [0.001, 0.2, 0.5])
      expect(Number.isFinite(envelopeValue($envelopes.value.env1, t, 0.1))).toBe(true);
  });

  it('round trips through the snapshot', () => {
    const [{ $envelopes }, { setEnvelopeValue, setEnvelopeCurve }] = createEnvelopes();
    setEnvelopeValue('env2', 'sustain', 0);
    setEnvelopeCurve('env2', 'release', -1.25);
    setEnvelopeCurve('env1', 'attack', 0.5);
    setEnvelopeValue('env3', 'attack', 0);
    setEnvelopeValue('env1', 'release', 12.5);
    const snapshot = getSnapshot();
    const values = $envelopes.value;
    applySnapshot({});
    expect($envelopes.value).toEqual(defaults);
    applySnapshot(snapshot);
    expect($envelopes.value).toEqual(values);
  });

  it('does not read the old adsr key', () => {
    const [{ $envelopes }] = createEnvelopes();
    applySnapshot({ adsr: { attack: 0.5 } });
    expect($envelopes.value).toEqual(defaults);
  });

  describe('in BPM', () => {
    it('a fresh envelope has the divisions nearest to its seconds at 120', () => {
      // 5 ms: a 1/512 (3.9 ms)
      expect(ENVELOPE_DIVISIONS.env1).toEqual({
        attack: at('1/512'),
        hold: at('1/16'),
        decay: 0,
        release: at('1/512'),
      });
      expect(ENVELOPE_DIVISIONS.env2).toEqual({
        attack: at('1/512'),
        hold: 0,
        decay: at('1/4'),
        release: at('1/8'),
      });
    });

    it('takes the divisions nearest to its seconds at the tempo, their seconds back in MS', () => {
      const transport = createTransport();
      const [{ $envelopes }, { setEnvelopeValue, setEnvelopeBpm }] = createEnvelopes(transport);
      transport[1].setBpm(60);
      setEnvelopeValue('env2', 'attack', 0.3);
      setEnvelopeValue('env2', 'release', 3);
      setEnvelopeBpm('env2', true);
      // at 60: 0.3 quarters is a 1/16 (1.2 times), 0.5 a 1/8, 3 quarters a bar (1.33 times, a 1/2 1.5 times)
      expect($envelopes.value.env2).toMatchObject({
        attack: 0.3,
        bpm: true,
        divs: { attack: at('1/16'), hold: 0, decay: at('1/8'), release: at('1 bar') },
      });
      setEnvelopeBpm('env2', false);
      expect($envelopes.value.env2).toMatchObject({
        bpm: false,
        attack: 0.25,
        hold: 0,
        decay: 0.5,
        release: 4,
      });
    });

    it('keeps the seconds of MS within 32 s', () => {
      const transport = createTransport();
      const [{ $envelopes }, { setEnvelopeBpm, setEnvelopeDivision }] = createEnvelopes(transport);
      transport[1].setBpm(20);
      setEnvelopeBpm('env1', true);
      setEnvelopeDivision('env1', 'release', at('32 bar'));
      setEnvelopeBpm('env1', false);
      expect($envelopes.value.env1.release).toBe(32);
    });

    it('steps a time through Off and the straight divisions', () => {
      const [{ $envelopes }, { setEnvelopeDivision }] = createEnvelopes();
      setEnvelopeDivision('env3', 'hold', at('1/8D'));
      setEnvelopeDivision('env3', 'decay', 0);
      setEnvelopeDivision('env3', 'release', at('1/512'));
      expect($envelopes.value.env3.divs).toMatchObject({ hold: at('1/8'), decay: 0, release: at('1/512') });
    });

    it('plays the seconds of its divisions at a tempo: longer than 32 s too', () => {
      const [{ $envelopes }, { setEnvelopeBpm, setEnvelopeDivision }] = createEnvelopes();
      setEnvelopeBpm('env1', true);
      setEnvelopeDivision('env1', 'attack', at('1/4'));
      setEnvelopeDivision('env1', 'release', at('32 bar'));
      expect(envelopeSeconds($envelopes.value.env1, 120)).toEqual({
        attack: 0.5,
        hold: 0.125,
        decay: 0,
        sustain: 1,
        release: 64,
        curves,
      });
      expect(envelopeSeconds($envelopes.value.env1, 20).release).toBe(384);
      // MS: its seconds
      expect(envelopeSeconds(defaults.env2, 60)).toEqual({ ...ENVELOPE_DEFAULTS.env2, curves });
    });

    it('round trips through the snapshot, false and Off kept, a division of a url within its steps', () => {
      const [{ $envelopes }, { setEnvelopeBpm, setEnvelopeDivision }] = createEnvelopes();
      setEnvelopeBpm('env3', true);
      setEnvelopeDivision('env3', 'attack', 0);
      const snapshot = getSnapshot();
      expect(snapshot['env']).toMatchObject({ e3: { bpm: true, divs: { attack: 0 } } });
      applySnapshot({});
      expect($envelopes.value).toEqual(defaults);
      applySnapshot(snapshot);
      expect($envelopes.value.env3).toMatchObject({ bpm: true, divs: { attack: 0 } });
      applySnapshot({ env: { e1: { bpm: 'yes', divs: { attack: 99, hold: 1.5, decay: at('1/8T') } } } });
      expect($envelopes.value.env1).toEqual({
        ...defaults.env1,
        divs: { ...defaults.env1.divs, decay: at('1/8') },
      });
    });
  });
});
