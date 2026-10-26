# Performance suite

What only a real browser on a real machine tells: the cycles of the audio thread of the synth under the heavy
patch, the memory of its page, the latency from a key to its sound — in Chromium (WebKit on request). A
regression is checked by an A/B run: the code of a reference commit and the working tree alternate in one
session (`--against=<ref>`); a baseline of the machine only warns of drift. A manual check on macOS, not part of
CI. Everything that can be computed without a browser (the latency of the chain, the work of the voices and the
effects, the main-thread work of a note, the memory of the tables, leaks) is in the Jest specs and runs in CI:
see [What moved to the specs](#what-moved-to-the-specs).

```sh
npx -y -p playwright@1.50.1 node scripts/bench-perf/run.mjs --against=main   # A/B: main → the working tree, ~7 min
npx -y -p playwright@1.50.1 node scripts/bench-perf/run.mjs --against=HEAD   # the uncommitted changes
npx -y -p playwright@1.50.1 node scripts/bench-perf/run.mjs                  # this tree alone: budgets, drift, ~3 min
node scripts/bench-perf/run.mjs --only=dsp --against=main                     # the DSP in Node only, A/B: ~40 s
```

Options: `--against=<ref>` (a commit, branch or tag: an A/B run); `--only=` cases (`S5`, `L1`, `L3`), groups
(`cpu`, `latency`) or `dsp`; `--runs=N` (the runs of S5 a side, 5 by default); `--browsers=chromium,webkit`;
`--update-baseline`; `--headless` (latency and quanta not representative: a separate baseline);
`--keep-traces`; `--dump-trace` (every event of the Chromium trace of S5 in `tmp/bench-perf/trace-events.md`);
`--rebuild`.

The report goes to `tmp/bench-perf/report.md` (and `report.json`, every run and every note); the exit code is 1
if a check failed.

## Before a run

- macOS with Xcode: `xcrun xctrace` records the cycles. The first recording may ask for Developer Tools access
  of the terminal (System Settings → Privacy & Security → Developer Tools).
- The browsers of Playwright 1.50.1: `npx -y playwright@1.50.1 install chromium webkit`.
- The S3 keys in `.env` (the tables of the cases are downloaded once into `tmp/bench-perf/tables`).
- The Mac on its power adapter, Low Power Mode off, other audio apps closed (a DAW, a browser playing): the
  runner warns about the first two, a Bluetooth output and an output not at 48 kHz (the browser resamples the
  cases: more cycles and latency than the baseline; Audio MIDI Setup → the output → Format). The browsers are
  headed and play the cases aloud: turn the volume down, keep a wired output. Don't use the Mac meanwhile (the
  windows come to the front). One run at a time: two recordings of xctrace at once fail.

## A/B runs

Two sessions of the same code differ more than the runs within one: on an M5 Pro the heavy patch took 8.5% and
20% more cycles and a voice of the DSP 11.6% more in later sessions (the JIT, the cores the threads land on, the
heat), while in an A/A run (`--against=HEAD`, a clean tree) the medians of the two sides agreed within 0.5% (S5),
2.5% (the latency to the voice) and 1.5% (the DSP). So the runs of one session tell the sessions apart, not the
code: a regression compares the working tree with a reference **in the same session**, their runs alternating.

`--against=<ref>` checks the commit out in a worktree of its own (`tmp/bench-perf/against/<sha>`, its
`node_modules` a link to the repo's: a reference with another `package-lock.json` is built with ours, the report
warns), makes its perf build once (`npm run build:perf` there, ~1.5 min) and serves both builds:

- S5: the runs of both sides alternate, A B B A A B … (5 a side by default, ~22 s each);
- L1, L3: 5 sessions of 10 notes a side, a fresh page each, alternating; the latency of every note is worked out
  in Node by the `latency.ts` of the working tree from what the page recorded (one formula for both sides);
- the DSP: the code of the reference bundled too, the samples of both alternate in one process.

`--against=HEAD` with a clean tree is an A/A run: both sides the same code, nothing should fail (the check of the
verdicts on the machine). A run without `--against` checks no regression: budgets, invariants and the drift from
the baseline. The worktrees stay for the next run (a reference is built once): `rm -rf tmp/bench-perf/against && git worktree prune` removes them.

## The baseline

