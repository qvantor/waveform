// the verdicts of a run (README: statuses): the regressions of an A/B run against its reference (verdict.mjs) and
// broken invariants fail; the drift from the baseline of the machine, the budgets of the README and what may skew
// the run only warn; the report in markdown and json, the baseline file
import fs from 'fs';
import path from 'path';
import { cv, fixed, here, median, out, percentile, round4 } from './util.mjs';
import { conditionChanges, drift, mannWhitney, mergeMode, regression } from './verdict.mjs';

// --- the runs of a case ---

const pick = (runs, get) => median(runs.map(get).filter((value) => Number.isFinite(value)));

// the medians of the runs of a CPU case, with the counters of the engine over the recorded window
export const summarizeCpu = (runs) => ({
  audio: pick(runs, (run) => run.audio),
  main: pick(runs, (run) => run.main),
  worker: pick(runs, (run) => run.worker),
  pageTotal: pick(runs, (run) => run.pageTotal),
  browserAudio: pick(runs, (run) => run.browserAudio?.reduce((sum, { rate }) => sum + rate, 0)),
  background: pick(runs, (run) => run.background),
  memSteady: pick(runs, (run) => run.memory?.steady),
  memPeak: pick(runs, (run) => run.memory?.peak),
  realtime: pick(runs, (run) => run.realtime),
  directShare: pick(runs, (run) => run.engine?.directShare),
  buildsPerSecond: pick(runs, (run) => run.engine?.buildsPerSecond),
  refusedPerSecond: pick(runs, (run) => run.engine?.refusedPerSecond),
  peakCost: pick(runs, (run) => run.engine?.peakCost),
  voices: pick(runs, (run) => run.engine?.voices),
  storeMB: pick(runs, (run) => run.engine?.storeMB),
  poolMB: pick(runs, (run) => run.engine?.poolMB),
  mixMB: pick(runs, (run) => run.engine?.mixMB),
  buildMs: pick(runs, (run) => run.engine?.buildMs),
  quantaP50: pick(runs, (run) => run.quanta?.p50),
  quantaP99: pick(runs, (run) => run.quanta?.p99),
  quantaMax: pick(runs, (run) => run.quanta?.max),
  deadline: pick(runs, (run) => run.quanta?.deadline),
  cv: cv(runs.map((run) => run.audio)),
  cores: runs[0]?.audioCores ?? {},
  thread: runs[0]?.page?.thread ?? null,
  // runs with dropouts: a device callback Chromium missed, or (WebKit too) the context fell behind the clock
  // (coarse: its time moves by device buffers, 0.5% is 50 ms of 10 s)
  dropouts: runs.filter((run) => run.glitches > 0 || run.realtime < 0.995).length,
  glitches: runs.reduce((sum, run) => sum + (run.glitches ?? 0), 0),
});

// percentiles of the latency of the notes of a latency case, ms
export const summarizeLatency = (notes) => {
  const values = (key) => notes.map((note) => note[key]).filter((value) => Number.isFinite(value));
  const stats = (key) => {
    const list = values(key);
    return {
      p5: percentile(list, 5),
      p50: percentile(list, 50),
      p95: percentile(list, 95),
      max: list.length ? Math.max(...list) : null,
      count: list.length,
    };
  };
  const toVoice = stats('toVoice');
  return {
    notes: notes.length,
    lost: notes.filter((note) => note.lost).length,
    // lost although the oscillator was ready: an invariant
    lostReady: notes.filter((note) => !note.lost && note.started === null).length,
    // no notes timed: no jitter (not 0)
    toVoice: { ...toVoice, jitter: toVoice.count ? toVoice.p95 - toVoice.p5 : null },
    outputPath: stats('outputPath'),
    toOutput: stats('toOutput'),
    toHandler: stats('toHandler'),
    noteOn: stats('noteOn'),
    renderLag: stats('renderLag'),
    dsp: stats('dsp'),
  };
};

// --- the conditions of a run ---

// browsers whose getOutputTimestamp is the time at the output of the device (WebKit's is its render clock and it
// reports no output latency): their latency to the output is measured
const outputTimed = (browser) => browser !== 'webkit';

const runConditions = (results) => ({ os: results.machine.os, output: results.preflight.output });

const describeOutput = (output) =>
  output
    ? `${output.name} (${output.transport ?? 'unknown transport'}, ${output.rate ?? '?'} Hz)`
    : 'unknown';

