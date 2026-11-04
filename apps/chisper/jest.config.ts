const { join } = require('path');

module.exports = {
  displayName: 'chisper',
  preset: '../../jest.preset.js',
  transform: {
    '^(?!.*\\.(js|jsx|mjs|ts|tsx|css|json)$)': '@nx/react/plugins/jest',
    // x ** y as Math.pow(x, y): the parity specs give the TS cores the Math of the wasm ones (test-utils/js-math.ts);
    // the bytes of a wasm core, those of its perf build (its counters, as the perf build of the app), where a wasm
    // worklet bundle imports them
    '^.+\\.m?[tj]sx?$': [
      'babel-jest',
      {
        presets: ['@nx/react/babel'],
        plugins: ['@babel/plugin-transform-exponentiation-operator', join(__dirname, 'wasm-babel-plugin.js')],
      },
    ],
  },
  // d3 and its deps, pretty-bytes and @noble/hashes are published as ESM only
  transformIgnorePatterns: ['/node_modules/(?!(d3-[^/]+|internmap|pretty-bytes|@noble)/)'],
  moduleNameMapper: {
    '^@marsidev/react-turnstile$': '<rootDir>/src/test-utils/turnstile-mock.tsx',
    // the CommonJS build of @ant-design/icons requires an ES module of @ant-design/colors: its CommonJS one
    '^@ant-design/colors/es/(.*)$': '@ant-design/colors/lib/$1',
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'mjs'],
  setupFilesAfterEnv: ['<rootDir>/src/test-setup.ts'],
  // the specs test the code of the perf build too (src/globals.d.ts)
  globals: { __PERF__: true },
  clearMocks: true,
  coverageDirectory: '../../coverage/apps/chisper',
};
