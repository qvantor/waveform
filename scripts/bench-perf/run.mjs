// The perf suite of the synth (see README.md): the perf build of the app in Chromium (WebKit on request) through
// Playwright (not a dependency of the project) — the cycles and the memory of the heavy patch from Instruments,
// the latency of the notes from the test hook of the page — and the signal processing in Node; regressions
// against the baseline of the machine fail, budgets warn. What needs no browser is in the Jest specs:
//   npx -y -p playwright@1.50.1 node scripts/bench-perf/run.mjs [--against=<ref>] [--browsers=chromium,webkit]
//     [--only=S5,L1,L3,dsp|cpu|latency] [--runs=5] [--update-baseline] [--headless] [--keep-traces]
//     [--dump-trace] [--rebuild]
// --against: an A/B run, the code of the commit <ref> (main, HEAD: the uncommitted changes) and the working tree
// alternate in one session; only its regressions fail (a baseline of another session only warns of drift)
import fs from 'fs';
import path from 'path';
import { launch, openPage, traceEvents } from './browser.mjs';
import {
  analyzeQuanta,
  countGlitches,
  GLITCH_CATEGORIES,
  histogram,
  QUANTA_CATEGORIES,
} from './chrome-trace.mjs';
import { runDspBenchmarks } from './dsp.mjs';
import { runLatencyCase } from './latency.mjs';
import { prepareReference } from './reference.mjs';
import { evaluate, loadBaseline, summarizeCpu, updateBaseline, writeReport } from './report.mjs';
import { selectCases, TABLES } from './scenes.mjs';
import { buildSite, downloadTables, serve } from './site.mjs';
import {
  fixed,
  git,
  keepAwake,
  loadPlaywright,
  machine,
  out,
  parseArgs,
  preflight,
  sleep,
  tracesDir,
} from './util.mjs';
import { analyzeTrace, record } from './xctrace.mjs';

const args = parseArgs(process.argv.slice(2));
// Chromium unless asked: WebKit (the engine of the iPad) with --browsers
const browsers = (args.browsers ?? 'chromium').split(',');
// runs of a CPU case, of each side of an A/B run: the regressions compare the sides (Mann–Whitney: 5 a side can
// tell a difference apart, p down to 0.004)
const runs = Number(args.runs ?? 5);
// the reference of an A/B run: a commit, a branch, a tag
const against = args.against ?? null;
const headless = args.headless === 'true';
const keepTraces = args['keep-traces'] === 'true';

// seconds recorded per run, after the warm-up (the mixes built, the reverb filled); ms of the window of the
// render quanta of Chromium after it
const RECORD = 10;
const WARMUP = 3000;
const QUANTA_WINDOW = 4000;

const log = (browser, text) => console.log(`[${browser}] ${text}`);

// the counters of the engine over the recorded window (the stats at its start and its end)
const engineDeltas = (s0, s1) => {
  const a = s0.engine?.worklet;
  const b = s1.engine?.worklet;
  const worker = s1.engine?.worker;
  if (!a || !b) return null;
  const seconds = (s1.at - s0.at) / 1000;
  const mix = b.mixSamples - a.mixSamples;
  const direct = b.directSamples - a.directSamples;
  return {
    directShare: mix + direct ? direct / (mix + direct) : 0,
    buildsPerSecond: (b.builds - a.builds) / seconds,
    refusedPerSecond: (b.refused - a.refused) / seconds,
    peakCost: b.peakCost,
    voices: b.voices,
    unison: b.unison,
    tables: b.tables,
    versions: b.versions,
    storeMB: b.bytes / 2 ** 20,
    mixMB: Number.isFinite(b.mixBytes) ? b.mixBytes / 2 ** 20 : null,
    poolMB: worker ? worker.pool / 2 ** 20 : null,
    buildMs: worker?.maxMs ?? null,
  };
};

