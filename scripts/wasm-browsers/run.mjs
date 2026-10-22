// the parity of the wasm cores in the browsers (manual, as bench-osc: `npx -y -p playwright@1.50.1 node
// scripts/wasm-browsers/run.mjs [--browsers=chromium,webkit,firefox] [--only=<scene>]`, after `npm run wasm` and
// `npm run worklets`): every scene renders in an OfflineAudioContext with the worklet bundle of the app and in Node
// with its wasm core alone (tmp/wasm); the worklet must give the bits of Node in every browser (jsmath: the same
// Math everywhere). The params go only through processorOptions (a message would arrive in an unpredictable block):
// the voices of the oscillator in the events of their node, their params at the note on and the steps of the gate
// worked out by the timelines of the core (in Node: the arrays of each block).
// Exit 1 when a render differs
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { loadPlaywright, parseArgs, root } from '../bench-common.mjs';
import { nodeRender, SCENES, sceneLevels } from './scenes.mjs';

const args = parseArgs(process.argv.slice(2));
const browsers = (args.browsers ?? 'chromium,webkit,firefox').split(',');
const scenes = SCENES.filter(({ name }) => !args.only || name.includes(args.only));
const worklets = path.join(root, 'tmp/worklets');
if (!fs.existsSync(path.join(worklets, 'limiter.js')))
  throw new Error('tmp/worklets has no bundles: run `npm run wasm && npm run worklets` first');

