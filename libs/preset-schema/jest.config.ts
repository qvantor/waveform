module.exports = {
  displayName: 'preset-schema',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    // @noble/hashes is published as ESM only: its modules to CommonJS
    '/node_modules/@noble/.+\\.js$': [
      'babel-jest',
      { babelrc: false, configFile: false, plugins: ['@babel/plugin-transform-modules-commonjs'] },
    ],
    '^.+\\.[tj]sx?$': [
      'ts-jest',
      {
        tsconfig: '<rootDir>/tsconfig.spec.json',
      },
    ],
  },
  transformIgnorePatterns: ['/node_modules/(?!@noble/)'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx'],
  coverageDirectory: '../../coverage/libs/preset-schema',
};