// a run of a CPU case: a fresh page, the snapshot and the notes, the warm-up, then Instruments records while the
// hook reads its counters at the start and the end; `previous` (the analysis of the run before) ends before this
// one records. The render quanta of Chromium in the first run of a case only (of each side of an A/B run)
const recordRun = async ({ launched, origin, kase, side, index, previous }) => {
  fs.mkdirSync(tracesDir, { recursive: true });
  const traceFile = path.join(tracesDir, `${launched.name}-${kase.id}-${side}-${index}.trace`);
  const { context, page, call, errors } = await openPage(launched.browser, origin);
  const chromium = launched.name === 'chromium';
  const quanta = chromium && index === 0;
  const trace = (categories, during) => traceEvents(launched.browser, page, categories, during);
  try {
    await call('apply', kase.snapshot, 60000);
    await call(
      'run',
      kase.notes.map((note) => ({ at: 0, note, on: true }))
    );
    await sleep(WARMUP);
    await previous;
    fs.rmSync(traceFile, { recursive: true, force: true });
    const recording = record({ output: traceFile, seconds: RECORD });
    await recording.started;
    // the recorded span (its time limit counts from the notification): the counters at its ends, the glitches
    // of Chromium within it
    const s0 = await call('stats');
    let s1 = null;
    const span = async () => {
      await sleep(RECORD * 1000);
      s1 = await call('stats');
    };
    const glitches = chromium ? countGlitches(await trace(GLITCH_CATEGORIES, span)) : (await span(), null);
    // Instruments saves the trace; then the render quanta of Chromium in a window of their own (their tracing
    // costs the worklet thread some cycles)
    await recording.done;
    const quantaEvents = quanta ? await trace(QUANTA_CATEGORIES, () => sleep(QUANTA_WINDOW)) : null;
    await call('releaseAll');
    return { window: { traceFile, s0, s1, glitches, quantaEvents }, errors };
  } finally {
    await context.close();
  }
};

const analyzeWindow = async (launched, window, { dump }) => {
  const trace = await analyzeTrace(window.traceFile, { engine: launched.name, owns: launched.owns });
  if (!keepTraces) fs.rmSync(window.traceFile, { recursive: true, force: true });
  const { s0, s1 } = window;
  const seconds = (s1.at - s0.at) / 1000;
  const quanta = window.quantaEvents
    ? analyzeQuanta(window.quantaEvents, { sampleRate: s1.context.sampleRate })
    : null;
  if (dump && window.quantaEvents)
    fs.writeFileSync(path.join(out, 'trace-events.md'), histogram(window.quantaEvents));
  return {
    ...trace,
    realtime: (s1.context.currentTime - s0.context.currentTime) / seconds,
    glitches: window.glitches,
    engine: engineDeltas(s0, s1),
    quanta,
  };
};

// the runs of a CPU case, of both sides of an A/B run alternating (A B B A …): the analysis of a run goes on while
// the next one sets up; an error of an analysis is kept (never an unhandled rejection) and fails the case at the
// next run or at the end
const runCpuCase = async ({ launched, origins, kase }) => {
  const result = { id: kase.id, group: 'cpu', title: kase.title, runs: [] };
  if (origins.reference) result.reference = { runs: [] };
  const sides = origins.reference ? ['current', 'reference'] : ['current'];
  const order = Array.from({ length: runs }, (_, index) => (index % 2 ? [...sides].reverse() : sides))
    .flat()
    .map((side, at) => ({ side, index: Math.floor(at / sides.length) }));
  const runsOf = (side) => (side === 'reference' ? result.reference.runs : result.runs);
  let previous = Promise.resolve();
  let failure = null;
  try {
    for (const { side, index } of order) {
      if (failure) throw failure;
      const origin = origins[side];
      const run = await recordRun({ launched, origin, kase, side, index, previous });
      if (run.errors.length) log(launched.name, `${kase.id} ${side} page errors: ${run.errors.join('; ')}`);
      previous = analyzeWindow(launched, run.window, {
        dump: args['dump-trace'] === 'true' && side === 'current',
      }).then(
        (analysis) => {
          runsOf(side).push(analysis);
          log(
            launched.name,
            `${kase.id}${origins.reference ? ` ${side}` : ''} run ${index + 1}: audio ${fixed(
              analysis.audio,
              1
            )} Mcps (${analysis.page?.thread ?? 'no audio thread'}), memory ${fixed(
              analysis.memory?.steady,
              0
            )} MB, realtime ${fixed(analysis.realtime, 4)}`
          );
        },
        (error) => {
          failure ??= error;
        }
      );
    }
    await previous;
    if (failure) throw failure;
    result.summary = summarizeCpu(result.runs);
    if (result.reference) result.reference.summary = summarizeCpu(result.reference.runs);
  } catch (error) {
    result.error = error.message;
    log(launched.name, `${kase.id} failed: ${error.message}`);
  }
  return result;
};

