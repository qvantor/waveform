// the checks of a run (node --test): the regressions of an A/B run, the drift from the baseline, the conditions,
// the invariants and the budgets of report.mjs on the results of a made-up run
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { evaluate, summarizeCpu, summarizeLatency } from './report.mjs';

const OUTPUT = { name: 'Speakers', transport: 'coreaudio_device_type_builtin', rate: 48000 };
const AUDIO = [100, 101, 99, 100.5, 99.5];

const cpuRun = (audio) => ({ audio, main: 20, memory: { steady: 250, peak: 260 }, realtime: 1, glitches: 0 });
// S5, against the runs of a reference (an A/B run) when given
const cpuCase = (audio, reference = null) => {
  const runs = audio.map(cpuRun);
  const kase = { id: 'S5', group: 'cpu', title: 'S5', runs, summary: summarizeCpu(runs) };
  if (reference) kase.reference = { runs: reference.map(cpuRun) };
  return kase;
};
const note = (toVoice, values = {}) => ({
  lost: false,
  started: 1000,
  toVoice,
  toOutput: toVoice + 20,
  noteOn: 0.2,
  ...values,
});
const latencyCase = (id, notes, reference = null) => ({
  id,
  group: 'latency',
  title: id,
  notes,
  summary: summarizeLatency(notes),
  ...(reference && { reference: { notes: reference, summary: summarizeLatency(reference) } }),
});
const results = ({ cases, browser = 'chromium', output = OUTPUT, version = '133.0' }) => ({
  machine: { os: '26.6.2' },
  mode: 'headed',
  preflight: { issues: [], output },
  browsers: { [browser]: { version, cases: Object.fromEntries(cases.map((kase) => [kase.id, kase])) } },
  dsp: null,
});
const baseline = (cases, { browser = 'chromium', version = '133.0' } = {}) => ({
  modes: { [`${browser}/headed`]: { version, os: '26.6.2', output: OUTPUT, cases } },
});
const levels = (checks, kind) => checks.filter((check) => check.kind === kind).map(({ level }) => level);

describe('evaluate', () => {
  const SLOWER = [110, 111, 109, 110.5, 109.5];

  it('fails a regression of the audio thread the runs of an A/B run tell apart', () => {
    const checks = evaluate(results({ cases: [cpuCase(SLOWER, AUDIO)] }), null);
    assert.deepEqual(levels(checks, 'regression'), ['fail']);
    assert.match(checks[0].message, /reference 100\.00/);
  });

  it('checks no regression without a reference: the baseline of another session only warns of drift', () => {
    // +10%: within the drift of a session (up to 20% seen)
    assert.deepEqual(
      evaluate(results({ cases: [cpuCase(SLOWER)] }), baseline({ S5: { audio: AUDIO } })).map(
        ({ kind }) => kind
      ),
      []
    );
    const checks = evaluate(
      results({ cases: [cpuCase([130, 131, 129, 130.5, 129.5])] }),
      baseline({ S5: { audio: AUDIO } })
    );
    assert.deepEqual(levels(checks, 'regression'), []);
    assert.deepEqual(levels(checks, 'drift'), ['warn']);
  });

  it('still checks the drift when the output is unknown, and warns that it is', () => {
    const checks = evaluate(
      results({ cases: [cpuCase([130, 131, 129, 130.5, 129.5])], output: null }),
      baseline({ S5: { audio: AUDIO } })
    );
    assert.deepEqual(levels(checks, 'drift'), ['warn']);
    assert.match(
      checks.find(({ kind }) => kind === 'baseline').message,
      /unknown output transport, output rate/
    );
  });

  it('checks no drift against the baseline of another browser version, says so', () => {
    const checks = evaluate(
      results({ cases: [cpuCase([130, 131, 129, 130.5, 129.5])], version: '134.0' }),
      baseline({ S5: { audio: AUDIO } })
    );
    assert.deepEqual(levels(checks, 'drift'), []);
    assert.match(checks.find(({ kind }) => kind === 'baseline').message, /version 133\.0, now 134\.0/);
  });

  it('fails a case without the audio thread of the page in any run', () => {
    const checks = evaluate(results({ cases: [cpuCase([NaN, NaN, NaN, NaN, NaN])] }), null);
    assert.deepEqual(levels(checks, 'invariant'), ['fail']);
  });

  it('compares the notes to the voice of both sides, to the output only where it is timed', () => {
    const slow = Array.from({ length: 50 }, (_, i) => note(5 + (i % 5) * 0.1));
    const quick = slow.map(({ toVoice }) => note(toVoice - 1));
    const chromium = evaluate(results({ cases: [latencyCase('L1', slow, quick)] }), null);
    // to the output only warns: the output path is the browser's and the device's
    assert.deepEqual(levels(chromium, 'regression'), ['fail', 'warn']);
    const webkit = evaluate(results({ cases: [latencyCase('L1', slow, quick)], browser: 'webkit' }), null);
    assert.deepEqual(levels(webkit, 'regression'), ['fail']);
  });

  it('fails a note that never sounded although the synth was ready', () => {
    const notes = [note(4), note(null, { started: null })];
    assert.deepEqual(levels(evaluate(results({ cases: [latencyCase('L1', notes)] }), null), 'invariant'), [
      'fail',
    ]);
  });

  it('has no jitter without timed notes, and no budget of it', () => {
    const notes = [note(null, { lost: true, started: null })];
    const summary = summarizeLatency(notes);
    assert.equal(summary.toVoice.jitter, null);
    assert.deepEqual(levels(evaluate(results({ cases: [latencyCase('L1', notes)] }), null), 'budget'), []);
  });
});
