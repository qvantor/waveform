const { readFileSync } = require('fs');
const { join } = require('path');
const { NxAppWebpackPlugin } = require('@nx/webpack/app-plugin');
const { NxReactWebpackPlugin } = require('@nx/react/webpack-plugin');
const { DefinePlugin } = require('webpack');

// robots.txt at the root (the promo pages of apps/site join the folder after the build: scripts/site/merge.mjs);
// the worklet bundles of a configuration (`npm run worklets`)
const assetsOf = (worklets) => [
  './src/favicon.ico',
  './src/robots.txt',
  './src/assets',
  { input: worklets, glob: '*.js', output: 'assets/worklets' },
];

// the configurations of the build and the serve targets (project.json; the inferred tasks of @nx/webpack/plugin
// run webpack-cli with the configuration in NX_TASK_TARGET_CONFIGURATION), webpack-cli alone runs the defaults; the
// folder of each configuration in dist/apps is WAVEFORM_DIST of the env of the build in project.json, its outputs
const build = {
  default: {
    compiler: 'babel',
    outputPath: join('../../dist/apps', process.env.WAVEFORM_DIST ?? 'waveform'),
    index: './src/index.html',
    baseHref: '/',
    main: './src/main.tsx',
    polyfills: './src/polyfills.ts',
    tsConfig: './tsconfig.app.json',
    assets: assetsOf('../../tmp/worklets'),
  },
  development: { extractLicenses: false, optimization: false, sourceMap: true, vendorChunk: true },
  production: {
    optimization: true,
    outputHashing: 'all',
    sourceMap: false,
    namedChunks: false,
    extractLicenses: true,
    vendorChunk: false,
  },
  // the production build with the test hook of the perf suite (`npm run build:perf`) and its worklets
  perf: {
    optimization: true,
    outputHashing: 'all',
    sourceMap: false,
    namedChunks: false,
    extractLicenses: true,
    vendorChunk: false,
    assets: assetsOf('../../tmp/worklets-perf'),
    // from the root of the workspace (the plugin resolves them from there, its other paths from the project)
    fileReplacements: [
      {
        replace: 'apps/waveform/src/app/perf/perf-hook.tsx',
        with: 'apps/waveform/src/app/perf/perf-hook.perf.tsx',
      },
    ],
  },
};

const serve = {
  default: {
    port: 4200,
    hot: true,
    liveReload: false,
    headers: { 'Access-Control-Allow-Origin': '*' },
    historyApiFallback: {
      index: '/index.html',
      disableDotRule: true,
      htmlAcceptHeaders: ['text/html', 'application/xhtml+xml'],
    },
  },
  // the functions of `netlify dev` (`npm start`)
  development: { proxy: JSON.parse(readFileSync(join(__dirname, '../../proxy.conf.json'), 'utf8')) },
  production: { hot: false },
};

const configuration = process.env.NX_TASK_TARGET_CONFIGURATION || 'default';

module.exports = {
  // the build of before goes (the executor of Nx deleted it): Netlify publishes the folder
  output: { clean: true },
  devServer: { ...serve.default, ...serve[configuration] },
  plugins: [
    new NxAppWebpackPlugin({ ...build.default, ...build[configuration] }),
    new NxReactWebpackPlugin(),
    // __PERF__ (src/globals.d.ts): true in the perf configuration only, so the code of the perf suite is dead in
    // every other build and the minifier drops it
    new DefinePlugin({ __PERF__: JSON.stringify(configuration === 'perf') }),
  ],
};
