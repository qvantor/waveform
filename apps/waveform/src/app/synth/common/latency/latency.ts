import { canStore, readStored, writeStored } from '../../../common/services';
import { canCountDropouts } from './dropouts';

// the latency of the output, chosen when the AudioContext is created (its latencyHint), so a change applies on
// a reload. Chromium on macOS: low 128 frames (baseLatency 2.67 ms + outputLatency 8 ms at 48 kHz), normal its
// 'interactive', 256 frames (5.33 + 16 ms); a hint between them rounds up to 256. Safari and Firefox ignore the
// hint, on them the context gets none. Auto starts low where the browser counts dropouts and keeps normal once
// they were counted there; where it counts none (Chromium before 146) auto is normal: nothing would leave low
export type LatencyMode = 'auto' | 'low' | 'normal';
export type Latency = 'low' | 'normal';

export const LATENCY_HINTS: Record<Latency, number | AudioContextLatencyCategory> = {
  low: 0,
  normal: 'interactive',
};

// localStorage: the machine decides, not the tab; where it keeps nothing (site data blocked) no mode is kept
// over the reload a change needs, nor what auto learnt: the latency is normal there
const MODE_KEY = 'latencyMode';
// what auto has learnt on this machine (none: low)
const AUTO_KEY = 'latencyAuto';

const isMode = (value: unknown): value is LatencyMode =>
  value === 'auto' || value === 'low' || value === 'normal';
const isLatency = (value: unknown): value is Latency => value === 'low' || value === 'normal';

interface UserAgentData {
  brands?: { brand: string }[];
  mobile?: boolean;
}

// Chromium on a desktop: the only engine that takes the hint (Safari and Firefox have no userAgentData; on
// Android the device's own buffer decides, not checked)
export const canChooseLatency = () => {
  const data = (navigator as Navigator & { userAgentData?: UserAgentData }).userAgentData;
  return Boolean(data?.brands?.some(({ brand }) => brand === 'Chromium') && !data.mobile);
};

export const readLatencyMode = () => readStored<LatencyMode>('localStorage', MODE_KEY, 'auto', isMode);

export const readAutoLatency = () => readStored<Latency>('localStorage', AUTO_KEY, 'low', isLatency);

// the storage keeps a choice (where it doesn't the latency is normal, the settings offer none)
export const canKeepLatency = () => canStore('localStorage');

// auto keeps normal from the next start on (dropouts at low)
export const keepNormalLatency = () => writeStored('localStorage', AUTO_KEY, 'normal');

// auto chosen again forgets what it learnt: it tries low again
export const setLatencyMode = (mode: LatencyMode) => {
  writeStored('localStorage', MODE_KEY, mode);
  if (mode === 'auto') writeStored('localStorage', AUTO_KEY, null);
};

// the latency auto picks: what it learnt where the browser counts dropouts, else normal
export const autoLatency = (): Latency => (canCountDropouts() ? readAutoLatency() : 'normal');

// the latency of the context created now; null: the browser picks its own (no hint)
export const resolveLatency = (): Latency | null => {
  if (!canChooseLatency()) return null;
  if (!canKeepLatency()) return 'normal';
  const mode = readLatencyMode();
  return mode === 'auto' ? autoLatency() : mode;
};

// a new latency needs a new AudioContext: the page reloads (the tab keeps the sound and the MIDI input)
export const reloadPage = () => window.location.reload();

// dropouts at low: normal from now on (auto keeps it already, a low chosen by hand becomes normal)
export const switchToNormalLatency = () => {
  if (readLatencyMode() === 'low') setLatencyMode('normal');
  reloadPage();
};