// --- the baseline of the machine ---

const baselineFile = (key) => path.join(here, 'baselines', `${key}.json`);
export const loadBaseline = (key) => {
  const file = baselineFile(key);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
};

const finite = (values) => values.filter((value) => Number.isFinite(value));
// the values the regressions compare: of each run of a CPU case, of each note of a latency case (`side`: the
// case, or its reference in an A/B run)
const caseValues = (kase, side = kase) =>
  kase.group === 'cpu'
    ? {
        audio: finite(side.runs.map((run) => run.audio)),
        main: finite(side.runs.map((run) => run.main)),
        memSteady: finite(side.runs.map((run) => run.memory?.steady)),
      }
    : {
        toVoice: finite(side.notes.map((note) => note.toVoice)),
        toOutput: finite(side.notes.map((note) => note.toOutput)),
      };
const sortKeys = (value) =>
  Array.isArray(value)
    ? value.map(sortKeys)
    : value && typeof value === 'object'
    ? Object.fromEntries(
        Object.keys(value)
          .sort()
          .map((key) => [key, sortKeys(value[key])])
      )
    : typeof value === 'number'
    ? round4(value)
    : value;

// writes the measured cases (not those that broke an invariant or errored: they aren't a cost to keep) over the
// kept ones of the same browser version and conditions (verdict.mjs: mergeMode); the DSP of the run, else the
// one kept
export const updateBaseline = (results, checks) => {
  const previous = loadBaseline(results.machine.key) ?? { modes: {}, dsp: null };
  const broken = new Set(
    checks
      .filter(({ level, kind }) => level === 'fail' && kind !== 'regression')
      .map((check) => `${check.browser}/${check.case}`)
  );
  const modes = { ...previous.modes };
  const dropped = [];
  for (const [browser, { version, cases }] of Object.entries(results.browsers)) {
    const key = `${browser}/${results.mode}`;
    const measured = Object.fromEntries(
      Object.entries(cases)
        .filter(([id, kase]) => kase.summary && !broken.has(`${browser}/${id}`))
        .map(([id, kase]) => [id, caseValues(kase)])
    );
    const merged = mergeMode(modes[key], { version, conditions: runConditions(results), cases: measured });
    modes[key] = merged.mode;
    dropped.push(...merged.dropped.map((id) => `${key} ${id}`));
  }
  const dsp = results.dsp
    ? {
        node: results.dsp.node.split('.')[0],
        cases: Object.fromEntries(
          Object.entries(results.dsp.cases).map(([name, { samples }]) => [name, samples])
        ),
      }
    : previous.dsp;
  const baseline = sortKeys({
    machine: results.machine,
    updated: results.date,
    commit: results.git.commit,
    modes,
    dsp,
  });
  const file = baselineFile(results.machine.key);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(baseline, null, 2)}\n`);
  return { file, dropped };
};

// --- the checks ---

// the regressions of an A/B run: p of the one-sided Mann–Whitney (runs of a CPU case, notes of a latency case,
// samples of the DSP: the current side against the reference) and the least shift of the median that counts;
// fewer values than `min` a side only warn
const REGRESSIONS = {
  audio: { metric: 'audio thread', unit: 'Mcps', alpha: 0.05, rel: 0.05, abs: 2, min: 5 },
  memory: { metric: 'memory', unit: 'MB', alpha: 0.05, rel: 0.05, abs: 10, min: 5 },
  main: { metric: 'main thread', unit: 'Mcps', alpha: 0.05, rel: 0.15, abs: 5, min: 5, warnOnly: true },
  toVoice: { metric: 'to voice', unit: 'ms', alpha: 0.01, abs: 0.5, min: 20 },
  // the output path is the browser's and the device's (it moves day to day on the same output)
  toOutput: { metric: 'to output', unit: 'ms', alpha: 0.01, abs: 0.5, min: 20, warnOnly: true },
  // the samples of an A/A run agree within 1.5%
  dsp: { alpha: 0.05, rel: 0.05, min: 5 },
};

// the drift from the baseline of another session that warns: more than a session drifts (on the same code S5
// moved 8.5% and 20%, a voice of the DSP 11.6% between sessions); the latency to the output not (it moves day to
// day)
const DRIFT = {
  audio: { metric: 'audio thread', unit: 'Mcps', rel: 0.25, abs: 5 },
  memory: { metric: 'memory', unit: 'MB', rel: 0.1, abs: 20 },
  toVoice: { metric: 'to voice', unit: 'ms', abs: 1 },
  dsp: { rel: 0.2 },
};

// README budgets (warnings): ms, MB, shares of the deadline
const BUDGETS = {
  heavyMemory: 300,
  l1P95: 8,
  jitter: 3,
  loadedP95: 3,
  loadedMax: 20,
  noteOn: 1,
  quantaP99: 0.5,
  quantaMax: 0.8,
};

export const evaluate = (results, baseline) => {
  const checks = [];
  const add = (level, kind, browser, kase, message) =>
    checks.push({ level, kind, browser, case: kase, message });
  const compare = (browser, kase, current, reference, options) => {
    const found = regression(current, reference, options);
    if (found) add(found.level, 'regression', browser, kase, found.message);
  };
  const drifted = (browser, kase, current, base, options) => {
    const message = base && drift(current, base, options);
    if (message) add('warn', 'drift', browser, kase, message);
  };

  results.preflight.issues.forEach((issue) => add('warn', 'preflight', '', '', issue));
  results.against?.notes?.forEach((note) => add('warn', 'reference', '', '', note));

  for (const [browser, { version, cases }] of Object.entries(results.browsers)) {
    const base = baseline?.modes?.[`${browser}/${results.mode}`];
    const conditions = runConditions(results);
    if (base) {
      const { changes, unknown } = conditionChanges(conditions, base);
      if (changes.length)
        add('warn', 'baseline', browser, '', `${changes.join('; ')}: no drift checked, rebaseline`);
      if (unknown.length)
        add('warn', 'baseline', browser, '', `unknown ${unknown.join(', ')}: compared as if the same`);
      if (base.version !== version)
        add(
          'warn',
          'baseline',
          browser,
          '',
          `baseline of version ${base.version}, now ${version}: rebaseline`
        );
    }
    // the drift is checked against a baseline of the same browser version and conditions (unknown: the same)
    const comparable = base && base.version === version && !conditionChanges(conditions, base).changes.length;

    for (const kase of Object.values(cases)) {
      if (kase.error) {
        add('fail', 'error', browser, kase.id, kase.error);
        continue;
      }
      const summary = kase.summary;
      const previous = comparable ? base.cases?.[kase.id] : null;
      const values = caseValues(kase);
      const theirs = kase.reference && caseValues(kase, kase.reference);
      if (kase.group === 'cpu') {
        if (theirs) {
          compare(browser, kase.id, values.audio, theirs.audio, REGRESSIONS.audio);
          compare(browser, kase.id, values.memSteady, theirs.memSteady, REGRESSIONS.memory);
          compare(browser, kase.id, values.main, theirs.main, REGRESSIONS.main);
        }
        if (previous) {
          drifted(browser, kase.id, values.audio, previous.audio, DRIFT.audio);
          drifted(browser, kase.id, values.memSteady, previous.memSteady, DRIFT.memory);
        }
        // without the audio thread of the page (renamed in a new browser, in a process `owns` misses) or its
        // memory a case has nothing to compare: every check would pass unseen
        const noAudio = kase.runs.filter((run) => !Number.isFinite(run.audio)).length;
        if (noAudio)
          add(
            noAudio === kase.runs.length ? 'fail' : 'warn',
            'invariant',
            browser,
            kase.id,
            `no audio thread of the page in ${noAudio} of ${kase.runs.length} runs (xctrace.mjs: ENGINES, owns)`
          );
        else if (!Number.isFinite(summary.memSteady))
          add('fail', 'invariant', browser, kase.id, 'no memory of the page in the trace (Activity Monitor)');
        if (summary.dropouts > kase.runs.length / 2)
          add(
            'fail',
            'invariant',
            browser,
            kase.id,
            `dropouts in ${summary.dropouts} of ${kase.runs.length} runs`
          );
        else if (summary.dropouts)
          add('warn', 'invariant', browser, kase.id, `dropouts in ${summary.dropouts} run(s)`);
        if (summary.memSteady > BUDGETS.heavyMemory)
          add(
            'warn',
            'budget',
            browser,
            kase.id,
            `memory ${fixed(summary.memSteady)} MB > ${BUDGETS.heavyMemory} MB`
          );
        if (Number.isFinite(summary.deadline)) {
          if (summary.quantaP99 > BUDGETS.quantaP99 * summary.deadline)
            add(
              'warn',
              'budget',
              browser,
              kase.id,
              `render quanta p99 ${fixed(summary.quantaP99, 2)} ms > ${BUDGETS.quantaP99 * 100}% of ${fixed(
                summary.deadline,
                2
              )} ms`
            );
          if (summary.quantaMax > BUDGETS.quantaMax * summary.deadline)
            add(
              'warn',
              'budget',
              browser,
              kase.id,
              `a render quantum took ${fixed(summary.quantaMax, 2)} ms > ${
                BUDGETS.quantaMax * 100
              }% of the deadline`
            );
        }
      } else {
        if (theirs) {
          compare(browser, kase.id, values.toVoice, theirs.toVoice, REGRESSIONS.toVoice);
          if (outputTimed(browser))
            compare(browser, kase.id, values.toOutput, theirs.toOutput, REGRESSIONS.toOutput);
        }
        if (previous) drifted(browser, kase.id, values.toVoice, previous.toVoice, DRIFT.toVoice);
        if (summary.lostReady > 0)
          add(
            'fail',
            'invariant',
            browser,
            kase.id,
            `${summary.lostReady} note(s) never sounded although the synth was ready`
          );
        // the budgets of the latency the page adds (the output path is the browser's and the device's)
        if (kase.id === 'L1' && summary.toVoice.p95 > BUDGETS.l1P95)
          add(
            'warn',
            'budget',
            browser,
            kase.id,
            `to voice p95 ${fixed(summary.toVoice.p95, 2)} ms > ${BUDGETS.l1P95} ms`
          );
        if (kase.id === 'L1' && summary.toVoice.jitter > BUDGETS.jitter)
          add(
            'warn',
            'budget',
            browser,
            kase.id,
            `to voice jitter ${fixed(summary.toVoice.jitter, 2)} ms > ${BUDGETS.jitter} ms`
          );
        const l1 = cases.L1?.summary?.toVoice?.p95;
        if (kase.id === 'L3') {
          if (Number.isFinite(l1) && summary.toVoice.p95 > l1 + BUDGETS.loadedP95)
            add(
              'warn',
              'budget',
              browser,
              kase.id,
              `to voice p95 ${fixed(summary.toVoice.p95, 2)} ms > L1 + ${BUDGETS.loadedP95} ms`
            );
          if (summary.toVoice.max > BUDGETS.loadedMax)
            add(
              'warn',
              'budget',
              browser,
              kase.id,
              `to voice max ${fixed(summary.toVoice.max, 2)} ms > ${BUDGETS.loadedMax} ms`
            );
        }
        if (summary.noteOn.p95 > BUDGETS.noteOn)
          add(
            'warn',
            'budget',
            browser,
            kase.id,
            `a note-on takes ${fixed(summary.noteOn.p95, 2)} ms (p95) on the main thread > ${
              BUDGETS.noteOn
            } ms`
          );
      }
    }
  }

  if (results.dsp) {
    const sameNode = baseline?.dsp?.node === results.dsp.node.split('.')[0];
    if (results.dsp.reference?.error)
      add('warn', 'reference', 'node', '', `dsp of the reference: ${results.dsp.reference.error}`);
    for (const [name, { samples, reference }] of Object.entries(results.dsp.cases)) {
      const metric = `dsp ${name}`;
      if (reference) compare('node', name, samples, reference.samples, { ...REGRESSIONS.dsp, metric });
      if (sameNode) drifted('node', name, samples, baseline.dsp.cases?.[name], { ...DRIFT.dsp, metric });
    }
  }
  return checks;
};

// --- the report ---

const signed = (value, digits = 1) =>
  Number.isFinite(value) ? `${value >= 0 ? '+' : ''}${value.toFixed(digits)}` : '–';

// a row of the A/B comparison: the medians of both sides, the shift, p of the one-sided Mann–Whitney
const abRow = (id, metric, unit, current, reference) => {
  const m1 = median(current);
  const m0 = median(reference);
  const { p } = mannWhitney(current, reference);
  return [
    id,
    metric,
    `${fixed(m0, 2)} ${unit}`,
    `${fixed(m1, 2)} ${unit}`,
    m0 > 0 ? `${signed(((m1 - m0) / m0) * 100)}%` : signed(m1 - m0, 2),
    p === null ? '–' : p.toPrecision(2),
  ];
};

const table = (header, rows) => [
  `| ${header.join(' | ')} |`,
  `| ${header.map(() => '---').join(' | ')} |`,
  ...rows.map((row) => `| ${row.join(' | ')} |`),
];

export const writeReport = (results, checks) => {
  const lines = [
    '# Waveform perf suite',
    '',
    `${results.date} · ${results.machine.model} (${results.machine.cpu}, ${
      results.machine.memGB
    } GB), macOS ${results.machine.os} · commit ${results.git.commit}${
      results.git.dirty ? ' (dirty)' : ''
    } · ${results.mode} · ${fixed(results.duration / 60, 1)} min`,
    '',
    `Browsers: ${
      Object.entries(results.browsers)
        .map(([name, { version }]) => `${name} ${version}`)
        .join(', ') || 'none'
    }. Output: ${describeOutput(results.preflight.output)}.`,
    '',
    results.against
      ? `A/B against ${results.against.ref} (${results.against.sha}): its runs and those of the working tree ` +
        'alternate in this session, the regressions compare them.'
      : 'No A/B run: the regressions are not checked (`--against=<ref>`), only the drift from the baseline.',
    '',
  ];
  const fails = checks.filter(({ level }) => level === 'fail');
  const warns = checks.filter(({ level }) => level === 'warn');
  lines.push(
    `**${fails.length ? 'FAILED' : 'passed'}**: ${fails.length} failure(s), ${warns.length} warning(s).`,
    ''
  );
  const list = (title, items) => {
    if (!items.length) return;
    lines.push(`## ${title}`, '');
    items.forEach(({ browser, case: kase, message }) =>
      lines.push(`- ${[browser, kase].filter(Boolean).join(' ')}: ${message}`)
    );
    lines.push('');
  };
  list('Failures', fails);
  list('Warnings', warns);

  for (const [browser, { version, cases }] of Object.entries(results.browsers)) {
    lines.push(`## ${browser} ${version}`, '');
    const cpu = Object.values(cases).filter((kase) => kase.group === 'cpu');
    if (cpu.length) {
      lines.push(
        '### CPU and memory',
        '',
        'Mcps: millions of cycles per second of the thread (CPU Profiler), the median of the runs (each run ' +
          'in report.json). Memory: the footprint of the page process.',
        ''
      );
      lines.push(
        ...table(
          [
            'case',
            'audio Mcps',
            'cores',
            'main',
            'worker',
            'browser audio',
            'memory MB (peak)',
            'quanta p99 / max ms',
            'runs (CV)',
            'scene',
          ],
          cpu.map(({ id, title, summary: s, runs, error }) =>
            error
              ? [id, `error: ${error}`, '', '', '', '', '', '', '', title]
              : [
                  id,
                  fixed(s.audio, 1),
                  Object.entries(s.cores)
                    .map(([type, share]) => `${type} ${fixed(share * 100, 0)}%`)
                    .join(' '),
                  fixed(s.main, 1),
                  fixed(s.worker, 1),
                  fixed(s.browserAudio, 1),
                  `${fixed(s.memSteady, 0)} (${fixed(s.memPeak, 0)})`,
                  Number.isFinite(s.quantaP99) ? `${fixed(s.quantaP99, 2)} / ${fixed(s.quantaMax, 2)}` : '–',
                  `${runs.length} (${fixed(s.cv * 100, 1)}%)`,
                  title,
                ]
          )
        ),
        ''
      );
      lines.push(
        ...table(
          [
            'case',
            'voices',
            'direct %',
            'mix builds/s',
            'refused/s',
            'peak build cost',
            'store MB',
            'mix tables MB',
            'worker pool MB',
            'build ms',
            'realtime',
          ],
          cpu
            .filter(({ summary }) => summary)
            .map(({ id, summary: s }) => [
              id,
              fixed(s.voices, 0),
              fixed(s.directShare * 100, 1),
              fixed(s.buildsPerSecond, 0),
              fixed(s.refusedPerSecond, 0),
              fixed(s.peakCost, 0),
              fixed(s.storeMB, 1),
              fixed(s.mixMB, 1),
              fixed(s.poolMB, 1),
              fixed(s.buildMs, 0),
              fixed(s.realtime, 4),
            ])
        ),
        ''
      );
    }
    const latency = Object.values(cases).filter((kase) => kase.group === 'latency');
    if (latency.length) {
      const timed = outputTimed(browser);
      lines.push(
        '### Latency',
        '',
        'ms from the input event: to its voice (the main thread and the render lag, what the page adds: the ' +
          'start of the voice after its scheduled frame, the clock of the context at the note on), to the ' +
          'output of the device (end to end). Output path: the note on → its scheduled frame at the output ' +
          '(the device callback, the buffers, the output: the browser and the device, not the page)' +
          (timed
            ? ' (getOutputTimestamp)'
            : '; both n/a: the output timestamp of WebKit is its render clock and it reports no output latency') +
          '. Render lag: the voice started after its scheduled frame (its node came after that block began).',
        ''
      );
      lines.push(
        ...table(
          [
            'case',
            'notes (lost)',
            'to voice p50 / p95 / max',
            'jitter',
            'output path p50',
            'to output p50 / p95',
            'to handler p95',
            'note-on p95',
            'render lag p95',
            'dsp',
            'scene',
          ],
          latency.map(({ id, title, summary: s, error, extra }) =>
            error
              ? [id, `error: ${error}`, '', '', '', '', '', '', '', '', title]
              : [
                  id,
                  `${s.notes} (${s.lost})`,
                  `${fixed(s.toVoice.p50, 2)} / ${fixed(s.toVoice.p95, 2)} / ${fixed(s.toVoice.max, 2)}`,
                  fixed(s.toVoice.jitter, 2),
                  timed ? fixed(s.outputPath.p50, 1) : 'n/a',
                  timed ? `${fixed(s.toOutput.p50, 1)} / ${fixed(s.toOutput.p95, 1)}` : 'n/a',
                  fixed(s.toHandler.p95, 2),
                  fixed(s.noteOn.p95, 2),
                  fixed(s.renderLag.p95, 2),
                  fixed(s.dsp.p50, 2),
                  `${title}${extra?.note ? ` (${extra.note})` : ''}`,
                ]
          )
        ),
        ''
      );
    }
  }

  for (const [browser, { cases }] of Object.entries(results.browsers)) {
    const compared = Object.values(cases).filter((kase) => kase.reference && !kase.error);
    if (!compared.length) continue;
    lines.push(
      `## A/B in ${browser}: ${results.against.sha} → the working tree`,
      '',
      'The medians of both sides, the shift, p of the one-sided Mann–Whitney (the runs of S5, the notes of a ' +
        'latency case): a regression fails with p under its alpha and a shift over its threshold.',
      ''
    );
    const rows = compared.flatMap((kase) => {
      const values = caseValues(kase);
      const theirs = caseValues(kase, kase.reference);
      return kase.group === 'cpu'
        ? [
            abRow(kase.id, 'audio thread', 'Mcps', values.audio, theirs.audio),
            abRow(kase.id, 'memory', 'MB', values.memSteady, theirs.memSteady),
            abRow(kase.id, 'main thread', 'Mcps', values.main, theirs.main),
          ]
        : [
            abRow(kase.id, 'to voice', 'ms', values.toVoice, theirs.toVoice),
            ...(outputTimed(browser)
              ? [abRow(kase.id, 'to output', 'ms', values.toOutput, theirs.toOutput)]
              : []),
          ];
    });
    lines.push(...table(['case', 'metric', 'reference', 'current', 'shift', 'p'], rows), '');
  }

  if (results.dsp) {
    lines.push(
      '## DSP (Node)',
      '',
      `Node ${results.dsp.node}, calibration ${fixed(results.dsp.calibration, 3)} ns per multiply-add; the ` +
        'median of 7 samples, normalized: ns divided by the ns of a multiply-add.',
      ''
    );
    const ab = Boolean(results.dsp.reference);
    // the normalized median of the reference, the shift, p
    const versus = (samples, reference) => {
      if (!reference) return ['–', '–', '–'];
      const [, , theirs, , shift, p] = abRow('', '', '', samples, reference.samples);
      return [theirs.trim(), shift, p];
    };
    lines.push(
      ...table(
        ['case', 'value', 'normalized', ...(ab ? [`${results.dsp.reference.sha}`, 'shift', 'p'] : [])],
        Object.entries(results.dsp.cases).map(([name, { value, unit, normalized, samples, reference }]) => [
          name,
          `${fixed(value, 1)} ${unit}`,
          fixed(normalized, 2),
          ...(ab ? versus(samples, reference) : []),
        ])
      ),
      ''
    );
  }

  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'report.md'), lines.join('\n'));
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify({ ...results, checks }, null, 2));
  return path.join(out, 'report.md');
};
