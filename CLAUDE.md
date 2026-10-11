# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Waveform is an experimental browser wavetable synth (TypeScript + Web Audio API, React 18). It is an Nx 14 monorepo with one app (`apps/waveform`) and three libs (`libs/math`, `libs/rxjs-react`, `libs/ui-kit`), plus Netlify serverless functions in `netlify/`. Deployed to Netlify.

## Commands

- `npm start` — runs `netlify dev` (functions on :8888) and the Nx dev server (:4200) together. The dev server proxies `/.netlify/*` to :8888 (`proxy.conf.json`), so the wavetable browser only works when both run.
- `npm run client:start` — frontend only (`nx serve`); wavetable list/download requests will fail.
- `npm run build` — production build to `dist/apps/waveform`.
- `npx nx test <project>` — Jest for one project (`waveform`, `math`, `rxjs-react`, `ui-kit`). Single file: `npx nx test rxjs-react --testFile=rx-model.spec.tsx`.
- `npx nx lint <project>` — ESLint (`import/order` is an error).
- `npm run prettier:check` / `npm run prettier:fix` — Prettier (single quotes, JSX single quotes, print width 110).

Netlify functions need env vars `BUCKET`, `ACCESS_KEY_ID`, `SECRET_ACCESS_KEY` (S3, region eu-central-1).

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
- Dependency injection is done through provider nesting, so provider order matters. The tree in `apps/waveform/src/app/synth/index.tsx` defines it: InputController → SynthCore → AdsrEnvelope → Oscillator1/2 → MidiController → Filter → KeyboardController → Synth.

### Audio graph (apps/waveform/src/app/synth/common/modules)

- `synth-core.ts` owns the single `AudioContext`: `preGain → [$midNodes, e.g. filter] → masterLimiter (compressor) → masterGain → destination`. Other modules insert processing nodes through `addMidNode`.
- `oscillator.ts` holds a wavetable (`$waveTable`: an array of single-cycle waves), the selected frame, and unison/detune/octave settings. It converts the current wave to a `PeriodicWave` through `wave.realWithImag` (FFT, in `libs/math`).
- `synth.ts` handles voices: on input-controller note events it builds per-note unison oscillators plus an ADSR gain envelope. Polyphony, portamento and legato also live here.
- `input-controller.ts` is the shared note-on/off bus. The on-screen piano, `keyboard-controller.ts` (QWERTY) and `midi-controller.ts` (WebMIDI) all feed into it.

### Presets via URL

`app/plugins/snapshot.ts` creates one `searchParamsSnapshotPlugin`. Models that register it serialize their state to URL query params as `<modelName>-<key>=<json>`, and restore it on init. Cmd/Ctrl+S (`app-module.tsx`) calls `saveUrlSnapshot()` and copies the URL. Keys must be unique per model. When adding persisted state, extend that model's `modelToSnap`/`applySnap`.

### Wavetables

- The Netlify functions (`netlify/functions/get-wavetables-list.ts`, `get-wavetable.ts`) list the wavetable files in an S3 bucket as a folder tree and serve them. The client fetches them with react-query (`synth/oscillator/hooks/use-wavetable(s).ts`).
- The wavetable editor (`synth/wave-table-editor/`) also builds tables from manual drawing or from an uploaded audio file.
- `apps/waveform/src/app/wave-table-editor/` (outside `synth/`) looks like an older duplicate: the oscillator UI imports `synth/wave-table-editor`.

### Libs

Libs are imported through the path aliases in `tsconfig.base.json`: `@waveform/math`, `@waveform/rxjs-react` and `@waveform/ui-kit`.

- `math`: number, vector and typed-array helpers, plus FFT-based wave utilities.
- `ui-kit`: styled-components UI widgets (charts, knobs/handles, piano, analysers, ADSR) and `theme`/`GlobalStyle`. The app also uses antd 5, themed in `app/index.tsx`.
