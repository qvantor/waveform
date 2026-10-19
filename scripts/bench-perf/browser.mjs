// the browsers of a run (Playwright): a fresh context per run, nothing but localhost loads, the test hook of
// the perf build (window.__waveformPerf) driven from Node
import path from 'path';
import { SCENE_RATE, sleep } from './util.mjs';

// headed by default: the audio output of headless Chromium is muted (its callbacks and latency are not real);
// a headless Chromium is the same binary (channel 'chromium', not the headless shell): its processes are found
// by the same folder
export const launch = async (playwright, name, { headless = false } = {}) => {
  const options = { headless };
  if (name === 'chromium') {
    options.args = ['--autoplay-policy=no-user-gesture-required'];
    if (headless) options.channel = 'chromium';
  }
  const browser = await playwright[name].launch(options);
  // the processes of the browser are under its folder of the Playwright cache (ms-playwright/chromium-1155/…)
  const executable = playwright[name].executablePath();
  const parts = executable.split(path.sep);
  const at = parts.indexOf('ms-playwright');
  const folder = at >= 0 ? parts.slice(0, at + 2).join(path.sep) : path.dirname(executable);
  return {
    browser,
    name,
    version: browser.version(),
    owns: ({ path: file }) => Boolean(file?.startsWith(folder)),
  };
};

// runs in the page: a function of the hook ('trace.stop') with its arguments, its result; self-contained (Playwright
// sends it as source)
const callHook = ([name, args]) => {
  const api = window.__waveformPerf;
  if (!api) throw new Error('no test hook on the page: not a perf build (npm run build:perf)');
  const keys = name.split('.');
  const owner = keys.slice(0, -1).reduce((target, key) => target[key], api);
  return owner[keys.at(-1)](...args);
};

// calls a function of the hook in the page, its result
const hook =
  (page) =>
  (name, ...args) =>
    page.evaluate(callHook, [name, args]);

// a page of the app at the start of a run: the hook there, the audio running (a click: a user gesture), ready
export const openPage = async (
  browser,
  origin,
  { rate = SCENE_RATE, viewport = { width: 1440, height: 900 } } = {}
) => {
  const context = await browser.newContext({ viewport });
  await context.route('**/*', (route) => {
    const { hostname } = new URL(route.request().url());
    return hostname === 'localhost' || hostname === '127.0.0.1' ? route.continue() : route.abort();
  });
  if (rate)
    await context.addInitScript((sampleRate) => {
      const Original = window.AudioContext;
      window.AudioContext = class extends Original {
        constructor(options = {}) {
          super({ ...options, sampleRate });
        }
      };
    }, rate);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(origin);
  await page
    .waitForFunction(() => window.__waveformPerf, null, { timeout: 30000 })
    .catch(() => {
      throw new Error('no test hook on the page: not a perf build (npm run build:perf)');
    });
  const call = hook(page);
  await resume(page);
  await call('ready', 30000);
  // a browser that ignores the rate would run the scene at the rate of the output, unseen
  const sampleRate = await page.evaluate(() => window.__waveformPerf.models.synthCore[0].audioCtx.sampleRate);
  if (sampleRate !== rate) {
    await context.close();
    throw new Error(`the context runs at ${sampleRate} Hz, not ${rate}`);
  }
  return { context, page, call, errors };
};

// a click at a neutral spot (the logo) resumes the context; again until it runs
const resume = async (page) => {
  for (let attempt = 0; attempt < 10; attempt++) {
    await page.mouse.click(8, 8);
    const state = await page.evaluate(() => window.__waveformPerf.models.synthCore[0].audioCtx.state);
    if (state === 'running') return;
    await sleep(300);
  }
  throw new Error('the audio context does not run');
};
