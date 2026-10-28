// the render quanta and the dropouts of Chromium from its trace (CDP tracing through Playwright); WebKit has no
// such trace
import { mean, percentile } from './util.mjs';

// while Instruments records: `audio` alone puts nothing on the worklet thread but the glitches (`audio,webaudio`
// costs it about 3% of its cycles, every audio category 20%)
export const GLITCH_CATEGORIES = ['audio'];
// a window of its own after the recording: the render of each quantum
export const QUANTA_CATEGORIES = ['audio', 'webaudio'];
// one per render quantum of 128 frames on the Realtime AudioWorklet thread (dur: wall µs, tdur: CPU µs)
const RENDER_EVENT = 'RealtimeAudioDestinationHandler::Render';
// one per missed device callback, on the AudioOutputDevice thread (a few copies on the worklet thread: not
// counted)
const GLITCH_EVENT = 'Glitch!';
// the quanta and the tasks of the messages the worklet thread takes between them (a port message holds the thread
// as long as its handler runs: the next render waits, its own time doesn't show it)
export const MESSAGE_CATEGORIES = [...QUANTA_CATEGORIES, 'toplevel'];
// one per message (mojo) the worklet thread handles: a postMessage to a processor
const MESSAGE_EVENT = 'SimpleWatcher::OnHandleReady';

const threadNames = (events) => {
  const names = new Map();
  for (const event of events)
    if (event.ph === 'M' && event.name === 'thread_name')
      names.set(`${event.pid}/${event.tid}`, event.args?.name ?? '');
  return names;
};

// the complete events of each name on each thread: wall and CPU durations (µs), their span
const durations = (events) => {
  const names = threadNames(events);
  const byName = new Map();
  for (const event of events) {
    if (event.ph !== 'X' || !Number.isFinite(event.dur)) continue;
    const thread = names.get(`${event.pid}/${event.tid}`) ?? '';
    const key = `${thread}\u0000${event.name}`;
    const entry = byName.get(key) ?? {
      thread,
      name: event.name,
      category: event.cat,
      durations: [],
      cpu: [],
      first: event.ts,
      last: event.ts,
    };
    entry.durations.push(event.dur);
    if (Number.isFinite(event.tdur)) entry.cpu.push(event.tdur);
    entry.first = Math.min(entry.first, event.ts);
    entry.last = Math.max(entry.last, event.ts);
    byName.set(key, entry);
  }
  return [...byName.values()];
};

// the render time of the quanta against their deadline (128 / rate): the pinned event, or (renamed by a newer
// Chromium) the longest event on the worklet thread at about rate / 128 a second
export const analyzeQuanta = (events, { sampleRate }) => {
  const perSecond = sampleRate / 128;
  const worklet = durations(events).filter(({ thread }) => /AudioWorklet/i.test(thread));
  const pinned = worklet.find(({ name }) => name === RENDER_EVENT);
  const found =
    pinned ??
    worklet
      .filter(({ durations: list, first, last }) => {
        const seconds = (last - first) / 1e6;
        const rate = seconds > 0 ? list.length / seconds : 0;
        return rate > perSecond * 0.8 && rate < perSecond * 1.2;
      })
      .sort((a, b) => mean(b.durations) - mean(a.durations))[0];
  if (!found) return null;
  const wall = [...found.durations].sort((a, b) => a - b).map((us) => us / 1000);
  const cpu = [...found.cpu].sort((a, b) => a - b).map((us) => us / 1000);
  const deadline = (128 / sampleRate) * 1000;
  return {
    event: `${found.category} ${found.name}${pinned ? '' : ' (found by its rate: pin it, see --dump-trace)'}`,
    count: wall.length,
    p50: percentile(wall, 50),
    p99: percentile(wall, 99),
    max: wall.at(-1),
    cpuP99: percentile(cpu, 99),
    deadline,
    over: wall.filter((ms) => ms > deadline).length,
  };
};

// the messages the worklet thread handled (MESSAGE_CATEGORIES), wall ms: their count and the longest; null without
// them in the trace (a newer Chromium renamed it: --dump-trace)
export const analyzeMessages = (events) => {
  const found = durations(events).find(
    ({ thread, name }) => /AudioWorklet/i.test(thread) && name === MESSAGE_EVENT
  );
  return found ? { count: found.durations.length, max: Math.max(...found.durations) / 1000 } : null;
};

// the device callbacks Chromium missed (a dropout each)
export const countGlitches = (events) => {
  const names = threadNames(events);
  return events.filter(
    (event) => event.name === GLITCH_EVENT && names.get(`${event.pid}/${event.tid}`) === 'AudioOutputDevice'
  ).length;
};

// the rendering of the page on the main thread of its renderer: its animation frames, its style, layout and paint
export const PAINT_CATEGORIES = ['devtools.timeline', 'disabled-by-default-devtools.timeline'];

// the animation frames of the page (its requestAnimationFrame callbacks) and how many times it was restyled, laid
// out and painted meanwhile (what moves every frame draws on canvases: none of them)
export const analyzePaints = (events) => {
  const counts = { frames: 0, UpdateLayoutTree: 0, Layout: 0, Paint: 0 };
  for (const { thread, name, durations: each } of durations(events)) {
    if (thread !== 'CrRendererMain') continue;
    if (name === 'FireAnimationFrame') counts.frames = each.length;
    else if (name in counts) counts[name] = each.length;
  }
  return counts;
};

// every event of a trace by thread and name (--dump-trace): to pin the names after a Chromium update
export const histogram = (events) => {
  const lines = [
    '| thread | category | name | count | mean µs | max µs |',
    '| --- | --- | --- | --- | --- | --- |',
  ];
  durations(events)
    .sort((a, b) => b.durations.length - a.durations.length)
    .slice(0, 80)
    .forEach(({ thread, category, name, durations: list }) =>
      lines.push(
        `| ${thread} | ${category} | ${name} | ${list.length} | ${mean(list).toFixed(1)} | ${Math.max(
          ...list
        ).toFixed(1)} |`
      )
    );
  return lines.join('\n');
};
