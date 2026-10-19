import { TextDecoder } from 'util';

// jsdom has no TextDecoder, the paths of the charts need it
Object.assign(globalThis, { TextDecoder });
