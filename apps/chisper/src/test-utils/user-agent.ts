// navigator.userAgentData of Chromium (jsdom has none: Safari and Firefox neither) and the interface of its count
// of dropouts (countsDropouts false: Chromium before 146); test-setup removes both after each test
export const setChromium = ({ mobile = false, countsDropouts = true } = {}) => {
  Object.defineProperty(navigator, 'userAgentData', {
    configurable: true,
    value: {
      brands: [
        { brand: 'Chromium', version: '155' },
        { brand: 'Not A Brand', version: '99' },
      ],
      mobile,
    },
  });
  if (countsDropouts) setPlaybackStats({ underrunEvents: true });
};

// AudioPlaybackStats of the browser and the playbackStats of its contexts (`stats`: the count a spec moves):
// underrunEvents false is an API whose field was renamed
export const setPlaybackStats = ({ underrunEvents, stats }: { underrunEvents: boolean; stats?: object }) => {
  class AudioPlaybackStats {}
  if (underrunEvents) Object.defineProperty(AudioPlaybackStats.prototype, 'underrunEvents', { get: () => 0 });
  Object.defineProperty(globalThis, 'AudioPlaybackStats', { configurable: true, value: AudioPlaybackStats });
  Object.defineProperty(AudioContext.prototype, 'playbackStats', {
    configurable: true,
    get: () => stats ?? new AudioPlaybackStats(),
  });
};