// the worklet bundles and an empty page on localhost (a secure context: AudioWorklet)
const server = http.createServer((request, response) => {
  const file = path.join(worklets, path.basename(new URL(request.url, 'http://localhost').pathname));
  if (request.url === '/' || !fs.existsSync(file)) {
    response.writeHead(request.url === '/' ? 200 : 404, { 'content-type': 'text/html' });
    response.end('<!doctype html><title>wasm parity</title>');
    return;
  }
  response.writeHead(200, { 'content-type': 'text/javascript' });
  response.end(fs.readFileSync(file));
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

const toBase64 = (data) => Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('base64');
const fromBase64 = (text) => {
  const bytes = Buffer.from(text, 'base64');
  return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
};

// renders a scene in the page: the input (base64 channels) through the processor into the destination
const renderInPage = (page, { bundle, processor, options, rate, input }) =>
  page.evaluate(
    async ({ bundle, processor, options, rate, input }) => {
      const decode = (text) => {
        const binary = atob(text);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return new Float32Array(bytes.buffer);
      };
      const encode = (data) => {
        const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
        let binary = '';
        for (let i = 0; i < bytes.length; i += 0x8000)
          binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        return btoa(binary);
      };
      const channels = input.map(decode);
      const context = new OfflineAudioContext(2, channels[0].length, rate);
      await context.audioWorklet.addModule(`/${bundle}.js`);
      const node = new AudioWorkletNode(context, processor, options);
      const buffer = context.createBuffer(2, channels[0].length, rate);
      channels.forEach((data, channel) => buffer.copyToChannel(data, channel));
      const source = new AudioBufferSourceNode(context, { buffer });
      source.connect(node).connect(context.destination);
      source.start(0);
      const rendered = await context.startRendering();
      return [0, 1].map((channel) => encode(rendered.getChannelData(channel)));
    },
    { bundle, processor, options, rate, input }
  );

// renders an oscillator scene in the page: the store node gets the tables (the page waits for their acks), the
// voices node every voice of the scene from the events of its options (each voice, its params at the note on, the
// steps of its gate), each voice into a pair of channels of its own (a tap) split into the destination
const renderOscInPage = (page, { bundle, rate, frames, tables, voices }) =>
  page.evaluate(
    async ({ bundle, rate, frames, tables, voices }) => {
      const decode = (text) => {
        const binary = atob(text);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return new Float32Array(bytes.buffer);
      };
      const encode = (data) => {
        const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
        let binary = '';
        for (let i = 0; i < bytes.length; i += 0x8000)
          binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        return btoa(binary);
      };
      const channels = 2 * voices.length;
      const context = new OfflineAudioContext(channels, frames, rate);
      await context.audioWorklet.addModule(`/${bundle}.js`);
      const store = new AudioWorkletNode(context, 'waveform-wavetable-store', {
        numberOfInputs: 0,
        numberOfOutputs: 1,
      });
      await new Promise((resolve) => {
        let waiting = tables.length;
        store.port.onmessage = ({ data }) => {
          if (data.stored && --waiting === 0) resolve();
        };
        tables.forEach(({ table, frames: count, harmonics, lengths, offsets, data }) =>
          store.port.postMessage({
            table,
            version: 1,
            levels: {
              frames: count,
              harmonics: Int32Array.from(harmonics),
              lengths: Int32Array.from(lengths),
              offsets: Int32Array.from(offsets),
              data: decode(data),
            },
          })
        );
      });
      const events = voices.flatMap(({ options, params, gate }, voice) => [
        { kind: 'on', voice, options, params },
        ...gate.map(([frame, value]) => ({ kind: 'set', voice, param: 'gate', value, time: frame / rate })),
      ]);
      const node = new AudioWorkletNode(context, 'waveform-wavetable-voices', {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [channels],
        processorOptions: { events, tap: true },
      });
      const split = context.createChannelSplitter(channels);
      const merger = context.createChannelMerger(channels);
      node.connect(split);
      for (let channel = 0; channel < channels; channel++) split.connect(merger, channel, channel);
      merger.connect(context.destination);
      const rendered = await context.startRendering();
      return Array.from({ length: rendered.numberOfChannels }, (_, channel) =>
        encode(rendered.getChannelData(channel))
      );
    },
    { bundle, rate, frames, tables, voices }
  );

const differences = (a, b) => {
  const ua = new Uint32Array(a.buffer, a.byteOffset, a.length);
  const ub = new Uint32Array(b.buffer, b.byteOffset, b.length);
  let count = 0;
  let first = -1;
  for (let i = 0; i < Math.min(ua.length, ub.length); i++)
    if (ua[i] !== ub[i]) {
      count++;
      if (first < 0) first = i;
    }
  return { count, first };
};

const { chromium, webkit, firefox } = loadPlaywright();
const engines = { chromium, webkit, firefox };
let failed = false;
const rows = [];
try {
  for (const name of browsers) {
    const browser = await engines[name].launch();
    const page = await browser.newPage();
    await page.goto(origin);
    for (const scene of scenes) {
      const { input, output } = await nodeRender(scene);
      const encoded = input?.map(toBase64);
      const tables =
        scene.kind === 'osc' &&
        Object.entries(await sceneLevels(scene)).map(
          ([table, { frames, harmonics, lengths, offsets, data }]) => ({
            table,
            frames,
            harmonics: [...harmonics],
            lengths: [...lengths],
            offsets: [...offsets],
            data: toBase64(data),
          })
        );
      {
        const bundle = scene.module;
        let result;
        try {
          const rendered = await (scene.kind === 'osc'
            ? renderOscInPage(page, { ...scene, bundle, tables })
            : renderInPage(page, { ...scene, bundle, input: encoded }));
          const channels = rendered.map(fromBase64);
          const found = channels.map((data, channel) => differences(data, output[channel]));
          const first = found.find((item) => item.first >= 0)?.first ?? -1;
          result = { count: found.reduce((sum, item) => sum + item.count, 0), first };
        } catch (error) {
          result = { error: error.message.split('\n')[0] };
        }
        if (result.error || result.count > 0) failed = true;
        rows.push({ browser: name, scene: scene.name, ...result });
        console.log(
          `${name.padEnd(9)} ${scene.name.padEnd(36)} ${
            result.error
              ? `error: ${result.error}`
              : `${result.count} samples differ${result.count ? ` (first ${result.first})` : ''}`
          }`
        );
      }
    }
    await browser.close();
  }
} finally {
  server.close();
}
fs.mkdirSync(path.join(root, 'tmp/wasm-browsers'), { recursive: true });
fs.writeFileSync(path.join(root, 'tmp/wasm-browsers/report.json'), JSON.stringify(rows, null, 2));
if (failed) {
  console.error('a worklet differs from its core in Node');
  process.exit(1);
}
console.log('every worklet renders the bits of its core in Node');
