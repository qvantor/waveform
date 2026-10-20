import { ENVELOPE_DEFAULTS } from '@waveform/preset-schema';
import { applySnapshot, getSnapshot } from '../../../app';
import { createEnvelopes } from '../../../../test-utils/models';

const defaults = {
  env1: { attack: 0.005, hold: 0.1, decay: 0, sustain: 1, release: 0.005 },
  env2: ENVELOPE_DEFAULTS.env2,
  env3: ENVELOPE_DEFAULTS.env3,
};

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

  it('selects the envelope the section shows, it is not in the snapshot', () => {
    const [{ $selected }, { select }] = createEnvelopes();
    select('env3');
    expect($selected.value).toBe('env3');
    expect(JSON.stringify(getSnapshot()['env'])).not.toContain('env3');
  });

  it('exposes the envelopes in the snapshot as env: { e1, e2, e3 }', () => {
    const [, { setEnvelopeValue }] = createEnvelopes();
    setEnvelopeValue('env1', 'release', 2);
    setEnvelopeValue('env3', 'decay', 32);
    expect(getSnapshot()['env']).toEqual({
      e1: { ...defaults.env1, release: 2 },
      e2: defaults.env2,
      e3: { ...defaults.env3, decay: 32 },
    });
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

  it('round trips through the snapshot', () => {
    const [{ $envelopes }, { setEnvelopeValue }] = createEnvelopes();
    setEnvelopeValue('env2', 'sustain', 0);
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
});