const main = async () => {
  const started = Date.now();
  const cases = selectCases({ only: args.only });
  const dsp = !args.only || args.only.split(',').includes('dsp');
  const [machineInfo, gitInfo, pre] = await Promise.all([machine(), git(), preflight()]);
  pre.issues.forEach((issue) => console.log(`preflight: ${issue}`));
  const awake = keepAwake();
  const results = {
    date: new Date().toISOString(),
    machine: machineInfo,
    git: gitInfo,
    mode: headless ? 'headless' : 'headed',
    preflight: pre,
    browsers: {},
    dsp: null,
    against: null,
  };
  try {
    const reference = against ? await prepareReference(against, { build: cases.length > 0 }) : null;
    if (reference) {
      results.against = { ref: reference.ref, sha: reference.short, notes: reference.notes };
      reference.notes.forEach((note) => console.log(`against: ${note}`));
    }
    if (dsp) {
      console.log(`dsp: micro-benchmarks in Node${reference ? `, against ${reference.short}` : ''}…`);
      results.dsp = await runDspBenchmarks({ reference });
    }
    if (cases.length) {
      const playwright = loadPlaywright();
      const keys = Object.values(TABLES);
      await downloadTables(keys);
      await buildSite({ force: args.rebuild === 'true' });
      const servers = [await serve({ keys })];
      if (reference) servers.push(await serve({ keys, site: reference.siteDir }));
      const [current, other] = servers.map(({ port }) => `http://localhost:${port}/`);
      const origins = { current, reference: other ?? null };
      try {
        for (const name of browsers) {
          const launched = await launch(playwright, name, { headless });
          results.browsers[name] = { version: launched.version, cases: {} };
          const store = results.browsers[name].cases;
          try {
            for (const kase of cases) {
              log(name, `${kase.id}: ${kase.title}`);
              if (kase.group === 'cpu') {
                store[kase.id] = await runCpuCase({ launched, origins, kase });
                continue;
              }
              store[kase.id] = await runLatencyCase({ launched, origins, kase });
              const { summary, error, reference: theirs } = store[kase.id];
              const line = (label, s) =>
                `${kase.id}${label}: to voice p50 ${fixed(s.toVoice.p50, 2)} ms, p95 ${fixed(
                  s.toVoice.p95,
                  2
                )} ms, to output p95 ${fixed(s.toOutput.p95, 1)} ms, lost ${s.lost}`;
              if (error) log(name, `${kase.id} failed: ${error}`);
              else {
                log(name, line(theirs ? ' current' : '', summary));
                if (theirs) log(name, line(' reference', theirs.summary));
              }
            }
          } finally {
            await launched.browser.close();
          }
        }
      } finally {
        servers.forEach(({ server }) => server.close());
      }
    }
  } finally {
    awake();
  }
  results.duration = (Date.now() - started) / 1000;
  const baseline = loadBaseline(machineInfo.key);
  const checks = evaluate(results, baseline);
  const report = writeReport(results, checks);
  const fails = checks.filter(({ level }) => level === 'fail');
  checks.forEach(({ level, browser, case: kase, message }) =>
    console.log(`${level.toUpperCase()} ${[browser, kase].filter(Boolean).join(' ')}: ${message}`)
  );
  if (args['update-baseline'] === 'true') {
    const { file, dropped } = updateBaseline(results, checks);
    if (dropped.length) console.log(`baseline: dropped (other conditions): ${dropped.join(', ')}`);
    console.log(`baseline: ${file}`);
  } else if (!baseline)
    console.log('no baseline of this machine yet: run with --update-baseline to keep this one');
  console.log(`report: ${report}`);
  process.exitCode = fails.length ? 1 : 0;
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