`--update-baseline` keeps the values of the working tree (`baselines/<model>-<cpu>.json`, committed: every run of
S5, every note of L1 and L3, every sample of the DSP) and the conditions of its run per browser and mode: the
browser version, the macOS release, the output (its transport and its rate). Later runs warn of a drift from it
(the median moved by more than a session drifts, `DRIFT` of `report.mjs`): a hint to run an A/B, never a
failure. An update with `--only` keeps the cases it didn't measure under the same conditions, else drops them (the
runner lists them). Rebaseline after an intended change of a cost, a new Playwright, a new Node major, another
macOS release or output.

## The cases

48 kHz, whatever the rate of the output (`SCENE_RATE`: the app asks for none, its context would run at the
output's; a page whose context runs at another rate errors). Chromium plays at low latency (`latencyHint` 0,
128 frames: the Auto of the app in a Chrome that counts dropouts), forced by the page as the rate, not through
the setting of the app: Chromium 133 of Playwright counts none, its Auto would be normal, and the tree of an A/B
reference may have no setting. A baseline of before it was taken at normal (256 frames, L1 ~7 ms later):
`--update-baseline` again.

| Id     | Case                                                                                                                                                                                                                                                                                                                                   | Measures                                                                                                                                        |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| **S5** | the heavy patch, 12 notes held: osc1 `ESW Analog - 303 Saw`, osc2 `ESW Basics - PWM Saw 01` at Oct −1 (256 frames each), unison 8 each, detune 25 / 35, Phase rand 100%; lowpass 2.5 kHz, res 6; distortion (mix 1, drive 8) → delay (mix 0.3) → reverb (mix 0.3, decay 3 s); envelope 10 ms / 100 ms / 300 ms / 0.8 / 300 ms; Poly 12 | the cycles of the audio thread, the main thread and the worker, the memory of the page, the render quanta, dropouts, the counters of the engine |
| **L1** | 50 single notes, a key every 300 ms (one oscillator, u1, no attack)                                                                                                                                                                                                                                                                    | latency to the voice and to the output, jitter                                                                                                  |
| **L3** | L1 on top of 8 held notes (2 × u8)                                                                                                                                                                                                                                                                                                     | latency under audio load                                                                                                                        |

- **A CPU run** (~22 s): a fresh browser context, a click (the AudioContext runs), `ready()`, the snapshot, its
  notes, 3 s of warm-up (the mix tables built, the reverb filled), then Instruments records 10 s
  (`--instrument 'CPU Profiler' --instrument 'Activity Monitor' --all-processes`, its start signalled by
  `--notify-tracing-started`). The hook's counters are read at both ends of the window; Chromium traces its
  glitches meanwhile (category `audio`: free), and in the first run its render quanta in a window of 4 s after
  the save (`audio,webaudio`: +3% of the worklet's cycles). The trace is read while the next run sets up.
- **The trace**: the CPU Profiler samples every 1M cycles of a core, so the cycles of a thread don't depend on
  the clock of the core. The page is the process with the busiest audio worklet thread among the processes of
  the Playwright browser (by their path: other browsers, a DAW, are left out). Memory: the physical footprint of
  that process (Activity Monitor, about once a second).
- **A latency case**: Playwright's keyboard while the hook traces each note: its input event (`window.event`
  while the note on runs, the time a capture listener got it), the end of the synth's note on, the frame its
  voice was scheduled at and the one it started at (posted by its processor, matched to its press), the onsets
  an extra worklet (`probe.worklet.ts`, served by the runner) hears before the filter and after the limiter
  (L1).
- **The DSP** (Node): voices (held, a moving position on 16 frames and on 256, a chord of 12 notes × 2 × u8 struck every 40 blocks:
  its attack, the direct path and the mix builds under the budget), table building, reverb, distortion,
  limiter, ns per sample divided by the ns of a
  fixed multiply-add of the same run (the speed of the machine out), 7 samples each. V8, not JSC: it catches
  algorithmic regressions (a hot loop that boxes doubles) the operation counts of the specs can't. A module with
  a Rust core (`dsp/`, `tmp/wasm` of the tree) runs it under the names of its cases; a tree of before stage 5 of
  the plan runs its TS cores under them (`--against=<ref>` of then compares the cores), a tree of the port has
  both, the TS ones as `<case> (ts)`.

