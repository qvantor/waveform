// how many times the worklet module `name` (assets/worklets/<name>.js) was added: the synth core adds the
// limiter module too
export const workletLoads = (addModule: jest.Mock, name: string) =>
  addModule.mock.calls.filter(([url]) => String(url).endsWith(`/${name}.js`)).length;
