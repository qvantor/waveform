// the app on its wasm cores in each browser (manual: `npx -y -p playwright@1.50.1 node
// scripts/wasm-browsers/app.mjs [--browsers=chromium,webkit,firefox]`): the perf build of the app (made once, as
// bench-perf makes it) plays the heavy patch of S5 (bench-perf/scenes.mjs: 2 × u8 on two tables of 256 frames, the
// filter, every effect, 12 notes) headless. Its notes start without the effects, then every effect is added over
// them: their modules load with the app, these are the first blocks they sound; in Chromium no render quantum may
// run over its deadline in a trace of it, nor a glitch (headless: the device callbacks aren't real, the render times
// are). Then the tables are switched under the notes (one of 256 frames no buffer of the store holds yet, one of 11
// frames), traced as well. It checks that the oscillator, the master limiter and every effect are ready, that the engine counts the
// voices and their mix samples, that the output sounds and that the page threw nothing. The tables come from the
// cache of bench-perf (S3 keys in .env otherwise). Exit 1 on a failed check
import { loadPlaywright, parseArgs } from '../bench-common.mjs';
import { launch, openPage } from '../bench-perf/browser.mjs';
import {
  analyzeMessages,
  analyzeQuanta,
  countGlitches,
  MESSAGE_CATEGORIES,
  QUANTA_CATEGORIES,
} from '../bench-perf/chrome-trace.mjs';
import { CPU_CASES, TABLES } from '../bench-perf/scenes.mjs';
import { buildSite, downloadTables, serve } from '../bench-perf/site.mjs';
import { sleep } from '../bench-perf/util.mjs';

const args = parseArgs(process.argv.slice(2));
const browsers = (args.browsers ?? 'chromium,webkit,firefox').split(',');
const [heavy] = CPU_CASES;
// the tables switched under the notes: osc 2 to another table of 256 frames (no buffer of the pool of the store
// holds it yet: it is allocated on the audio thread, in chunks), then osc 1 to the 11 frames of the saws
const AIR = 'ESW Core Tables/Digital/ESW Digital - Air Lazer.wav';
const keys = [...Object.values(TABLES), AIR];
const tablePath = (key) => [...key.split('/').slice(0, -1), key];
const withTables = (osc1, osc2) => ({
  ...heavy.snapshot,
  osc1: { ...heavy.snapshot.osc1, ...(osc1 && { p: tablePath(osc1) }) },
  osc2: { ...heavy.snapshot.osc2, p: tablePath(osc2) },
});
const withoutEffects = {
  ...heavy.snapshot,
  fx: Object.fromEntries(
    Object.entries(heavy.snapshot.fx).map(([key, value]) => [
      key,
      key === 'o' ? value : { ...value, a: false },
    ])
  ),
};

await downloadTables(keys);
await buildSite();
const { server, port } = await serve({ keys });
// the worklet bundles the pages ask for, seen by the server (Chromium shows no worklet module to Playwright)
let served = [];
server.on('request', (request) => {
  const bundle = /\/assets\/worklets\/([^/?]+)\.js/.exec(request.url)?.[1];
  if (bundle) served.push(bundle);
});
const playwright = loadPlaywright();
let failed = false;
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
  if (!ok) failed = true;
};

