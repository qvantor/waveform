import { applySnapshot, getSnapshot } from '../../../app';
import { createAdsrEnvelope } from '../../../../test-utils/models';

const defaults = { attack: 0.005, hold: 0.1, decay: 0, sustain: 1, release: 0.005 };

describe('adsrEnvelope', () => {
  it('starts with the default envelope', () => {
    const [{ $envelope }] = createAdsrEnvelope();
    expect($envelope.value).toEqual(defaults);
  });

  it('setEnvelopeValue changes one value', () => {
    const [{ $envelope }, { setEnvelopeValue }] = createAdsrEnvelope();
    setEnvelopeValue('attack', 0.5);
    expect($envelope.value).toEqual({ ...defaults, attack: 0.5 });
  });

  it('exposes the envelope in the snapshot', () => {
    const [, { setEnvelopeValue }] = createAdsrEnvelope();
    setEnvelopeValue('release', 2);
    expect(getSnapshot()['adsr']).toEqual({ ...defaults, release: 2 });
  });

  it('applies a snapshot, keeps falsy values and restores defaults for missing keys', () => {
    const [{ $envelope }, { setEnvelopeValue }] = createAdsrEnvelope();
    setEnvelopeValue('hold', 3);
    setEnvelopeValue('decay', 4);

    applySnapshot({ adsr: { attack: 1, sustain: 0 } });

    expect($envelope.value).toEqual({ ...defaults, attack: 1, sustain: 0 });
  });

  it('resets to defaults when the snapshot has no envelope', () => {
    const [{ $envelope }, { setEnvelopeValue }] = createAdsrEnvelope();
    setEnvelopeValue('attack', 1);
    applySnapshot({});
    expect($envelope.value).toEqual(defaults);
  });
});
