/* eslint-disable */
export default {
  displayName: 'waveform',
  preset: '../../jest.preset.js',
  transform: {
    // the bytes of a wasm core (a wasm worklet bundle imports them)
    '\\.wasm$': '<rootDir>/wasm-transform.js',
    '^(?!.*\\.(js|jsx|ts|tsx|css|json)$)': '@nrwl/react/plugins/jest',
    // x ** y as Math.pow(x, y): the parity specs give the TS cores the Math of the wasm ones (test-utils/js-math.ts)
    '^.+\\.[tj]sx?$': [
      'babel-jest',
      { presets: ['@nrwl/react/babel'], plugins: ['@babel/plugin-transform-exponentiation-operator'] },
    ],
  },
  // d3 and its deps are published as ESM only
  transformIgnorePatterns: ['/node_modules/(?!(d3-[^/]+|internmap|pretty-bytes)/)'],
  moduleNameMapper: {
    '^@marsidev/react-turnstile$': '<rootDir>/src/test-utils/turnstile-mock.tsx',
    // the wasm cores with their counters (`npm run wasm`), as the perf build of the app
    '^@waveform/wasm/(.*)$': '<rootDir>/../../tmp/wasm-perf/$1',
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx'],
  setupFilesAfterEnv: ['<rootDir>/src/test-setup.ts'],
  // the specs test the code of the perf build too (src/globals.d.ts)
  globals: { __PERF__: true },
  clearMocks: true,
  coverageDirectory: '../../coverage/apps/waveform',
};
