// the verdicts of the perf suite (README: statuses), pure: is a case of an A/B run slower than its reference — a
// difference the runs (or the notes) of the same session tell apart, Mann–Whitney, and larger than a practical
// threshold —, has it drifted from the baseline of another session, the conditions a baseline was taken under,
// the merge of a run into the baseline
import { median } from './util.mjs';

// --- Mann–Whitney U, one-sided: are the values of `current` larger than those of `base`? ---

// the ranks of the pooled values, ties at their mean rank (1-based), and the sizes of the groups of ties
const rank = (values) => {
  const order = values.map((value, index) => [value, index]).sort((a, b) => a[0] - b[0]);
  const ranks = new Array(values.length);
  const ties = [];
  for (let start = 0; start < order.length; ) {
    let end = start;
    while (end + 1 < order.length && order[end + 1][0] === order[start][0]) end++;
    for (let i = start; i <= end; i++) ranks[order[i][1]] = (start + end) / 2 + 1;
    if (end > start) ties.push(end - start + 1);
    start = end + 1;
  }
  return { ranks, ties };
};

// the standard normal distribution (Abramowitz and Stegun 7.1.26, error under 1.5e-7)
const normalCdf = (z) => {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const erf =
    1 -
    t *
      (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429)))) *
      Math.exp(-x * x);
  return z >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
};

// both groups this small or smaller: the exact distribution of the rank sum
const EXACT = 10;

// p of a rank sum of `current` this large or larger if both groups came from one distribution: exact (every
// way to pick n1 of the pooled ranks, ties at their mean ranks: counted on twice the ranks, integers) for small
// groups, else the normal approximation with the correction for ties and for continuity
export const mannWhitney = (current, base) => {
  const a = current.filter(Number.isFinite);
  const b = base.filter(Number.isFinite);
  const n1 = a.length;
  const n2 = b.length;
  if (!n1 || !n2) return { u: null, p: null };
  const { ranks, ties } = rank([...a, ...b]);
  const sum = ranks.slice(0, n1).reduce((total, value) => total + value, 0);
  const u = sum - (n1 * (n1 + 1)) / 2;
  if (n1 <= EXACT && n2 <= EXACT) {
    // ways[k][s]: the subsets of k of the ranks seen so far whose doubled ranks sum to s
    const doubled = ranks.map((value) => Math.round(2 * value));
    const total = doubled.reduce((all, value) => all + value, 0);
    let ways = Array.from({ length: n1 + 1 }, () => new Float64Array(total + 1));
    ways[0][0] = 1;
    for (const value of doubled) {
      const next = ways.map((row) => row.slice());
      for (let k = 1; k <= n1; k++) for (let s = value; s <= total; s++) next[k][s] += ways[k - 1][s - value];
      ways = next;
    }
    const observed = Math.round(2 * sum);
    let atLeast = 0;
    let all = 0;
    ways[n1].forEach((count, s) => {
      all += count;
      if (s >= observed) atLeast += count;
    });
    return { u, p: atLeast / all };
  }
  const n = n1 + n2;
  const correction = ties.reduce((total, t) => total + t ** 3 - t, 0) / (n * (n - 1));
  const sd = Math.sqrt(((n1 * n2) / 12) * (n + 1 - correction));
  if (sd === 0) return { u, p: 1 };
  const z = (u - (n1 * n2) / 2 - 0.5) / sd;
  return { u, p: 1 - normalCdf(z) };
};

// --- a regression ---

