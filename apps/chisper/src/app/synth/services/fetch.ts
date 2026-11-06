import { bucketUrl } from './buckets';

const checkOk = (url: string, res: Response) => {
  if (!res.ok) throw new Error(`${url} responded ${res.status}`);
  return res;
};

// a response that is ok, else an error with its url and status (the load fails, react-query retries it)
export const fetchOk = async (url: string) => checkOk(url, await fetch(url));

// the list a function answers as JSON; anything else is an error, as a status that isn't ok (a function that threw:
// Netlify's {errorType, errorMessage}), so a selector stays without options instead of mapping it
export const fetchList = async <T>(url: string): Promise<T[]> => {
  const data: unknown = await (await fetchOk(url)).json();
  if (!Array.isArray(data)) throw new Error(`${url} answered no list`);
  return data;
};

// how long a download may give no byte (a connection throttled on the way stalls rather than fails, a blackholed one
// hangs in its connect) and the bytes a second it has to give over every RATE_WINDOW_MS of its body (one throttled to
// a trickle never stalls). No deadline: a slow line shared by the loads of a start gives each little, and the other
// route, on the same line, would start again from the first byte; the files are at most 2 MB, so a download above
// its rate ends
type Limits = { stallMs: number; minRate: number };

// the windows the rate of a download is measured over, one after another from its response
export const RATE_WINDOW_MS = 10_000;

// the first route of a file: the other one is tried soon (2 MB in 8.5 min at most)
export const FIRST_LIMITS: Limits = { stallMs: 4000, minRate: 4096 };
// the other one: nothing comes after it, its limits only end a hang (the model loads it again), so a slow answer of
// the site still comes
export const SECOND_LIMITS: Limits = { stallMs: 15_000, minRate: 1024 };

const concat = (chunks: Uint8Array[], length: number) => {
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes.buffer;
};

// the bytes of an ok response within its limits, else the request aborted (`signal` aborts it too, with its
// reason); aborted once done too: a response not read to its end (a status that isn't ok) lets its connection go
const downloadWithin = async (
  url: string,
  { stallMs, minRate }: Limits,
  signal?: AbortSignal
): Promise<ArrayBuffer> => {
  const controller = new AbortController();
  let fail!: (error: unknown) => void;
  const stopped = new Promise<never>((_, reject) => (fail = reject));
  stopped.catch(() => undefined);
  const stop = (error: unknown) => {
    fail(error);
    controller.abort(error);
  };
  const stalled = () => stop(new Error(`${url} gave nothing for ${stallMs} ms`));
  const aborted = () => stop(signal?.reason);
  signal?.addEventListener('abort', aborted, { once: true });
  let stall: ReturnType<typeof setTimeout> | undefined;
  const arm = () => {
    clearTimeout(stall);
    stall = setTimeout(stalled, stallMs);
  };
  arm();
  try {
    const res = checkOk(url, await Promise.race([fetch(url, { signal: controller.signal }), stopped]));
    arm();
    if (!res.body) return await Promise.race([res.arrayBuffer(), stopped]);
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    // the window being measured: where it started and the bytes before it (a fast start buys no trickle after it)
    let windowStart = performance.now();
    let windowFrom = 0;
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), stopped]);
      if (done) return concat(chunks, length);
      chunks.push(value);
      length += value.length;
      const elapsed = performance.now() - windowStart;
      if (elapsed >= RATE_WINDOW_MS) {
        if (length - windowFrom < (minRate * elapsed) / 1000)
          throw new Error(`${url} gave under ${minRate} B/s`);
        windowStart += elapsed;
        windowFrom = length;
      }
      arm();
    }
  } finally {
    clearTimeout(stall);
    signal?.removeEventListener('abort', aborted);
    controller.abort();
  }
};

// the files of a bucket by their keys: from its domain, else through the site (`proxy`, the rewrites of
// netlify.toml), where the domain doesn't load (Cloudflare throttled or blocked on the way: the page and the lists
// come from Netlify all the same). The route that served what the other didn't goes first for the session, with
// FIRST_LIMITS; the other one with SECOND_LIMITS: every load ends (a hung one would stay in the caches of the
// files). `parse` is part of a load: a block page answered 200 isn't the file. Both failing, the error of the second.
// `signal` aborts a load (no one waits for it any more): its request with its reason, no other route, the order kept
export const bucketLoader = (origin: string, proxy: string) => {
  let routes = [origin, proxy];
  return async <T>(key: string, parse: (bytes: ArrayBuffer) => T, signal?: AbortSignal): Promise<T> => {
    if (signal?.aborted) throw signal.reason;
    const [first, second] = routes;
    try {
      return parse(await downloadWithin(bucketUrl(first, key), FIRST_LIMITS, signal));
    } catch (error) {
      if (signal?.aborted) throw error;
      console.warn(`${key} didn't load from ${first}, trying ${second}`, error);
      const result = parse(await downloadWithin(bucketUrl(second, key), SECOND_LIMITS, signal));
      routes = [second, first];
      return result;
    }
  };
};
