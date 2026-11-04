import astro from 'eslint-plugin-astro';
import baseConfig from '../../eslint.config.mjs';

// the workspace config over the TS of the pages, the recommended rules of eslint-plugin-astro for .astro files
export default [...baseConfig, ...astro.configs['flat/recommended'], { ignores: ['.astro'] }];
