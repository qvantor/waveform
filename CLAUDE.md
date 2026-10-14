# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Waveform is an experimental browser wavetable synth (TypeScript + Web Audio API, React 18). It is an Nx 14 monorepo with one app (`apps/waveform`) and four libs (`libs/math`, `libs/rxjs-react`, `libs/ui-kit`, `libs/preset-schema`), plus Netlify serverless functions in `netlify/` and a Postgres database for presets. Deployed to Netlify.

## Commands

- `npm start` — runs `netlify dev` (functions on :8888) and the Nx dev server (:4200) together. The dev server proxies `/.netlify/*` and `/api/*` to :8888 (`proxy.conf.json`), so wavetables and presets only work when both run.
- `npm run certs` — generates `.certs/` (gitignored) with mkcert for localhost and the current LAN IPs. `netlify dev` serves HTTPS with it (`[dev.https]` in `netlify.toml`) and fails to start without it; run `mkcert -install` once to trust the local CA.
- `npm run client:start` — frontend only (`nx serve`); wavetable list/download requests will fail.
- `npm run build` — production build to `dist/apps/waveform`.
- `npm run worklets` — bundles the audio worklet modules with esbuild into `tmp/worklets/` (served as `assets/worklets/` via the `assets` of `apps/waveform/project.json`). `build` runs it with `--minify`, `client:start` runs it once and then in watch mode next to `nx serve`.
- `npx nx test <project>` — Jest for one project (`waveform`, `math`, `rxjs-react`, `ui-kit`, `preset-schema`, `netlify`). Single file: `npx nx test rxjs-react --testFile=rx-model.spec.tsx`.
- `npx nx lint <project>` — ESLint (`import/order` is an error).
- `npm run prettier:check` / `npm run prettier:fix` — Prettier over apps, libs, netlify and scripts (single quotes, JSX single quotes, print width 110).

- `npm run precheck` — everything CI runs: `prettier:check`, `typecheck`, `lint`, `knip`, `test:all`. GitHub Actions (`.github/workflows/ci.yml`) runs the same checks as separate steps (all run even if one fails) on every push to `main` and every PR. Node version comes from `.nvmrc` (used by CI and Netlify).
- Server tests (`npx nx test netlify`) mock the DB with the fake `sql` tag from `netlify/tests/fake-sql.ts` (records queries, answers by regex). Function specs live in `netlify/tests/`, never in `netlify/functions/` (every file there is deployed as a function).
- `npm run typecheck` — `tsc --noEmit` over every app/lib tsconfig and `netlify/tsconfig.json` (Netlify bundles functions with esbuild, without typechecking).
- `npm run knip` — unused files, exports and dependencies (`knip.json`; deps used only implicitly by Nx/jest/eslint are in `ignoreDependencies`).
- `BASE_URL=... node scripts/check-limits.mjs [--reports]` — checks API rate limits against a dev/staging deployment.

Env vars are listed in `.env.example` (copy to `.env` for local dev): S3 (`BUCKET`, `ACCESS_KEY_ID`, `SECRET_ACCESS_KEY`, region eu-central-1), `DATABASE_URL`, Turnstile (`NX_TURNSTILE_SITE_KEY` for the client, inlined at build time; `TURNSTILE_SECRET` for functions), `IP_HASH_SALT`, `MIN_UNIQUE_USERS`, `REPORT_HIDE_THRESHOLD`. DB schema is in `db/migrations/` (apply in order) and is applied manually.

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

