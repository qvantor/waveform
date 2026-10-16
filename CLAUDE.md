# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Waveform is an experimental browser wavetable synth (TypeScript + Web Audio API, React 18). It is an Nx 14 monorepo with one app (`apps/waveform`) and four libs (`libs/math`, `libs/rxjs-react`, `libs/ui-kit`, `libs/preset-schema`), plus Netlify serverless functions in `netlify/` and a Postgres database for presets. Deployed to Netlify.

## Commands

- `npm start` — runs `netlify dev` (functions on :8888) and the Nx dev server (:4200) together. The dev server proxies `/.netlify/*` and `/api/*` to :8888 (`proxy.conf.json`), so wavetables and presets only work when both run.
- `npm run certs` — generates `.certs/` (gitignored) with mkcert for localhost and the current LAN IPs. `netlify dev` serves HTTPS with it (`[dev.https]` in `netlify.toml`) and fails to start without it; run `mkcert -install` once to trust the local CA.
- `npm run client:start` — frontend only (`nx serve`); wavetable list/download requests will fail.
- `npm run build` — production build to `dist/apps/waveform`.
- `npm run worklets` — bundles the audio worklet modules (reverb, limiter; one `name=path` entry each) with esbuild into `tmp/worklets/` (served as `assets/worklets/` via the `assets` of `apps/waveform/project.json`). `build` runs it with `--minify`, `client:start` runs it once and then in watch mode next to `nx serve`.
- `npx nx test <project>` — Jest for one project (`waveform`, `math`, `rxjs-react`, `ui-kit`, `preset-schema`, `netlify`). Single file: `npx nx test rxjs-react --testFile=rx-model.spec.tsx`.
- `npx nx lint <project>` — ESLint (`import/order` is an error).
- `npm run prettier:check` / `npm run prettier:fix` — Prettier over apps, libs, netlify and scripts (single quotes, JSX single quotes, print width 110).

- `npm run precheck` — everything CI runs: `prettier:check`, `typecheck`, `lint`, `knip`, `test:all`. GitHub Actions (`.github/workflows/ci.yml`) runs the same checks as separate steps (all run even if one fails) on every push to `main` and every PR. Node version comes from `.nvmrc` (used by CI and Netlify).
- Server tests (`npx nx test netlify`) mock the DB with the fake `sql` tag from `netlify/tests/fake-sql.ts` (records queries, answers by regex). Function specs live in `netlify/tests/`, never in `netlify/functions/` (every file there is deployed as a function).
- `npm run typecheck` — `tsc --noEmit` over every app/lib tsconfig and `netlify/tsconfig.json` (Netlify bundles functions with esbuild, without typechecking).
- `npm run knip` — unused files, exports and dependencies (`knip.json`; deps used only implicitly by Nx/jest/eslint are in `ignoreDependencies`).
- `BASE_URL=... node scripts/check-limits.mjs [--reports]` — checks API rate limits against a dev/staging deployment.

Env vars are listed in `.env.example` (copy to `.env` for local dev): S3 (`BUCKET`, `ACCESS_KEY_ID`, `SECRET_ACCESS_KEY`, region eu-central-1), `DATABASE_URL`, Turnstile (`NX_TURNSTILE_SITE_KEY` for the client, inlined at build time; `TURNSTILE_SECRET` for functions), `IP_HASH_SALT`, `MIN_UNIQUE_USERS`, `POPULAR_MIN_USERS`, `SCORE_PRIOR_LISTENERS`, `REPORT_HIDE_THRESHOLD`. DB schema is in `db/migrations/` (apply in order) and is applied manually.

## Architecture

### State: `rxModel` (libs/rxjs-react)

All app state and audio logic live in RxJS "models", not React state. The pattern:

```ts
const model = (deps) =>
  rxModel((initial) => ({ $foo: new PrimitiveBS(0), audioNode, ... }))  // state: BehaviorSubjects + Web Audio nodes
    .actions((model) => ({ setFoo: (v) => model.$foo.next(v) }))
    .subscriptions((model, actions) => [ ...rx subscriptions wiring state to audio... ])
    .plugins(urlSnapshotPlugin({ modelToSnap, applySnap }))
    .destroy((model) => { ... });

export const { ModelProvider: FooProvider, useModel: useFoo } = rxModelReact('fooModel', model);
```

