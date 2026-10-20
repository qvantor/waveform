# Oscillator benchmark

The wavetable oscillator worklet (`apps/waveform/src/app/synth/common/wavetable`) against a native
`OscillatorNode` with the `PeriodicWave` of the same frame, in Chromium, WebKit and Firefox. A manual check,
not part of CI.

```sh
npx -y -p playwright@1.50.1 node scripts/bench-osc/run.mjs
npx -y playwright@1.50.1 install chromium webkit firefox   # once, if the browsers are missing
```

Options: `--browsers=chromium,webkit,firefox`, `--rates=44100,48000,96000`,
`--only=sound,pitch,continuity,switch,stereo,unison,cpu,delivery,build`, `--dsp=js`: the worklet of production
by default, on the wasm core (`tmp/wasm`: `npm run wasm` first), the TS one with `--dsp=js`. Every call of the
page runs on a page of its own: the OfflineAudioContexts of a page keep their worklets (with the wasm core a
table of up to 64 MB each in its memory) and Chromium stopped making new instances.

`run.mjs` bundles `bench-page.ts` and the worklet module with esbuild, downloads 3 tables of the bucket
(the S3 keys of `.env`) into `tmp/bench-osc/tables`, serves both on localhost (a secure context: AudioWorklet)
and runs the page in each browser. Playwright is not a dependency of the project: `npx -p` puts it on the
`PATH`, `run.mjs` loads it from there. The report goes to `tmp/bench-osc/report.md` (and `report.json`); the
exit code is 1 if a criterion failed.

## What is measured

Offline renders (`OfflineAudioContext`) at 44.1, 48 and 96 kHz of a band-limited saw and the middle frame of
3 real tables at 55, 220, 1046, 3520 and 7040 Hz:

| Criterion         | How                                                                                   | Threshold                                                                                                                                    |
| ----------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Aliasing          | power outside the harmonics against the harmonics (Kaiser β 38 window, 65536 samples) | ≤ native + 1 dB                                                                                                                              |
| Worst spur        | loudest bin outside the harmonics against the fundamental                             | ≤ native + 1 dB                                                                                                                              |
| Brightness        | highest harmonic played at half its amplitude in the frame at least                   | ≥ native                                                                                                                                     |
| Level             | RMS against the native render of the frame (`disableNormalization`: at its volume)    | ±0.1 dB                                                                                                                                      |
| Pitch             | drift of the phase of the fundamental over 10 s                                       | ≤ 0.01 cent                                                                                                                                  |
| Integer positions | `position` k / (N − 1) against a table of frame k alone                               | the same samples                                                                                                                             |
| Morph             | `position` 0 → 1 in 1 s at 220 Hz                                                     | max step ≤ 1.1 × the steepest frame                                                                                                          |
| Glide             | 55 Hz → 7 kHz in 2 s                                                                  | max step ≤ 1.1 × the steepest pitch on the way                                                                                               |
| Table switch      | a new version at 0.25 s of a note                                                     | no step, the new table from 10 ms on                                                                                                         |
| Stereo, unison    | u3 and u8 widely detuned: each voice in its channel                                   | its level, nothing in the other one                                                                                                          |
| Unison level      | 400 notes of 100 ms, u2…u8 against u1                                                 | RMS ±0.3 dB, peak −1…+4 dB                                                                                                                   |
| CPU               | 8 voices × 2 oscillators × u4, 10 s; native: the graph the synth had                  | ≤ 1.0× native held, ≤ 1.3× with an LFO on position (against native held) or on detune (against native with it)                               |
| CPU, envelopes    | the same, ENV 2 routed to Wave, Detune and Gain of both oscillators                   | on its sustain (from the note on) ≤ 1.05× the same sound without routes; moving the whole time ≤ 1.05× ours with an LFO into the same params |
| Tables            | building 256 frames on the main thread, their size                                    | ≤ 500 ms, ≤ 64 MiB                                                                                                                           |

The table switch needs `OfflineAudioContext.suspend`, which Firefox does not have: it is not measured there
(the offline specs of the dsp cover it).

The native reference is a `PeriodicWave` without its normalization (`disableNormalization`): the oscillator plays
a frame at its volume. Normalized, Firefox scales each band-limited range of its own (its level moved
with the pitch, by up to −32 dB on a vocal frame): the level criterion now holds in the three engines.

## On the device

The real-time check on an iPhone 15 Pro (192 oscillators: 12 voices × 2 × u8 at full polyphony, no dropouts,
the memory of the tab) is done in the app over `npm run certs` HTTPS on the LAN with Safari's Web Inspector
(Timelines: CPU and memory).
