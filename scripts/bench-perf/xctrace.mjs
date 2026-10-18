// Instruments from the command line: records the CPU (cycles: the CPU Profiler samples every 1M cycles of a
// core, so the clock of the core doesn't matter) and the memory of every process for some seconds, then reads
// the threads of the browser out of the trace
import { spawn } from 'child_process';
import fs from 'fs';
import { exec } from './util.mjs';

// the threads of each engine (names as Instruments shows them): the audio thread of the page (a reload starts
// a new one in the same process: the busiest counts), its main thread, the worker of the tables, the threads
// that deliver its output (the device callback in the page, CoreAudio's in the audio service / GPU process)
export const ENGINES = {
  chromium: {
    audio: /^Realtime AudioWorklet thread$|AudioWorklet/,
    main: /^(Main Thread|CrRendererMain)$/,
    worker: /^DedicatedWorker thread/,
    output: /^AudioOutputDevice$|^com\.apple\.audio\.IOThread\.client$|^AudioSession - RootQueue$/,
  },
  webkit: {
    audio: /^WebCore: AudioWorklet/,
    main: /^Main Thread$/,
    worker: /^WebCore: Worker/,
    output:
      /^RemoteAudioDestinationProxy render thread$|^com\.apple\.audio\.IOThread\.client$|^AudioSession - RootQueue$/,
  },
};

// processes that are Instruments itself or the system's, left out of the background load
const TOOLS = /^(xctrace|DTServiceHub|instruments|kernel(_task)?|WindowServer|node|notifyutil|sysmond)\b/i;

// records `seconds` of every process; `started` resolves when the recording has begun (xctrace notifies it about
// 1.5 s after the spawn, its time limit counts from there), or when it has ended if no notification came. The
// instruments without their template: a smaller trace (no hangs, logs, signposts), the same sampling
export const record = ({ output, seconds }) => {
  const name = `bench-perf.${process.pid}.${Date.now()}`;
  const notified = spawn('notifyutil', ['-1', name], { stdio: 'ignore' });
  const args = [
    'xctrace',
    'record',
    '--instrument',
    'CPU Profiler',
    '--instrument',
    'Activity Monitor',
    '--all-processes',
    '--time-limit',
    `${seconds}s`,
    '--no-prompt',
    '--notify-tracing-started',
    name,
    '--output',
    output,
  ];
  const child = spawn('xcrun', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', (data) => (log += data));
  child.stderr.on('data', (data) => (log += data));
  const done = new Promise((resolve, reject) =>
    child.on('exit', (code) => {
      notified.kill();
      if (code === 0 && fs.existsSync(output)) resolve();
      else reject(new Error(`xctrace failed (${code}): ${log.trim().split('\n').slice(-3).join(' | ')}`));
    })
  );
  const started = Promise.race([
    new Promise((resolve) => notified.on('exit', resolve)),
    done.catch(() => undefined),
  ]);
  return { started, done, stop: () => child.kill('SIGINT') };
};

// --- reading a trace ---

const decode = (text) =>
  text.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);/gi, (_, entity) => {
    if (entity[0] === '#')
      return String.fromCodePoint(
        entity[1] === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1))
      );
    return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[entity];
  });
