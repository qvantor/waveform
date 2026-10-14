import { FxStatus } from '../effects';

// why an effect can't be used, shown under its name in the effects list; none: it can
export const fxStatusMessage = (status: FxStatus) => {
  switch (status) {
    // browsers expose AudioWorklet only on https and localhost (e.g. not on http://<LAN IP>)
    case 'unsupported':
      return window.isSecureContext === false ? 'Needs HTTPS or localhost' : 'Not supported by this browser';
    case 'failed':
      return 'Failed to load';
    default:
      return undefined;
  }
};