## What the report shows

- **Mcps**: millions of cycles per second of a thread — the audio worklet thread of the page, its main thread,
  the worker of the tables, the threads that deliver the output; the share of the cores (S, P, E) the audio
  thread ran on. The median of the runs, each run in `report.json`.
- **Memory**: the footprint of the page process (steady: the median of the window, the peak).
- **Engine** (the hook): voices alive, the share of samples played on the direct path (not from mix tables),
  mix builds and refusals per second, the store (bytes of the table versions held), the mix tables, the worker's
  pool, the longest table build.
- **Quanta** (Chromium): the render of each block of 128 frames (`webaudio`
  `RealtimeAudioDestinationHandler::Render`) p99 / max against its deadline (2.67 ms at 48 kHz).
- **Dropouts**: device callbacks Chromium missed (`audio` `Glitch!` on `AudioOutputDevice`), or the context
  fell behind the clock by 0.5% (WebKit too; coarse: its time moves by device buffers).
- **Latency**, ms from the input event: to its voice — the start of the voice after the frame it was scheduled
  at, the clock of the context at the note on: the main thread and the render lag, what the page adds (p5 / p50 /
  p95 / max, jitter p95 − p5, `–` without timed notes); not the wait for the next device callback (up to a
  device buffer) nor the output — and to the output of the device, end to end (Chromium, `getOutputTimestamp`; a
  note without an output timestamp has none; WebKit gives its render clock and no output latency: n/a). Between
  them the output path: the note on → its scheduled frame at the output (the device callback, the buffers, the
  output: the browser and the device, not the page; to the output = to its voice + its onset + the output path).
  And to the handler, the note on itself, the render lag (the voice started a device buffer after its scheduled
  frame: its node came after that block began), the chain (filter, effects, limiter: L1 hears it with no
  effect, the limiter alone).

## Statuses

A regression (an A/B run) is a difference the runs tell apart and large enough to matter: a one-sided
Mann–Whitney U test of the values of the working tree against those of the reference (exact up to 10 a side,
ties at their mean ranks; above, the normal approximation with the corrections for ties and continuity) **and** a
shift of the median over a threshold (`verdict.mjs`, `REGRESSIONS` of `report.mjs`):

| Metric                          | Values a side   | Regression                 | Level                                                    |
| ------------------------------- | --------------- | -------------------------- | -------------------------------------------------------- |
| S5 audio thread                 | the runs (5)    | p < 0.05, +5% and +2 Mcps  | FAIL                                                     |
| S5 memory                       | the runs        | p < 0.05, +5% and +10 MB   | FAIL                                                     |
| S5 main thread                  | the runs        | p < 0.05, +15% and +5 Mcps | WARN                                                     |
| L1, L3 to the voice             | the notes (50)  | p < 0.01 and +0.5 ms       | FAIL                                                     |
| L1, L3 to the output (Chromium) | the notes       | p < 0.01 and +0.5 ms       | WARN (the output path is the browser's and the device's) |
| DSP                             | the samples (7) | p < 0.05 and +5%           | FAIL                                                     |

Fewer than 5 runs or samples, or 20 notes, on a side: a warning (too few values to compare), never a silent
pass. The drift from the baseline (S5 audio +25% and +5 Mcps, memory +10% and +20 MB, to the voice +1 ms, the DSP
+20%) only warns, and only against a baseline of the same browser version, macOS release, output transport and
rate (and Node major for the DSP); a condition the runner couldn't read (system_profiler gave nothing) is a
warning of its own and compares as if the same.

FAIL (exit 1) also: broken invariants — a note that never sounded although the synth was ready, no audio thread
of the page in any run (a thread renamed in a new browser: `ENGINES` of `xctrace.mjs`; in some runs: a warning),
no memory of the page, dropouts in most runs (in some: a warning), a case that errors.

WARN: the preflight, and the budgets — S5 memory ≤ 300 MB, render quanta p99 ≤ 50% and max ≤ 80% of the
deadline; L1 to the voice p95 ≤ 8 ms and jitter ≤ 3 ms; L3 p95 ≤ L1 + 3 ms and max ≤ 20 ms; a note on ≤ 1 ms
(p95).

