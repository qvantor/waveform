import type { Model, ModelFactory } from '@waveform/rxjs-react';

// models are started without React, the same way rxModelReact does it; test-setup stops them after each test,
// otherwise the shared snapshot plugin keeps the previous test's models.
// no app imports here, so test-setup doesn't load the synth modules for every spec
const running: Array<() => void> = [];

export const initModel = <M extends Record<string | number, unknown>, A, I>(
  factory: ModelFactory<M, A, I>,
  name: string,
  initial: I
): Model<M, A> => {
  const [model, actions, { stop }] = factory.init(name, initial);
  running.push(stop);
  return [model, actions];
};

export const stopModels = () =>
  running
    .splice(0)
    .reverse()
    .forEach((stop) => stop());