- `synth-core.ts` owns the single `AudioContext`: `preGain → [$midNodes, e.g. filter] → fxIn → [fx chain] → fxOut → masterGain → masterLimiter → output → destination`. Other modules insert processing nodes through `addMidNode`. The limiter (`LIMITER`: a DynamicsCompressor with a hard knee at −4 dB, 250 ms release) is the last stage, after the master volume. The compressor overshoots its curve on the onset of dense unison chords struck at once (in Chrome ~2.5 dB at a 5 ms attack, ~4 dB at attack 0), which is why the threshold isn't higher: at master 100% and a 5 ms attack the peaks stay under 0 dBFS, at master above 100% or attack 0 the first ms of such a chord can go over (up to +1.8 dB). `output` takes back the makeup gain the compressor adds by spec (`limiterMakeupGain`), so below the threshold the sound passes at unity. The header analysers tap `output`.
- The `fx` model (`synth/fx/`) wires the FX rack between `fxIn` and `fxOut`. Effects are defined in `FX_REGISTRY` (`fx/effects/`, params and ranges from `FX_PARAMS` in `libs/preset-schema`). `createFxSlot` wraps each one: `mix` is an equal-power crossfade (0 only dry, 0.5 both at −3 dB, 1 only wet), bypass passes only the dry signal at full level. The chain is the added effects in `$order`; adding an effect type means a registry entry plus its preset schema.
- The reverb runs in an AudioWorklet: `reverb-dsp.ts` is the pure signal processing (16-line FDN, tested offline with impulse responses), `reverb.worklet.ts` the processor, `reverb.ts` creates the `AudioWorkletNode` once `loadWorklet` has added the module and posts param changes to it. A worklet module must not import `@waveform/ui-kit`, `@waveform/preset-schema` (zod) or anything touching `window`/`document`.
- A worklet effect builds on `createWorkletFx` (`fx/effects/worklet-fx.ts`: loading, input → node → output, `$status`, `retry`). Without AudioWorklet (http on a LAN IP, old Safari) or when its module fails, the app still works: the fx model keeps the effect out of the chain (it stays `added` in the snapshot), and the Effects list shows why under its name. An unsupported effect can't be added, an added one that can't be used can still be removed, a failed one loads again on Retry or when it is added. Until an effect is `ready` (also while it loads) its slot passes only the dry signal and is inactive.
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
- API (Netlify Functions v2, routed by `config.path`): `presets.mts` handles `/api/presets` (list/search with keyset cursors, save with Turnstile + 5/hour/IP), `/api/presets/top`, `/api/presets/:id` (GET, and PUT to overwrite), `/api/presets/:id/report`, `/api/presets/name-available?name=`; `usage.mts` collects play time. IPs are stored only as salted hashes.
- Scheduled: `recompute-scores.mts` (every 5 min, score = Σ sqrt(seconds) with 7-day half-life, only presets with ≥ MIN_UNIQUE_USERS) and `cleanup.mts` (daily, removes unqualified presets after 90 days).
- Client: `presets` rxModel (current preset, dirty flag via hash comparison, ◀ ▶ list, `?preset=<id>` loading), `usePresetUsageTracker` (counts seconds only while audio runs, tab is visible and a note was played in the last 30 s; flushes every 60 s and via `sendBeacon` on hide). UI: `PresetPanel` in the header, `PresetBrowser` and `SaveDialog` antd modals. Cmd/Ctrl+S opens the save dialog.
- Editing: on create the server returns a secret `editToken` (only its sha256 is stored in `presets.edit_token_hash`); the client keeps tokens in `localStorage.presetEditTokens`. `PUT /api/presets/:id` with the token overwrites sound and name (no Turnstile, 1 update per 5 s, 409 if the sound is another preset's). Presets created before migration 002 have no token and can't be edited.
- Names are unique case-insensitively with collapsed whitespace (`presetNameSchema` normalizes, `presets_name_key` is a unique index on `lower(name)`, migration 003). Hidden presets keep their names. The save dialog checks availability while typing; saving the same sound under a taken name still returns the existing preset (dedup by hash comes first).
- QWERTY notes are ignored while focus is in a text field (`keyboard-controller.ts`).

### Wavetables

- The Netlify functions (`netlify/functions/get-wavetables-list.ts`, `get-wavetable.ts`) list the wavetable files in an S3 bucket as a folder tree and serve them. The client fetches the list with react-query (`synth/oscillator/hooks/use-wavetables.ts`). The table itself is loaded by the oscillator model from `$waveTablePath` (last path element = S3 key, `synth/services/wavetable.ts`, cached per session, 2 retries), so it follows presets whatever screen is shown; `WaveSelector` only shows `$waveTableLoading`.
- The wavetable editor (`synth/wave-table-editor/`) also builds tables from manual drawing or from an uploaded audio file.

### Libs

Libs are imported through the path aliases in `tsconfig.base.json`: `@waveform/math`, `@waveform/rxjs-react`, `@waveform/ui-kit` and `@waveform/preset-schema`.

- `math`: number, vector and typed-array helpers, plus FFT-based wave utilities.
- `ui-kit`: styled-components UI widgets (charts, knobs/handles, piano, analysers, ADSR) and `theme`/`GlobalStyle`. The app also uses antd 5, themed in `app/index.tsx`.