The verdicts are tested without a browser: `npm run test:scripts` (`verdict.test.mjs`, `report.test.mjs`).

## What moved to the specs

The cases the suite had before (git history of this folder) and what checks the same now, deterministic, in
`npx nx test waveform` (CI):

| Was            | What it showed                                                                           | Now                                                                                                                                   |
| -------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| S0             | the fixed cost: the limiter, idle effects                                                | the idle paths of `distortion-dsp.spec.ts`, `reverb-dsp.spec.ts`, `true-peak.spec.ts`                                                 |
| S1, S2, S3, S4 | the cost of a voice, a unison voice, a note, each effect; held notes on their mix tables | `synth/common/wavetable/wavetable-osc-budget.spec.ts` (the samples of each path, the mix builds and their cost per block)             |
| S6             | voices moving on the direct path                                                         | `wavetable-osc-budget.spec.ts`                                                                                                        |
| S7             | note-on peaks, release tails, stealing                                                   | `wavetable-osc-budget.spec.ts`, `synth/common/modules/synth-work.spec.ts`, `synth/endurance.spec.ts`                                  |
| S8             | table switches: crossfades, the worker, the memory peak, the store settling              | `synth/common/wavetable/wavetable-memory.spec.ts`, `endurance.spec.ts`                                                                |
| S9             | a frame edited every 50 ms                                                               | `wavetable-osc-budget.spec.ts` (back on the mix tables within the throttle of the edits)                                              |
| S10            | leaks over a random patch every 5 s                                                      | `endurance.spec.ts`                                                                                                                   |
| S11            | 44.1 / 96 kHz, the mix-table budget above 88.2 kHz                                       | `wavetable-osc-budget.spec.ts`                                                                                                        |
| S12            | the table of an oscillator that is off                                                   | `wavetable-memory.spec.ts`                                                                                                            |
| L2             | the chain latency = limiter + distortion                                                 | `app/perf/chain-latency.spec.ts`                                                                                                      |
| L4             | notes on the piano                                                                       | `libs/ui-kit/src/piano-keyboard/piano-keyboard.spec.tsx` (a pointer plays its note at once)                                           |
| L5, L7, L8     | a note right after a table switch, WebMIDI, trills                                       | `synth/common/modules/note-path.spec.ts` (the input reaches its voice in the same task), `synth-work.spec.ts` (the work of a note on) |
| L6             | the first note after the load, after the background                                      | dropped: the code path is in `synth.spec.ts` (loading) and `synth-core.spec.ts` (resume)                                              |
| devices        | the load of the heavy patch on an iPhone, an iPad 10 (`device.mjs`)                      | dropped (git history)                                                                                                                 |

What only the browser tells stays here: the time of the code in a real engine (JIT, boxing, JSC), the cycles the
browser adds around the worklet, GC and the heap, dropouts, the device callback and the jitter of real input.

## Files

| File                  |                                                                                           |
| --------------------- | ----------------------------------------------------------------------------------------- |
| `run.mjs`             | the CLI, the CPU runs, the order of everything                                            |
| `scenes.mjs`          | the cases as data                                                                         |
| `site.mjs`            | the perf build, the tables, the server                                                    |
| `browser.mjs`         | Playwright: launch, a page of the app, the hook                                           |
| `xctrace.mjs`         | recording and reading the traces (threads, cycles, memory)                                |
| `chrome-trace.mjs`    | the render quanta, the messages of the worklet thread and the glitches of Chromium        |
| `latency.mjs`         | the latency cases                                                                         |
| `reference.mjs`       | the reference of an A/B run: its worktree, its perf build                                 |
| `dsp.mjs`             | the DSP in Node                                                                           |
| `report.mjs`          | summaries, the checks, the report, the baseline                                           |
| `verdict.mjs`         | Mann–Whitney, the regressions, the conditions, the merge of the baseline (pure)           |
| `*.test.mjs`          | the specs of the verdicts (`npm run test:scripts`)                                        |
| `baselines/`          | the baselines of the machines                                                             |
| `../bench-common.mjs` | shared with bench-osc: the root of the repo, Playwright, `.env`, the tables of the bucket |

When Chromium renames its trace events (a Playwright update), quanta show "found by its rate" or n/a: run with
`--dump-trace` and pin the names in `chrome-trace.mjs`.
