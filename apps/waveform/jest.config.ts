/* eslint-disable */
export default {
  displayName: 'waveform',
  preset: '../../jest.preset.js',
  transform: {
    '^(?!.*\\.(js|jsx|ts|tsx|css|json)$)': '@nrwl/react/plugins/jest',
    '^.+\\.[tj]sx?$': ['babel-jest', { presets: ['@nrwl/react/babel'] }],
  },
  // d3 and its deps are published as ESM only
  transformIgnorePatterns: ['/node_modules/(?!(d3-[^/]+|internmap|pretty-bytes)/)'],
  moduleNameMapper: { '^@marsidev/react-turnstile$': '<rootDir>/src/test-utils/turnstile-mock.tsx' },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx'],
  setupFilesAfterEnv: ['<rootDir>/src/test-setup.ts'],
  clearMocks: true,
  coverageDirectory: '../../coverage/apps/waveform',
};
