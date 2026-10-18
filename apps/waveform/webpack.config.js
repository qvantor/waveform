const reactConfig = require('@nrwl/react/plugins/webpack');

// the React config of Nx, and __PERF__ (src/globals.d.ts): true in the perf configuration only, so the code of
// the perf suite is dead in every other build and the minifier drops it. Its DefinePlugin is the class of the
// one Nx adds (the env of NX_* vars): the webpack of Nx, not a second copy
module.exports = (config, { configuration }) => {
  const result = reactConfig(config);
  const nxDefine = result.plugins.find((plugin) => plugin.constructor.name === 'DefinePlugin');
  if (!nxDefine)
    throw new Error('webpack.config.js: no DefinePlugin in the config of Nx to define __PERF__ with');
  result.plugins.push(new nxDefine.constructor({ __PERF__: JSON.stringify(configuration === 'perf') }));
  return result;
};
