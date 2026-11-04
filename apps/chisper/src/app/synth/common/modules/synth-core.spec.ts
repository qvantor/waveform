import { createSynthCore, stopModels } from '../../../../test-utils/models';
import { setChromium, setPlaybackStats } from '../../../../test-utils/user-agent';
import { setVisibility } from '../../../../test-utils/visibility';
import { workletLoads } from '../../../../test-utils/worklet-loads';
import { keepNormalLatency, readAutoLatency, setLatencyMode } from '../latency/latency';

describe('synthCore', () => {
  it('connects preGain → fxIn → fxOut → masterGain → limiter → destination', () => {
    const [{ audioCtx, preGain, fxIn, fxOut, masterLimiter, masterGain, output }] = createSynthCore();
    expect(preGain.connect).toHaveBeenLastCalledWith(fxIn);
    expect(fxIn.connect).toHaveBeenCalledWith(fxOut);
    expect(fxOut.connect).toHaveBeenCalledWith(masterGain);
    expect(masterGain.connect).toHaveBeenCalledWith(masterLimiter.input);
    // the analysers tap what is played
    expect(output).toBe(masterLimiter.output);
    expect(output.connect).toHaveBeenCalledWith(audioCtx.destination);
    // the limiter is the last stage, the master volume goes through it
    expect(fxOut.connect).not.toHaveBeenCalledWith(masterLimiter.input);
    expect(masterGain.connect).not.toHaveBeenCalledWith(audioCtx.destination);
    expect(masterGain.connect).toHaveBeenCalledTimes(1);
  });

  it('the master volume starts at 0 dB', () => {
    const [{ preGain, masterGain, $masterGain }] = createSynthCore();
    expect(preGain.gain.value).toBe(1);
    expect(masterGain.gain.value).toBe(1);
    expect($masterGain.value).toBe(1);
  });

  it('destroys the limiter and the wavetable oscillator when it stops', () => {
    const [{ masterLimiter, wavetables }] = createSynthCore();
    const destroy = jest.spyOn(masterLimiter, 'destroy');
    const destroyWavetables = jest.spyOn(wavetables, 'destroy');
    stopModels();
    expect(destroy).toHaveBeenCalled();
    expect(destroyWavetables).toHaveBeenCalled();
  });

  it('loads the wavetable oscillator at its start', () => {
    const [{ audioCtx, wavetables }] = createSynthCore();
    expect(workletLoads(audioCtx.audioWorklet.addModule as jest.Mock, 'wavetable-osc')).toBe(1);
    expect(wavetables.$status.value).toBe('loading');
  });

  // each loads again only when it failed (a network down at the start fails both)
  it('retryAudio loads again the wavetable oscillator and the limiter', () => {
    const [{ masterLimiter, wavetables }, { retryAudio }] = createSynthCore();
    const retryLimiter = jest.spyOn(masterLimiter, 'retry');
    const retryWavetables = jest.spyOn(wavetables, 'retry');
    retryAudio();
    expect(retryWavetables).toHaveBeenCalledTimes(1);
    expect(retryLimiter).toHaveBeenCalledTimes(1);
  });

  it('setMasterGain updates the master gain', () => {
    const [{ masterGain }, { setMasterGain }] = createSynthCore();
    setMasterGain(0.3);
    expect(masterGain.gain.setValueAtTime).toHaveBeenLastCalledWith(0.3, 0);
    expect(masterGain.gain.value).toBeCloseTo(0.3);
  });

  it('mute fades the output after the fx out in its time, unmute opens it at once', () => {
    const [{ fxOut }, { mute, unmute }] = createSynthCore();
    const { gain } = fxOut;
    mute(0.02);
    expect(gain.cancelScheduledValues).toHaveBeenLastCalledWith(0);
    expect(gain.setValueAtTime).toHaveBeenLastCalledWith(1, 0);
    expect(gain.linearRampToValueAtTime).toHaveBeenLastCalledWith(0, 0.02);
    unmute();
    expect(gain.cancelScheduledValues).toHaveBeenCalledTimes(2);
    expect(gain.setValueAtTime).toHaveBeenCalledTimes(2);
    expect(gain.setValueAtTime).toHaveBeenLastCalledWith(1, 0);
    expect(gain.linearRampToValueAtTime).toHaveBeenCalledTimes(1);
  });

  it('connects the voices straight to the fx chain: the filter is in each voice', () => {
    const [{ preGain, fxIn }] = createSynthCore();
    expect(preGain.connect).toHaveBeenCalledWith(fxIn);
  });

  it.each(['pointerdown', 'touchend', 'keydown', 'visibilitychange'])(
    'resumes a suspended context on %s',
    (type) => {
      const [{ audioCtx }] = createSynthCore();
      const resume = jest.spyOn(audioCtx, 'resume');
      expect(audioCtx.state).toBe('suspended');

      document.dispatchEvent(new Event(type));

      expect(resume).toHaveBeenCalledTimes(1);
      expect(audioCtx.state).toBe('running');
    }
  );

  it('does not resume a running context or a hidden page', () => {
    const [{ audioCtx }] = createSynthCore();
    const resume = jest.spyOn(audioCtx, 'resume');

    setVisibility('hidden');
    document.dispatchEvent(new Event('pointerdown'));
    expect(resume).not.toHaveBeenCalled();

    setVisibility('visible');
    document.dispatchEvent(new Event('pointerdown'));
    document.dispatchEvent(new Event('pointerdown'));
    expect(resume).toHaveBeenCalledTimes(1);
  });

  it('switches the iOS audio session to playback before resuming', () => {
    const audioSession = { type: 'auto' };
    Object.defineProperty(navigator, 'audioSession', { configurable: true, value: audioSession });
    createSynthCore();
    document.dispatchEvent(new Event('pointerdown'));
    expect(audioSession.type).toBe('playback');
    delete (navigator as { audioSession?: unknown }).audioSession;
  });

  it('stops listening to gestures after stop', () => {
    const [{ audioCtx }] = createSynthCore();
    const resume = jest.spyOn(audioCtx, 'resume');
    stopModels();
    document.dispatchEvent(new Event('pointerdown'));
    expect(resume).not.toHaveBeenCalled();
  });

  describe('the latency', () => {
    // the options of the contexts created (the mock keeps none it shows)
    const created: (AudioContextOptions | undefined)[] = [];
    const Original = globalThis.AudioContext;
    // the count of dropouts the browser gives (playbackStats of Chrome)
    const stats = { underrunEvents: 0 };
    beforeEach(() => {
      created.length = 0;
      stats.underrunEvents = 0;
      class Recording extends Original {
        constructor(options?: AudioContextOptions) {
          super(options);
          created.push(options);
        }
      }
      Object.assign(globalThis, { AudioContext: Recording });
    });
    afterEach(() => {
      Object.assign(globalThis, { AudioContext: Original });
      jest.useRealTimers();
    });

    const withStats = () => setPlaybackStats({ underrunEvents: true, stats });
    // the browser refreshes its count, the core polls it a second later
    const dropout = () => {
      stats.underrunEvents++;
      jest.advanceTimersByTime(1000);
    };

    it('is left to a browser that ignores the hint', () => {
      const [{ $dropouts }] = createSynthCore();
      expect(created).toEqual([undefined]);
      expect($dropouts.value).toBeNull();
    });

    it('starts low in Chromium, normal once auto learnt it or chosen', () => {
      setChromium();
      createSynthCore();
      keepNormalLatency();
      createSynthCore();
      setLatencyMode('low');
      createSynthCore();
      setLatencyMode('normal');
      createSynthCore();
      expect(created).toEqual([
        { latencyHint: 0 },
        { latencyHint: 'interactive' },
        { latencyHint: 0 },
        { latencyHint: 'interactive' },
      ]);
    });

    it('is normal in auto where Chromium counts no dropouts, low chosen by hand', () => {
      setChromium({ countsDropouts: false });
      createSynthCore();
      setLatencyMode('low');
      const [{ $dropouts }] = createSynthCore();
      expect(created).toEqual([{ latencyHint: 'interactive' }, { latencyHint: 0 }]);
      expect($dropouts.value).toBeNull();
    });

    it('at low, warns of too many dropouts and auto keeps normal from the next start on', () => {
      setChromium();
      withStats();
      jest.useFakeTimers();
      const [{ $dropouts, $dropoutWarning }, { dismissDropoutWarning }] = createSynthCore();
      expect($dropouts.value).toBe(0);
      dropout();
      dropout();
      expect($dropouts.value).toBe(2);
      expect($dropoutWarning.value).toBe(false);
      expect(readAutoLatency()).toBe('low');
      dropout();
      expect($dropoutWarning.value).toBe(true);
      expect(readAutoLatency()).toBe('normal');
      dismissDropoutWarning();
      expect($dropoutWarning.value).toBe(false);
      dropout();
      expect($dropoutWarning.value).toBe(false);
    });

    it("at a low chosen by hand warns, the choice stays the user's", () => {
      setChromium();
      setLatencyMode('low');
      withStats();
      jest.useFakeTimers();
      const [{ $dropoutWarning }] = createSynthCore();
      dropout();
      dropout();
      dropout();
      expect($dropoutWarning.value).toBe(true);
      expect(readAutoLatency()).toBe('low');
    });

    it('does not count the dropouts of a preset switch: its work on the audio thread, the output silent', () => {
      setChromium();
      withStats();
      jest.useFakeTimers();
      const [{ $dropouts, $dropoutWarning }, { mute, unmute }] = createSynthCore();
      mute(0.02);
      dropout();
      dropout();
      unmute();
      // shown a second late
      dropout();
      expect($dropouts.value).toBe(3);
      dropout();
      dropout();
      expect($dropoutWarning.value).toBe(false);
      dropout();
      expect($dropoutWarning.value).toBe(true);
    });

    it('does not count dropouts at normal', () => {
      setChromium();
      setLatencyMode('normal');
      withStats();
      jest.useFakeTimers();
      const [{ $dropouts, $dropoutWarning }] = createSynthCore();
      expect($dropouts.value).toBeNull();
      dropout();
      dropout();
      dropout();
      expect($dropoutWarning.value).toBe(false);
    });
  });
});
