/* eslint-disable */
export default {
  displayName: 'ui-kit',
  preset: '../../jest.preset.js',
  transform: {
    '^.+\\.[tj]sx?$': ['babel-jest', { presets: ['@nrwl/react/babel'] }],
  },
  // d3 and its deps are published as ESM only
  transformIgnorePatterns: ['/node_modules/(?!(d3-[^/]+|internmap)/)'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx'],
  setupFiles: ['<rootDir>/src/test-setup.ts'],
  coverageDirectory: '../../coverage/libs/ui-kit',
};