- Each builder call returns a new immutable factory; `init` runs actions, subscriptions, and plugin `onInit`; unmount runs `destroy`, unsubscribes, and plugin `onStop`.
- `rxModelReact` wraps a model in a React context. `<FooProvider initial={...} {...deps}>` takes the `initial` value plus dependency props (other models' `[model, actions]` tuples); `useFoo()` returns `[model, actions]`.
- Components read observables via `useBehaviorSubject($x)` / `useObservable`. BehaviorSubject helpers: `PrimitiveBS`, `ArrayBS`, `ObjectBS`. Observable names use a `$` prefix.
- Dependency injection is done through provider nesting, so provider order matters. The tree in `apps/waveform/src/app/synth/index.tsx` defines it: InputController → SynthCore → AdsrEnvelope → Oscillator1/2 → MidiController → Filter → Fx → KeyboardController → Synth → Presets.

### Audio graph (apps/waveform/src/app/synth/common/modules)

- `synth-core.ts` owns the single `AudioContext`: `preGain → [$midNodes, e.g. filter] → fxIn → [fx chain] → fxOut → masterGain → masterLimiter → destination`. Other modules insert processing nodes through `addMidNode`. `$masterGain` is linear, the Master knob (`master-handle.tsx`) shows it in dB from −40 (silence) to +12: above 0 dB it drives the limiter. The header analysers tap `output` (the limiter's output).
- The master limiter (`synth/common/limiter/`) is the last stage, after the master volume. `limiter-dsp.ts` is the pure signal processing (tested offline): a stereo linked brickwall at −0.5 dBTP with a 4× true peak detector (`true-peak.ts`, polyphase Kaiser sinc whose phase 0 is the input itself), 2 ms lookahead, the needed gain held for 20 ms (the gain never moves inside a bass wave), a fast (50 ms) and a slow (0.5 s) release envelope (short peaks let go fast, dense parts slowly, no pumping between their notes; once the sound has needed less than the slow one for 250 ms it lets go at the fast rate, down to what the sound still needs) and two moving averages over the lookahead (S-shaped attack). The detector skips the interpolation while the last 32 samples are below the ceiling / `TRUE_PEAK_BOUND` (−8.6 dBFS: no point between them can reach the ceiling), and sums its 3 phases in one pass over the history, so quiet parts cost 0.2% of a core (about 0.6% while limiting, the native compressor 0.15%) and the output is the same to the bit. No sample goes over the ceiling, the true peak of band-limited sound stays under 0 dBFS (the 4× grid reads at most cos(π·f/4) low), below the ceiling, once released, the sound passes bit for bit, delayed by `latency` (2.3 ms at 48 kHz). `limiter.worklet.ts` registers the processor, `master-limiter.ts` loads it with `createWorkletFx`; while it loads, without AudioWorklet or after it failed the master goes through the old DynamicsCompressor (`FALLBACK_LIMITER`: hard knee at −4 dB, 250 ms release, its makeup gain taken back by `compensation`), which overshoots on the onset of dense unison chords.
- The `fx` model (`synth/fx/`) wires the FX rack between `fxIn` and `fxOut`. Effects are defined in `FX_REGISTRY` (`fx/effects/`, params and ranges from `FX_PARAMS` in `libs/preset-schema`). `createFxSlot` wraps each one: `mix` is an equal-power crossfade (0 only dry, 0.5 both at −3 dB, 1 only wet), bypass passes only the dry signal at full level. The chain is the added effects in `$order`; adding an effect type means a registry entry plus its preset schema.
- The reverb runs in an AudioWorklet: `reverb-dsp.ts` is the pure signal processing (16-line FDN, tested offline with impulse responses), `reverb.worklet.ts` registers the processor, `reverb.ts` creates the `AudioWorkletNode` once `loadWorklet` has added the module and posts param changes to it. Both worklet modules register their processor with `registerStereoProcessor` (`fx/effects/stereo-processor.ts`: the AudioWorkletGlobalScope declarations, a mono input feeds both sides, a disconnected one is silence, `stop` ends it), their nodes are created with `STEREO_WORKLET_OPTIONS`. A worklet module must not import `@waveform/ui-kit`, `@waveform/preset-schema` (zod) or anything touching `window`/`document`. The synth core adds the limiter module itself, so specs that count `addModule` calls count only their module (`workletLoads` in `test-utils`).
- A worklet effect builds on `createWorkletFx` (`fx/effects/worklet-fx.ts`: loading, input → node → output, `$status`, `retry`, `destroy` posts `stop` to the processor). Without AudioWorklet (http on a LAN IP, old Safari) or when its module fails, the app still works: the fx model keeps the effect out of the chain (it stays `added` in the snapshot), and the Effects list shows why under its name. An unsupported effect can't be added, an added one that can't be used can still be removed, a failed one loads again on Retry or when it is added. Until an effect is `ready` (also while it loads) its slot passes only the dry signal and is inactive.
- `oscillator.ts` holds a wavetable (`$waveTable`: an array of single-cycle waves), the selected frame, and unison/detune/octave settings. It converts the current wave to a `PeriodicWave` through `wave.realWithImag` (FFT, in `libs/math`).
- `synth.ts` handles voices: on input-controller note events it builds per-note unison oscillators plus an ADSR gain envelope. Polyphony, portamento and legato also live here.
- `input-controller.ts` is the shared note-on/off bus. The on-screen piano, `keyboard-controller.ts` (QWERTY) and `midi-controller.ts` (WebMIDI) all feed into it.

### Snapshots

`app/plugins/snapshot.ts` creates one `searchParamsSnapshotPlugin`. Models that register it (`osc1`, `osc2`, `filter`, `adsr`, `fx`, synth as `v`) expose their state as `{ [modelName]: { key: value } }`:
- `getSnapshot()` / `applySnapshot(obj)` read and apply the state at runtime (used by presets); `$snapshotChanges` emits on any change.
- Legacy URL params `<modelName>-<key>=<json>` are still applied on init.
- `applySnap` must handle falsy values (`!== undefined`, not `&&`), and missing keys mean defaults.
- When adding persisted state, extend the model's `modelToSnap`/`applySnap` **and** `presetDataSchema` in `libs/preset-schema` (unknown keys are stripped, so a missing schema field is silently not saved).

### Presets (apps/waveform/src/app/presets, netlify/functions)

- `libs/preset-schema`: zod schema of preset data with ranges and defaults, `normalizePreset` (4 significant digits, sorted keys), `presetHash` (sha256 of normalized JSON, name excluded → dedup), profanity filter. Shared by the client and functions (functions import it by relative path, esbuild doesn't know tsconfig aliases).
- API (Netlify Functions v2, routed by `config.path`): `presets.mts` handles `/api/presets` (list/search with keyset cursors, save with Turnstile + 5/hour/IP), `/api/presets/top`, `/api/presets/:id` (GET, and PUT to overwrite), `/api/presets/:id/report`, `/api/presets/:id/opened`, `/api/presets/name-available?name=`; `usage.mts` stores listens and stays (each with a Turnstile token of its own). IPs are stored only as salted hashes.
- Scheduled: `recompute-scores.mts` (every 30 min) and `cleanup.mts` (daily, removes unqualified presets 90 days after they were saved, edited or opened by their author: `GREATEST(created_at, updated_at, author_opened_at)`; listeners not heard for 60 days; reports of hidden presets and those older than 180 days, so REPORT_HIDE_THRESHOLD counts the reports of half a year).
- Scores (`recompute-scores`, last 60 days): a listener is an `ip_hash` (`getIpHash` hashes `ipKey`: IPv4 as is, IPv6 by its /64, privacy addresses rotate), not a client id (clearing localStorage would make new ones). A listen is playing a chosen preset `USAGE_LISTEN_SECONDS` (10), a stay `USAGE_STAY_SECONDS` (60, both `libs/preset-schema`), both without switching to another one; presets skipped sooner are not counted (the top is stepped through with ◀ ▶ the most, their listens would weigh against it). The client sends each once a preset is opened (`POST /api/usage` `{ presetId, event: 'listen' | 'stay', turnstileToken }`), `usage.mts` keeps one `listens` row (migration 004) per preset and IP with the days of the last listen (`heard`) and stay (`stayed`, NULL if none), each renewed at most once a day; a stay sets `heard` too, so `stayed <= heard`. Listens on hidden presets and on the author's own ones (the preset's `ip_hash`) are not stored, the preset opened on start is not counted at all (its listeners didn't choose it). Each listen and stay weighs w, a 7-day half-life since its day. `score` = the share of listeners who stayed with a Bayesian prior: (Σ w stays + k·m) / (Σ w listens + k), m the site's share: Σ over all presets of their shares, each weighing min(Σ w listens, k), k = SCORE_PRIOR_LISTENERS (with every listen counted the top would make the average itself and its lower part would keep falling below it, out of the top); a share, not a count, so the top's extra traffic (start, ◀ ▶) gives it no extra score, and a preset with few listeners stays near m. `unique_users` = the listeners who stayed (shown in the lists). Only presets with MIN_UNIQUE_USERS of them get a score (and `qualified_at`). `cleanup` removes rows not heard for 60 days.
- Popular: `preset_scores.popular` with POPULAR_MIN_USERS listeners who stayed and a share not below m (m is a rounded numeric quotient, compared with a 1e-12 tolerance, so exactly the average counts): the bar doesn't grow with the audience, a preset found in the list gets in with listeners who stay. `/api/presets/top` (Popular tab, ◀ ▶, 50 presets) has every featured preset first (curated, `presets.featured`, whatever its score), the rest of it are such presets by score; the `popular` sort of the list orders all presets by score, whatever the threshold.
- Client: `presets` rxModel (current preset, dirty flag via hash comparison, ◀ ▶ list, `?preset=<id>` loading), `usePresetUsageTracker` (counts the seconds an opened preset is played: audio runs, tab is visible and a note is held or was played or released in the last 30 s; once a preset reaches `USAGE_LISTEN_SECONDS` / `USAGE_STAY_SECONDS` without switching it reports the listen / the stay, each once; the `auto` preset is not counted until it is chosen; another preset drops a listen or stay not reached, a hidden tab only pauses it), `UsageReporter` (rendered by `PresetSection`) sends them one at a time, each through a Turnstile widget of its own (`appearance: 'interaction-only'`, out of the layout, the script loads with the first event): the visitor never sees it, an event Cloudflare would ask to interact for, a failed check or no token in `CAPTCHA_TIMEOUT_MS` (30 s) is dropped.
- Start without `?preset=`: `openPopular` opens a random one of `/api/presets/top` as `auto` (unless something was loaded, saved or changed meanwhile: the state must still hash to `presetHash({})`). Random, not the first: no single preset is opened for every visitor; ▶ continues from it. An `auto` preset is not put in the url (after a reload it would open from the link as chosen). Init (the button between the name and ▶, `reset`) applies `normalizePreset({})` (not `applySnapshot({})`: some `applySnap` keep missing keys), clears the preset and the url. UI: `PresetPanel` in the header, `PresetBrowser` and `SaveDialog` antd modals. Cmd/Ctrl+S opens the save dialog.
- Editing: on create the server returns a secret `editToken` (only its sha256 is stored in `presets.edit_token_hash`); the client keeps tokens in `localStorage.presetEditTokens`. `PUT /api/presets/:id` with the token overwrites sound and name (no Turnstile, 1 update per 5 s, 409 if the sound is another preset's). Presets created before migration 002 have no token and can't be edited. Opening an own preset (`applyPreset` with a token in `localStorage`, once a session) posts the token to `POST /api/presets/:id/opened`, which sets `presets.author_opened_at` (migration 005, at most once a day, a wrong token changes nothing): the author keeps it from the cleanup.
- Names are unique case-insensitively with collapsed whitespace (`presetNameSchema` normalizes, `presets_name_key` is a unique index on `lower(name)`, migration 003). Hidden presets keep their names. The save dialog checks availability while typing; saving the same sound under a taken name still returns the existing preset (dedup by hash comes first).
- QWERTY notes are ignored while focus is in a text field (`keyboard-controller.ts`).

### Wavetables

- The Netlify functions (`netlify/functions/get-wavetables-list.ts`, `get-wavetable.ts`) list the wavetable files in an S3 bucket as a folder tree and serve them. The client fetches the list with react-query (`synth/oscillator/hooks/use-wavetables.ts`). The table itself is loaded by the oscillator model from `$waveTablePath` (last path element = S3 key, `synth/services/wavetable.ts`, cached per session, 2 retries), so it follows presets whatever screen is shown; `WaveSelector` only shows `$waveTableLoading`.
- The files are Serum wavetables (mono 32-bit float WAV, 44.1 kHz, 2048-sample waves). `synth/services/wav.ts` reads their samples from the bytes; not `decodeAudioData`, which resamples to the context rate (at 48 kHz a 2048-sample slice is 1.09 cycles and a table has ~278 waves instead of 256).
- The wavetable editor (`synth/wave-table-editor/`) also builds tables from manual drawing or from an uploaded audio file. `synth/services/audio-file.ts` reads that file at its own rate, never at the context's: a WAV through `wav.ts`, other formats decoded by an `OfflineAudioContext` at 44.1 kHz (their rate is unknown before decoding).

### Libs

Libs are imported through the path aliases in `tsconfig.base.json`: `@waveform/math`, `@waveform/rxjs-react`, `@waveform/ui-kit` and `@waveform/preset-schema`.

- `math`: number, vector and typed-array helpers, plus FFT-based wave utilities.
- `ui-kit`: styled-components UI widgets (charts, knobs/handles, piano, analysers, ADSR) and `theme`/`GlobalStyle`. The app also uses antd 5, themed in `app/index.tsx`.
