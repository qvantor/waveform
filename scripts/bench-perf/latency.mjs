// the latency cases (README: latency): notes through the keyboard of Playwright, timed by the test hook from
// the input event to the start of each voice and to the output of the device. In an A/B run (--against) the
// notes of both sides come in sessions of a fresh page each, alternating (A B B A …)
import { openPage } from './browser.mjs';
import { KEYS } from './scenes.mjs';
import { summarizeLatency } from './report.mjs';
import { loadApp, SCENE_RATE, sleep } from './util.mjs';

// after the last note: its voice posts its start a block or two later
const SETTLE = 400;
const PROBE_URL = '/perf/probe.js';
// the sessions of each side of an A/B run
const SESSIONS = 5;

// the parts of the latency of a note worked out in Node by the code of the working tree (latency.ts) from what
// the page recorded: one formula for both sides of an A/B run (a reference may compute them otherwise)
let latencyCode = null;
const noteLatency = async () => {
  latencyCode ??= loadApp({
    contents: "export { noteLatency } from './apps/waveform/src/app/perf/latency';",
    name: 'latency',
  });
  return (await latencyCode).noteLatency;
};

// `count` notes one after another on a fresh page, held for half the interval; the held notes and the probe
// around them
const session = async ({ launched, origin, kase, count }) => {
  const { context, page, call, errors } = await openPage(launched.browser, origin);
  try {
    await call('apply', kase.snapshot, 60000);
    if (kase.held)
      await call(
        'run',
        kase.held.map((note) => ({ at: 0, note, on: true }))
      );
    if (kase.probe) await call('probe.install', PROBE_URL);
    // the keys go to the page in front, focused
    await page.bringToFront();
    await page.mouse.click(8, 8);
    await call('trace.start');
    for (let i = 0; i < count; i++) {
      const [code] = KEYS[i % KEYS.length];
      const hold = kase.interval / 2;
      await page.keyboard.down(code);
      await sleep(hold);
      await page.keyboard.up(code);
      await sleep(kase.interval - hold);
    }
    await sleep(SETTLE);
    const trace = await call('trace.stop');
    await call('stopRuns');
    if (!trace.notes.length) throw new Error('no note reached the synth (the page lost the focus?)');
    const latency = await noteLatency();
    return {
      notes: trace.notes.map((note) => ({ ...note, ...latency(note, SCENE_RATE) })),
      errors,
    };
  } finally {
    await context.close();
  }
};

const extraOf = (notes) => ({
  note: notes.some(({ event }) => event?.estimated)
    ? 'events without time stamps: timed from their capture'
    : '',
});

// `origins`: of the working tree (current) and of the reference of an A/B run (reference, null without one)
export const runLatencyCase = async ({ launched, origins, kase }) => {
  const head = { id: kase.id, group: 'latency', title: kase.title };
  try {
    if (!origins.reference) {
      const { notes, errors } = await session({ launched, origin: origins.current, kase, count: kase.count });
      return { ...head, summary: summarizeLatency(notes), notes, extra: extraOf(notes), errors };
    }
    const count = Math.ceil(kase.count / SESSIONS);
    const sides = { current: [], reference: [] };
    const errors = [];
    for (let i = 0; i < SESSIONS; i++) {
      const order = i % 2 ? ['reference', 'current'] : ['current', 'reference'];
      for (const side of order) {
        const done = await session({ launched, origin: origins[side], kase, count });
        sides[side].push(...done.notes);
        errors.push(...done.errors);
      }
    }
    return {
      ...head,
      summary: summarizeLatency(sides.current),
      notes: sides.current,
      extra: extraOf(sides.current),
      errors,
      reference: { summary: summarizeLatency(sides.reference), notes: sides.reference },
    };
  } catch (error) {
    return { ...head, error: error.message };
  }
};