// a case of an A/B run slower than its reference (the same cases of the reference commit, run alternating in the
// same session): the runs tell the difference apart (p under `alpha`) and its median moved by more than the
// thresholds (`rel` of the reference's median and `abs` in the unit); a fail (a warning: `warnOnly`), null
// otherwise. Fewer values than `min` on a side is a warning: a check that can't run isn't a pass
export const regression = (
  current,
  reference,
  { metric, unit: name = '', alpha, rel = 0, abs = 0, min, warnOnly = false }
) => {
  const unit = name ? ` ${name}` : '';
  const now = current.filter(Number.isFinite);
  const before = reference.filter(Number.isFinite);
  if (now.length < min || before.length < min)
    return {
      level: 'warn',
      message: `${metric}: too few values to compare (${now.length} now, ${before.length} of the reference, ${min} needed)`,
    };
  const m1 = median(now);
  const m0 = median(before);
  const shift = m1 - m0;
  const relative = m0 > 0 ? shift / m0 : Infinity;
  const { p } = mannWhitney(now, before);
  if (!(p < alpha && shift > abs && relative > rel)) return null;
  const message =
    `${metric} median ${m1.toFixed(2)}${unit} (reference ${m0.toFixed(2)}, +${shift.toFixed(2)}${unit}` +
    `${m0 > 0 ? `, +${(relative * 100).toFixed(1)}%` : ''}, p ${p.toPrecision(2)})`;
  return { level: warnOnly ? 'warn' : 'fail', message };
};

// the drift of a case from the baseline of another session: its median moved by more than `rel` and `abs` (a
// session drifts by up to a tenth: the runs within one tell the sessions apart, not the code, so no test: a
// warning, an A/B run tells), a message, else null; null without values
export const drift = (current, base, { metric, unit: name = '', rel = 0, abs = 0 }) => {
  const unit = name ? ` ${name}` : '';
  const m1 = median(current.filter(Number.isFinite));
  const m0 = median(base.filter(Number.isFinite));
  if (m1 === null || m0 === null) return null;
  const shift = m1 - m0;
  const relative = m0 > 0 ? shift / m0 : Infinity;
  if (!(shift > abs && relative > rel)) return null;
  return (
    `${metric} median ${m1.toFixed(2)}${unit}, ${m0.toFixed(2)} in the baseline (+${shift.toFixed(
      2
    )}${unit}` +
    `${
      m0 > 0 ? `, +${(relative * 100).toFixed(1)}%` : ''
    }): drift or a regression, an A/B run (--against) tells`
  );
};

// --- the conditions of a baseline ---

// updates within a macOS release (26.6.x) don't count
const release = (os) => (os ? String(os).split('.').slice(0, 2).join('.') : null);

// what the numbers of a browser depend on besides the code, a baseline keeps them: the macOS release, the output
// (its transport and its rate: at another rate the browser resamples the cases; its name only tells which, the
// speakers and the headphones of a Mac are one device). A condition unknown on either side (system_profiler gave
// nothing) is unknown, not changed: `unknown` lists them, `changes` those that differ
export const conditionChanges = (now, base) => {
  const changes = [];
  const unknown = [];
  const compare = (name, current, before, describe = (value) => value) => {
    if (current === null || current === undefined || before === null || before === undefined)
      unknown.push(name);
    else if (current !== before)
      changes.push(`${name} ${describe(before)} in the baseline, ${describe(current)} now`);
  };
  compare('macOS', release(now.os), release(base.os));
  compare('output transport', now.output?.transport, base.output?.transport);
  compare('output rate', now.output?.rate, base.output?.rate, (rate) => `${rate} Hz`);
  return { changes, unknown };
};

// --- the baseline ---

// the mode of a browser in the baseline after a run: its measured cases, and the kept ones it didn't measure
// (--only) as long as the browser version and the conditions are those of the baseline (unknown ones count as
// the same), else they are dropped (listed)
export const mergeMode = (before, { version, conditions, cases }) => {
  const comparable =
    before && before.version === version && !conditionChanges(conditions, before).changes.length;
  const kept = comparable ? before.cases : {};
  const merged = { ...kept, ...cases };
  const dropped = Object.keys(before?.cases ?? {}).filter((id) => !(id in merged));
  // a condition the run doesn't know keeps the baseline's
  const os = conditions.os ?? (comparable ? before.os : null) ?? null;
  const output = conditions.output ?? (comparable ? before.output : null) ?? null;
  return { mode: { version, os, output, cases: merged }, dropped };
};
