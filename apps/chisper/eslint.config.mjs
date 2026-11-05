import baseConfig, { react } from '../../eslint.config.mjs';

// the React preset first, the workspace config over it (the order of the eslintrc it was converted from)
export default [...react, ...baseConfig];