const attributes = (source) => {
  const result = {};
  for (const [, key, double, single] of source.matchAll(/([\w:-]+)=(?:"([^"]*)"|'([^']*)')/g))
    result[key] = decode(double ?? single);
  return result;
};

export const readToc = async (trace) => {
  const toc = await exec('xcrun', ['xctrace', 'export', '--input', trace, '--toc']);
  const duration = Number(toc.match(/<duration>([\d.]+)<\/duration>/)?.[1] ?? NaN);
  const processes = new Map();
  for (const [, source] of toc.matchAll(/<process\s([^>]*?)\/?>/g)) {
    const { name, pid, path } = attributes(source);
    if (pid !== undefined) processes.set(Number(pid), { name, path: path ?? '' });
  }
  const schemas = [...toc.matchAll(/<table\s([^>]*?)\/?>/g)].map(([, source]) => attributes(source));
  return { duration, processes, schemas };
};

// the rows of tables of a trace, by schema, one export each (an export of several tables writes the columns of
// the first one only), the exports at once (each xctrace takes ~2 s to start: 3.9 s for 3 instead of 8.9 s);
// a table the trace hasn't gives no rows. Instruments writes a value once (id) and refers to it after (ref);
// the stacks (backtraces) are cut off, the JIT frames have no symbols anyway
export const exportTables = async (trace, schemas) => {
  const exportTable = async (schema) => {
    const xpath = `/trace-toc/run[@number="1"]/data/table[@schema="${schema}"]`;
    const xml = await exec('xcrun', ['xctrace', 'export', '--input', trace, '--xpath', xpath]);
    const columns = [
      ...xml.matchAll(
        /<col>[\s\S]*?<mnemonic>(.*?)<\/mnemonic>[\s\S]*?<engineering-type>(.*?)<\/engineering-type>[\s\S]*?<\/col>/g
      ),
    ].map(([, mnemonic, type]) => ({ mnemonic, type }));
    const registry = new Map();
    const rows = [];
    let at = xml.indexOf('<row>');
    while (at >= 0) {
      const end = xml.indexOf('</row>', at);
      let body = xml.slice(at + 5, end);
      const stack = body.search(/<(tagged-)?backtrace[\s>]/);
      if (stack >= 0) body = body.slice(0, stack);
      rows.push(parseCells(body, registry));
      at = xml.indexOf('<row>', end);
    }
    return [schema, { columns, rows }];
  };
  return Object.fromEntries(await Promise.all(schemas.map(exportTable)));
};

const TOKEN = /<(\/?)([\w-]+)((?:\s+[\w:-]+=(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
// the cells of a row: its child elements (a ref is the element it refers to, <sentinel/> is no value)
const parseCells = (body, registry) => {
  const top = { children: [] };
  const stack = [top];
  for (const [, closing, tag, source, selfClosing, text] of body.matchAll(TOKEN)) {
    const parent = stack[stack.length - 1];
    if (text !== undefined) {
      if (parent !== top) parent.text = (parent.text ?? '') + decode(text);
      continue;
    }
    if (closing) {
      stack.pop();
      continue;
    }
    const attrs = attributes(source);
    if (attrs.ref !== undefined) {
      parent.children.push(registry.get(attrs.ref) ?? null);
      if (!selfClosing) stack.push({ children: [] });
      continue;
    }
    const node = tag === 'sentinel' ? null : { tag, attrs, text: undefined, children: [] };
    parent.children.push(node);
    if (node && attrs.id !== undefined) registry.set(attrs.id, node);
    if (!selfClosing) stack.push(node ?? { children: [] });
  }
  return top.children;
};

const child = (node, tag) => node?.children.find((item) => item?.tag === tag) ?? null;
const number = (node) => (node?.text === undefined ? NaN : Number(node.text));

// a thread cell: "Name (0x1e258cc) (Process, pid: 123)"
const thread = (node) => {
  const fmt = node?.attrs.fmt ?? '';
  const name = fmt.match(/^(.*?) \(0x[0-9a-f]+\)/i)?.[1] ?? fmt;
  const process = child(node, 'process');
  const pid = number(child(process, 'pid')) || Number(fmt.match(/pid: (\d+)\)\s*$/)?.[1]);
  const tid = child(node, 'tid')?.attrs.fmt ?? fmt.match(/\((0x[0-9a-f]+)\)/i)?.[1] ?? '';
  return { name, pid, tid, key: `${pid}/${tid}/${name}` };
};
const coreType = (node) => node?.attrs.fmt?.match(/\((\w) Core\)/)?.[1] ?? '?';

// what a run costs, from its trace: the busiest thread matching the audio thread of the engine in an owned
// process is the page; rates over the span of the samples (Mcps: millions of cycles per second)
export const analyzeTrace = async (trace, { engine, owns = () => true }) => {
  // the table of contents and the tables at once
  const [toc, tables] = await Promise.all([
    readToc(trace),
    exportTables(trace, ['cpu-profile', 'activity-monitor-process-live']),
  ]);
  const pmi = toc.schemas.find(({ schema }) => schema === 'cpu-profile');
  if (!pmi) throw new Error('the trace has no CPU Profiler table');
  if (pmi['pmi-event'] && !/CYCLE/i.test(pmi['pmi-event']))
    throw new Error(`the CPU Profiler samples ${pmi['pmi-event']}, not cycles`);
  const { columns, rows } = tables['cpu-profile'] ?? { columns: [], rows: [] };
  const index = (name) => columns.findIndex(({ mnemonic }) => mnemonic === name);
  const [iTime, iThread, iCore, iWeight] = ['time', 'thread', 'core', 'weight'].map(index);

  const threads = new Map();
  let first = Infinity;
  let last = -Infinity;
  for (const cells of rows) {
    const time = number(cells[iTime]);
    if (Number.isFinite(time)) {
      first = Math.min(first, time);
      last = Math.max(last, time);
    }
    const info = thread(cells[iThread]);
    const weight = number(cells[iWeight]);
    if (!Number.isFinite(weight)) continue;
    const entry = threads.get(info.key) ?? { ...info, weight: 0, cores: {} };
    entry.weight += weight;
    const type = coreType(cells[iCore]);
    entry.cores[type] = (entry.cores[type] ?? 0) + weight;
    threads.set(info.key, entry);
  }
  const window = (last - first) / 1e9;
  // cycles → millions per second
  const rate = (weight) => (window > 0 ? weight / window / 1e6 : null);
  const processOf = (pid) => toc.processes.get(pid) ?? { name: '', path: '' };
  const owned = (pid) => owns({ pid, ...processOf(pid) });
  const all = [...threads.values()];
  const { audio, main, worker, output } = ENGINES[engine];

  const audioThreads = all.filter(({ name }) => audio.test(name)).sort((a, b) => b.weight - a.weight);
  const page = audioThreads.find(({ pid }) => owned(pid)) ?? null;
  const sum = (list) => list.reduce((total, { weight }) => total + weight, 0);
  const ofPage = (pattern) => all.filter((item) => page && item.pid === page.pid && pattern.test(item.name));
  const ownedThreads = all.filter(({ pid }) => owned(pid));
  const background = all.filter(({ pid }) => !owned(pid) && !TOOLS.test(processOf(pid).name ?? ''));

  // memory: the samples of the Activity Monitor (about one a second) of the page and of the owned processes
  const memory = tables['activity-monitor-process-live'] ?? { columns: [], rows: [] };
  const mIndex = (name) => memory.columns.findIndex(({ mnemonic }) => mnemonic === name);
  const [mProcess, mFootprint] = ['process', 'memory-physical-footprint'].map(mIndex);
  const footprints = new Map();
  for (const cells of memory.rows) {
    const pid = Number(cells[mProcess]?.attrs.fmt?.match(/\((\d+)\)\s*$/)?.[1]);
    const bytes = number(cells[mFootprint]);
    if (!Number.isFinite(pid) || !Number.isFinite(bytes)) continue;
    footprints.set(pid, [...(footprints.get(pid) ?? []), bytes]);
  }
  const mb = (bytes) => bytes / 2 ** 20;
  const pageMemory = page ? footprints.get(page.pid) ?? [] : [];
  const sorted = [...pageMemory].sort((a, b) => a - b);
  const ownedMemory = [...footprints]
    .filter(([pid]) => owned(pid))
    .map(([pid, values]) => [pid, values.at(-1)]);

  return {
    window,
    page: page && { pid: page.pid, process: processOf(page.pid).name, thread: page.name },
    audio: page ? rate(page.weight) : null,
    audioCores: page
      ? Object.fromEntries(Object.entries(page.cores).map(([type, weight]) => [type, weight / page.weight]))
      : {},
    main: page ? rate(sum(ofPage(main))) : null,
    worker: page ? rate(sum(ofPage(worker))) : null,
    pageTotal: page ? rate(sum(all.filter(({ pid }) => pid === page.pid))) : null,
    browserAudio: ownedThreads
      .filter((item) => item !== page && output.test(item.name) && !audio.test(item.name))
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 3)
      .map((item) => ({ thread: item.name, process: processOf(item.pid).name, rate: rate(item.weight) })),
    owned: rate(sum(ownedThreads)),
    // AudioWorklet threads of other pages or browsers (the Chrome of the user)
    otherAudio: audioThreads
      .filter((item) => item !== page && rate(item.weight) > 1)
      .map((item) => ({
        thread: item.name,
        process: processOf(item.pid).name,
        pid: item.pid,
        rate: rate(item.weight),
      })),
    background: rate(sum(background)),
    memory: page
      ? {
          steady: mb(sorted[Math.floor(sorted.length / 2)] ?? NaN),
          peak: mb(sorted.at(-1) ?? NaN),
          first: mb(pageMemory[0] ?? NaN),
          last: mb(pageMemory.at(-1) ?? NaN),
          owned: mb(ownedMemory.reduce((total, [, bytes]) => total + (bytes ?? 0), 0)),
        }
      : null,
  };
};
