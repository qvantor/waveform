module.exports = {
  displayName: 'ui-kit',
  preset: '../../jest.preset.js',
  transform: {
    '^.+\\.m?[tj]sx?$': ['babel-jest', { presets: ['@nx/react/babel'] }],
  },
  // d3 and its deps are published as ESM only
  transformIgnorePatterns: ['/node_modules/(?!(d3-[^/]+|internmap)/)'],
  // the CommonJS build of @ant-design/icons requires an ES module of @ant-design/colors: its CommonJS one
  moduleNameMapper: { '^@ant-design/colors/es/(.*)$': '@ant-design/colors/lib/$1' },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'mjs'],
  setupFiles: ['<rootDir>/src/test-setup.ts'],
  coverageDirectory: '../../coverage/libs/ui-kit',
};