try {
  for (const name of browsers) {
    console.log(name);
    // (Chromium on a fake output: the checks need no device)
    const { browser } = await launch(playwright, name, { headless: true, fakeOutput: true });
    const origin = `http://localhost:${port}/`;
    let session;
    served = [];
    try {
      session = await openPage(browser, origin);
      const { call, page, errors } = session;
      await call('apply', withoutEffects, 60000);
      await call(
        'run',
        heavy.notes.map((note) => ({ at: 0, note, on: true }))
      );
      await sleep(1500);
      const addEffects = async () => {
        await sleep(300);
        await call('apply', heavy.snapshot, 60000);
        await sleep(1000);
      };
      const switchTables = async () => {
        await call('apply', withTables(null, AIR), 60000);
        await sleep(500);
        await call('apply', withTables(TABLES.saws, AIR), 60000);
        await sleep(1000);
      };
      // in Chromium no render quantum over its deadline in a trace of it, nor a glitch, and with `messages` no
      // message the worklet thread takes between the quanta longer than that (the chunks of a table go to the
      // store so: a begin that zeroed the table held the thread 4.2 ms, no quantum showed it); the others only
      // play it
      const dropsNothing = async (title, play, { messages = false } = {}) => {
        if (name !== 'chromium') {
          await play();
          return;
        }
        await browser.startTracing(page, { categories: messages ? MESSAGE_CATEGORIES : QUANTA_CATEGORIES });
        await play();
        const events = JSON.parse(String(await browser.stopTracing())).traceEvents;
        const sampleRate = await page.evaluate(
          () => window.__waveformPerf.models.synthCore[0].audioCtx.sampleRate
        );
        const quanta = analyzeQuanta(events, { sampleRate });
        const glitches = countGlitches(events);
        const handled = messages ? analyzeMessages(events) : null;
        if (!quanta || (messages && !handled)) {
          check(title, false, `no ${quanta ? 'messages' : 'render quanta'} in the trace`);
          return;
        }
        const over = `${quanta.over} of ${quanta.count} quanta over ${quanta.deadline.toFixed(2)} ms`;
        const longest = handled
          ? `, the longest of ${handled.count} messages ${handled.max.toFixed(2)} ms`
          : '';
        check(
          title,
          quanta.over === 0 && glitches === 0 && (!handled || handled.max <= quanta.deadline),
          `${glitches} glitches, ${over}, the longest ${quanta.max.toFixed(2)} ms${longest}`
        );
      };
      await dropsNothing('the effects added over the notes drop nothing', addEffects);
      await dropsNothing('a table switched under the notes drops nothing', switchTables, { messages: true });
      const before = (await call('stats')).engine;
      // the loudness of the output over half a second (an analyser on the output of the limiter)
      const rms = await page.evaluate(async () => {
        const { audioCtx, output } = window.__waveformPerf.models.synthCore[0];
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 2048;
        output.connect(analyser);
        const data = new Float32Array(analyser.fftSize);
        let sum = 0;
        let count = 0;
        for (let i = 0; i < 10; i++) {
          await new Promise((resolve) => setTimeout(resolve, 50));
          analyser.getFloatTimeDomainData(data);
          data.forEach((value) => {
            sum += value * value;
            count++;
          });
        }
        output.disconnect(analyser);
        return Math.sqrt(sum / count);
      });
      await sleep(500);
      const after = (await call('stats')).engine;
      const statuses = await page.evaluate(() => {
        const { models } = window.__waveformPerf;
        return {
          wavetables: models.synthCore[0].wavetables.$status.value,
          limiter: models.synthCore[0].masterLimiter.$status.value,
          fx: models.fx[0].$status.value,
        };
      });
      const loaded = [...new Set(served)].sort();
      check('the oscillator is ready', statuses.wavetables === 'ready', statuses.wavetables);
      check('the master limiter is ready', statuses.limiter === 'ready', statuses.limiter);
      check(
        'every effect is ready',
        Object.values(statuses.fx).every((status) => status === 'ready'),
        JSON.stringify(statuses.fx)
      );
      const wanted = ['limiter', 'wavetable-osc', 'distortion', 'reverb'];
      check(
        'the bundles load',
        wanted.every((bundle) => loaded.includes(bundle)),
        loaded.join(', ')
      );
      check('the 12 notes play', after?.worklet.voices === 12, `${after?.worklet.voices} voices`);
      check(
        'the voices play from their mix tables',
        after && before && after.worklet.mixSamples > before.worklet.mixSamples,
        `${after?.worklet.mixSamples - before?.worklet.mixSamples} samples in 0.5 s`
      );
      check('the tables are in the store', after?.worklet.tables >= 2, `${after?.worklet.tables} tables`);
      check('the output sounds', rms > 0.01, `RMS ${rms.toFixed(3)}`);
      check('the page threw nothing', errors.length === 0, errors.join('; '));
    } catch (error) {
      check('the page runs', false, error.message.split('\n')[0]);
    } finally {
      await session?.context.close();
      await browser.close();
    }
  }
} finally {
  server.close();
}
process.exit(failed ? 1 : 0);
