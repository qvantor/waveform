/* eslint-disable */
export default {
  displayName: 'netlify',
  // function specs live in tests/: Netlify deploys every file in functions/ as a function
  preset: '../jest.preset.js',
  testEnvironment: 'node',
  // babel only strips types and converts to CommonJS (ts-jest emits ESM for .mts),
  // types are checked by `npm run typecheck`
  transform: {
    '^.+\\.m?[tj]s$': [
      'babel-jest',
      {
        babelrc: false,
        configFile: false,
        presets: ['@babel/preset-typescript'],
        plugins: ['@babel/plugin-transform-modules-commonjs'],
      },
    ],
  },
  // specs import functions as `./presets.mjs`, TypeScript maps it to presets.mts
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.mjs$': '$1',
  },
  moduleFileExtensions: ['ts', 'mts', 'js', 'json'],
  coverageDirectory: '../coverage/netlify',
};
