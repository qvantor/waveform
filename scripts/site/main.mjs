// Whether a module is the script node runs (`isMain(import.meta)`), not one imported by another script or a test.
// Node takes the path of the main module through its symlinks, argv keeps the one it was given: compared as they
// are, a script called by a link to it (a checkout under a linked folder) would do nothing and exit 0.
import { realpathSync } from 'node:fs';

export const isMain = (meta) => Boolean(process.argv[1]) && realpathSync(process.argv[1]) === meta.filename;
