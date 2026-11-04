// The texts of the English page, the shape of the others (es.ts, de.ts: a missing or extra key is a type error).
// Only what the synth on main has and shows. The names of its knobs and sections stay in English in every
// language (Wave, Detune, Blend, Unison, ENV, LFO, VELO). `{name}` is filled in (`fill` of ./index.ts).
export const en = {
  meta: {
    title: 'Waveform: Free Online Wavetable Synth in Your Browser',
    description:
      'Free online wavetable synth: two oscillators with 8-voice unison, a filter, envelopes and LFOs on any knob, effects, MIDI and shareable presets. Nothing to install.',
    ogImageAlt: 'Waveform, a free wavetable synth in your browser',
  },
  nav: {
    openSynth: 'Open the synth',
  },
  hero: {
    h1: 'Waveform: free wavetable synth in your browser',
    lead: 'Two wavetable oscillators with up to 8-voice unison, a filter in every voice, three envelopes and four LFOs you drag onto any knob, distortion, delay and reverb. Free, nothing to install, no sign-up: plug in a MIDI keyboard or play the computer keyboard.',
    cta: 'Open the synth',
    listen: 'Hear it',
    platform: ['Free', 'No install, no sign-up', 'Chrome, Safari, Firefox', 'Desktop and phone'],
    screenshotAlt:
      'The Waveform synth playing chords: the waves of both oscillators, the dots of the envelopes and the LFO, the filter and the spectrum moving',
  },
  listen: {
    h2: 'Played on Waveform',
    lead: 'Short pieces played on presets of the site and recorded at the output of the synth, only their loudness evened out. Open a preset in Waveform and play it yourself.',
  },
  features: {
    wavetables: {
      h2: 'Wavetable oscillators',
      text: [
        'Two oscillators play wavetables of up to 256 frames from a library sorted into folders. The Wave knob moves through the table, and each change of frame fades in smoothly. Tables with a morph mark play expanded to 256 frames.',
        'Each oscillator has Oct, Semi and Fine, and Phase and Phase rand set where its voices start.',
      ],
    },
    unison: {
      h2: 'Unison',
      text: [
        'Up to 8 voices per oscillator. Detune spreads them in pitch, Blend sets the balance of the centre voices and the side ones (75% by default). The side voices alternate left and right, for a wide stereo sound.',
      ],
    },
    filter: {
      h2: 'A filter in every voice',
      text: [
        'A filter in every voice, after the oscillators: lowpass, highpass, bandpass, low shelf, high shelf, peaking, notch and allpass, with Cutoff, Res and Gain. Since each voice has its own, an envelope opens it on every note apart, chords too.',
      ],
    },
    modulation: {
      h2: 'Modulation',
      text: [
        'Three envelopes (ENV 1 is the volume) with a curve you bend on each stage, four LFOs with five shapes, shapes of your own drawn as points and ready Sidechain, Rhythm and Steps patterns, and the velocity of each note (VELO).',
        'Drag the tab of a source onto any knob to route it, unipolar or bipolar: up to 64 routes, 4 per knob. The LFOs, the times of the envelopes and the delay sync to the tempo, with triplets and dotted notes, or follow a MIDI Clock.',
      ],
    },
    effects: {
      h2: 'Effects',
      text: [
        'Distortion (soft or hard clip, oversampled), a delay (normal or ping-pong, with a band filter in its feedback and a Haas stereo offset) and an algorithmic reverb of 16 lines. Drag them into any order; each has its own Mix and presets. A limiter on the master keeps the output from clipping.',
      ],
    },
    playing: {
      h2: 'Playing',
      text: [
        'Play a MIDI keyboard (velocity and pitch bend), the computer keyboard (with an octave shift) or the on-screen piano and its pitch wheel. Up to 12 notes in Poly, or mono, with legato and portamento.',
      ],
    },
    editor: {
      h2: 'Wavetable editor',
      text: [
        'Draw a frame by hand, make a table from any audio file, or load a WAV wavetable as other wavetable synths write them (its clm marker is read).',
      ],
      screenshotAlt: 'The wavetable editor of Waveform: the frames of a table and the one being drawn',
    },
    presets: {
      h2: 'Community presets',
      text: [
        'Save a sound without signing up and share it as a link. Browse the presets of others under Popular or search them by name, and edit your own later from the same browser.',
      ],
      cta: 'Browse the presets',
    },
  },
  // the alternative texts of the parts of the synth beside the features
  figures: {
    wavetables:
      'Osc 1 of Waveform on frame 33 of the Spectral Gyro wavetable, with its Gain, Wave, Detune and Blend knobs',
    unison:
      'Detune held on Osc 1: the 8 voices of its unison drawn over a saw wave, the centre ones in green',
    filter: 'The filter of Waveform: the response of a resonant lowpass, with its Cutoff, Res and Gain knobs',
    modulation:
      'LFO 1 of Waveform drawing a Kick shape, with the tabs of LFO 1 to 4 and its Rate, Delay, Rise, Smooth and Phase knobs',
    effects:
      'The effects of Waveform: soft clip distortion, a ping-pong delay with its band filter, and the reverb',
    playing: 'Waveform on a phone: the synth above two rows of keys, the octave keys and the pitch wheel',
  },
  finale: {
    h2: 'Play it now',
    text: 'No download, no account: open the synth and play the computer keyboard, a MIDI keyboard or the keys on screen.',
    cta: 'Open the synth',
  },
  card: {
    categories: { bass: 'Bass', lead: 'Lead', pluck: 'Pluck', keys: 'Keys', pad: 'Pad', fx: 'FX' },
    open: 'Open in Waveform',
    play: 'Play {name}',
    seek: 'Position in {name}',
  },
  demos: {
    'biting-brass-keys':
      'Two 8-voice unisons of a Moog saw table an octave apart; LFO 1 moves both wave positions, ENV 2 opens the filter and the drive.',
    'rhodes-keys':
      'A Rhodes table in a 2-voice unison over a vibraphone table; ENV 2 on the cutoff, a slow LFO on the gains: tremolo.',
    'lo-fi-tape-keys':
      'A Wurlitzer table through soft distortion; two LFOs wobble a short delay: tape flutter.',
    'ufo-drone':
      'Envelopes sweep the wave position through two tables; the pitch bend dips a tone and comes back.',
    'harp-pluck':
      'Tables of real instruments: a harp and a nylon guitar an octave above, each with its own decay.',
    'noise-riser':
      '8 + 4 unison voices; ENV 3 spreads the detune as the riser opens, the bend lifts it two semitones at the end.',
    'acid-bass':
      'A 303 saw table; ENV 2 snaps the lowpass open on every note, slides between overlapping notes, a ping-pong delay.',
    helicopter: 'A custom LFO shape chops the volume; ENV 2 speeds the LFO up like a rotor spinning up.',
    'warehouse-lead':
      'LFO 1 moves the wave position, a fast LFO on Fine adds grit, ENV 3 closes the filter; distortion, delay and reverb.',
    'sonar-ping': 'Three pings answered by a long delay and reverb; ENV 2 moves the band of the echoes.',
    'zesty-drive-bass':
      'Distortion and a ping-pong delay on a mono bass; overlapping notes glide without a new attack.',
    theremin: 'Mono legato: every note glides into the next (150 ms portamento), one breath in the middle.',
    'sub-bass': 'An 808-style sub gliding between overlapping notes; best on headphones.',
  },
  faq: {
    h2: 'Questions',
    items: [
      { q: 'Is Waveform free?', a: 'Yes. It is free, with no sign-up.' },
      {
        q: 'Do I need to install anything?',
        a: 'No. Waveform runs in the browser: Chrome, Edge, Safari and Firefox, on a computer or a phone. Its sound engine is written in Rust and compiled to WebAssembly SIMD. Chrome on a computer has a low-latency mode.',
      },
      {
        q: 'Does it work with my MIDI keyboard?',
        a: 'Yes, in browsers with Web MIDI: Chrome, Edge, Opera and Firefox on a computer, Chrome on Android. Safari (and every browser on iPhone and iPad) has no Web MIDI: play the computer keyboard or the on-screen piano there. Waveform reads notes, velocity, pitch bend and MIDI Clock.',
      },
      {
        q: 'Can I import any wavetables?',
        a: 'Yes: any WAV wavetable of 2048-sample frames, as other wavetable synths write them (its clm marker is read). You can also make a table from a short audio file or draw one by hand.',
      },
      {
        q: 'Does it work on phones?',
        a: 'Yes. On a phone it has a layout of its own, with the keys on a screen of their own.',
      },
      {
        q: 'How do I share a sound?',
        a: 'Save it as a preset and copy its link: whoever opens the link hears the same sound.',
      },
      {
        q: 'Is the source code available?',
        a: 'Yes, on GitHub, under the PolyForm Noncommercial license.',
      },
    ],
  },
  // the featureList of the WebApplication (JSON-LD)
  featureList: [
    'Two wavetable oscillators, tables of up to 256 frames',
    'Unison of up to 8 voices per oscillator with Detune and Blend',
    'A filter in every voice, 8 types',
    'Three envelopes, four LFOs and velocity routed to any knob',
    'Tempo sync and MIDI Clock',
    'Distortion, delay and reverb in any order, a master limiter',
    'MIDI keyboards, pitch bend, the computer keyboard and an on-screen piano',
    'Poly and mono, legato and portamento',
    'Wavetable editor: drawing, audio files, the WAV wavetables of other synths',
    'Community presets shared by link',
  ],
  footer: {
    synth: 'Open the synth',
    source: 'Source on GitHub',
    follow: 'Follow',
    languages: 'Languages',
  },
  // the line of the Open Graph image (scripts/site/og.mjs)
  og: 'Free wavetable synth in your browser',
};

export type Messages = typeof en;
