// The texts of the English page, the shape of the others (es.ts, de.ts: a missing or extra key is a type error).
// Only what the synth on main has and shows. The names of its knobs and sections stay in English in every
// language (Wave, Detune, Blend, Unison, ENV, LFO, VELO). `{name}` is filled in (`fill` of ./index.ts).
export const en = {
  meta: {
    title: 'Waveform: Free Online Wavetable Synth in Your Browser',
    description:
      'Free online wavetable synth: two oscillators with 8-voice unison, a filter, envelopes and LFOs on any knob, effects, MIDI and shareable presets. Nothing to install.',
    ogImageAlt: 'Waveform, a free wavetable synth',
  },
  // the key into the synth: the header, the first section, the last one, the footer
  openSynth: 'Open the synth',
  hero: {
    h1: 'Waveform: free wavetable synth',
    // the first sentence under the title, what it has under the synth playing; **words** stand out (`marks` of
    // ./index.ts)
    lead: 'Waveform is a **free wavetable synthesizer** that runs in the browser on a computer, a Chromebook or a phone: **no download, no account**.',
    details:
      '**Two wavetable oscillators** with **supersaw unison** of up to 8 voices, a filter in every voice, three envelopes and four LFOs you drag onto **any knob**, distortion, delay and reverb. Plug in a MIDI keyboard or play the computer keyboard.',
    listen: 'Hear it',
    screenshotAlt:
      'The Waveform synth playing chords: the waves of both oscillators, the dots of the envelopes and the LFO, the filter and the spectrum moving',
  },
  listen: {
    h2: 'Free synth presets: hear them',
    lead: 'Every sound below is a free preset of the Waveform wavetable synth, recorded straight from its output: basses, leads, plucks, keys and FX. Open one in a click, play it on your keyboard, turn any knob and save your own version, no sign-up needed.',
  },
  // what wavetable synthesis is, after the clips, before the features: a card each for how it works, the music it
  // makes and where it plays
  synthesis: {
    h2: 'What is a wavetable synth?',
    table: {
      h3: 'How wavetable synthesis works',
      text: 'A wavetable synth plays a table of single-cycle waves (frames) instead of one fixed wave. Moving through the table changes the tone as a note plays: from a soft sine to a bright saw, a vocal formant or a metallic growl. It is the sound of many modern basses, leads and pads.',
      alt: 'A wavetable: its frames stacked from a sine (frame 1) to a saw (frame 256), the Wave knob on the frame that plays',
    },
    styles: {
      h3: 'Any style of electronic music',
      text: 'With Waveform you can make music in any electronic style and beyond, from club tracks to film and game scores. Its basses, leads, pads, plucks, keys and effects fit wherever a synth does.',
      genres: [
        'House',
        'Techno',
        'Trance',
        'Drum and bass',
        'Dubstep',
        'Synthwave',
        'Lo-fi hip hop',
        'Ambient',
        'Trap',
        'Pop',
        'Hip hop',
        'EDM',
      ],
    },
    online: {
      h3: 'Free and online, nothing to install',
      text: 'Waveform is a free online wavetable synth: the same kind of synthesis as desktop wavetable synths, with nothing to install. Open it, pick a table and turn Wave to hear the frames change.',
    },
  },
  features: {
    wavetables: {
      h2: 'Wavetable oscillators with 256-frame tables',
      text: [
        'Make a sound change as it plays: the Wave knob moves through a wavetable, and the tone moves with it. Two oscillators play tables of up to 256 frames from a library sorted into folders, each change of frame fading in smoothly. Tables with a morph mark play expanded to 256 frames.',
        'Each oscillator has Oct, Semi and Fine, and Phase and Phase rand set where its voices start.',
      ],
    },
    unison: {
      h2: 'Supersaw unison: up to 8 voices',
      text: [
        'Get the wide, thick supersaw of trance and EDM leads. Up to 8 voices per oscillator: Detune spreads them in pitch, Blend sets the balance of the centre voices and the side ones (75% by default), and the side voices alternate left and right for a wide stereo sound.',
      ],
    },
    filter: {
      h2: 'A filter in every voice: 8 types',
      text: [
        'Every note gets its own filter, so an envelope sweeps each note of a chord on its own, as on analog polysynths. Eight types: lowpass, highpass, bandpass, low shelf, high shelf, peaking, notch and allpass, with Cutoff, Res and Gain.',
      ],
    },
    modulation: {
      h2: 'Drag-and-drop modulation: envelopes, LFOs, velocity',
      text: [
        'Make any knob move: drag the tab of a source onto it, unipolar or bipolar, with up to 64 routes, 4 per knob. The sources: three envelopes (ENV 1 is the volume) with a curve you bend on each stage, four LFOs with five shapes, shapes of your own drawn as points and ready Sidechain, Rhythm and Steps patterns, and the velocity of each note (VELO).',
        'The LFOs, the times of the envelopes and the delay sync to the tempo, with triplets and dotted notes, or follow a MIDI Clock.',
      ],
    },
    effects: {
      h2: 'Effects: distortion, delay, reverb',
      text: [
        'Finish the sound inside the synth: distortion (soft or hard clip, oversampled), a delay (normal or ping-pong, with a band filter in its feedback and a Haas stereo offset) and an algorithmic reverb of 16 lines. Drag them into any order; each has its own Mix and presets. A limiter on the master keeps the output from clipping.',
      ],
    },
    playing: {
      h2: 'Play with MIDI, the computer keyboard or touch',
      text: [
        'Play it like an instrument: a MIDI keyboard (velocity and pitch bend), the computer keyboard (with an octave shift) or the on-screen piano and its pitch wheel, on a touch screen too. Up to 12 notes in Poly, or mono, with legato and portamento.',
      ],
    },
    editor: {
      h2: 'Wavetable editor: draw or import tables',
      text: [
        'Make wavetables of your own: draw a frame by hand, turn any audio file into a table, or load the WAV wavetables you already have from other synths and wavetable packs (their clm marker is read).',
      ],
      screenshotAlt: 'The wavetable editor of Waveform: the frames of a table and the one being drawn',
    },
    presets: {
      h2: 'Free community presets, shared by link',
      text: [
        'Save a sound without signing up and share it as a link: whoever opens it hears the same sound. Browse the presets of others under Popular or search them by name, and edit your own later from the same browser.',
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
    h2: 'Play the free online synth now',
    text: 'No download, no account: open Waveform and play the computer keyboard, a MIDI keyboard or the keys on screen.',
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
      'A Wurlitzer table through soft distortion; two LFOs wobble a short delay: the tape flutter of lo-fi hip hop.',
    'ufo-drone':
      'Envelopes sweep the wave position through two tables, the pitch bend dips a tone and comes back: an ambient sci-fi drone.',
    'harp-pluck':
      'Tables of real instruments: a harp and a nylon guitar an octave above, each with its own decay.',
    'noise-riser':
      '8 + 4 unison voices for EDM build-ups; ENV 3 spreads the detune as the riser opens, the bend lifts it two semitones at the end.',
    'acid-bass':
      'A 303 saw table for acid house and techno; ENV 2 snaps the lowpass open on every note, slides between overlapping notes, a ping-pong delay.',
    helicopter: 'A custom LFO shape chops the volume; ENV 2 speeds the LFO up like a rotor spinning up.',
    'warehouse-lead':
      'A techno lead: LFO 1 moves the wave position, a fast LFO on Fine adds grit, ENV 3 closes the filter; distortion, delay and reverb.',
    'sonar-ping': 'Three pings answered by a long delay and reverb; ENV 2 moves the band of the echoes.',
    'zesty-drive-bass':
      'Distortion and a ping-pong delay on a mono bass; overlapping notes glide without a new attack.',
    theremin: 'Mono legato: every note glides into the next (150 ms portamento), one breath in the middle.',
    'sub-bass':
      'An 808-style sub for trap and hip hop, gliding between overlapping notes; best on headphones.',
  },
  faq: {
    h2: 'FAQ: the online wavetable synth',
    items: [
      { q: 'Is Waveform free?', a: 'Yes. Waveform is free, with no sign-up.' },
      {
        q: 'Do I need to install anything?',
        a: 'No. Waveform runs in the browser: Chrome, Edge, Safari and Firefox, on a computer or a phone. Its sound engine is written in Rust and compiled to WebAssembly SIMD. Chrome on a computer has a low-latency mode.',
      },
      {
        q: 'Does Waveform work on a Chromebook, iPad or iPhone?',
        a: "Yes. On a Chromebook, Waveform runs in Chrome as on any computer, MIDI keyboards included, so it works on school and work computers where you can't install software. On iPhone and iPad it runs in Safari (iOS 16.4 or later), on Android in Chrome; on a phone it has a layout of its own, with the keys on a screen of their own. iOS has no Web MIDI: play the keys on screen there.",
      },
      {
        q: 'Does Waveform work with my MIDI keyboard?',
        a: 'Yes. Waveform works with MIDI keyboards in browsers with Web MIDI: Chrome, Edge, Opera and Firefox on a computer, Chrome on Android. Safari (and every browser on iPhone and iPad) has no Web MIDI: play the computer keyboard or the on-screen piano there. Waveform reads notes, velocity, pitch bend and MIDI Clock.',
      },
      {
        q: 'Is Waveform good for learning synthesis?',
        a: 'Yes. Waveform shows what each knob does as you turn it: the wave each oscillator plays, the voices of the unison while Detune is held, the response of the filter, the envelopes and LFOs as curves with a dot of the note playing. Open any preset to see how its sound is made, change it and hear the difference.',
      },
      {
        q: 'Can I import any wavetables?',
        a: 'Yes. Waveform loads any WAV wavetable of 2048-sample frames, from other wavetable synths or wavetable packs (its clm marker is read). You can also make a table from a short audio file or draw one by hand.',
      },
      {
        q: 'Can I use the sounds in my tracks?',
        a: 'Yes. The sounds you play on Waveform are yours to use in your tracks, commercial releases included.',
      },
      {
        q: 'How do I share a sound?',
        a: 'Save it as a preset in Waveform and copy its link: whoever opens the link hears the same sound.',
      },
      {
        q: 'Is the source code available?',
        a: 'Yes. The source code of Waveform is on GitHub, under the PolyForm Noncommercial license.',
      },
    ],
  },
  // the featureList of the WebApplication (JSON-LD)
  featureList: [
    'Two wavetable oscillators, tables of up to 256 frames',
    'Supersaw unison of up to 8 voices per oscillator with Detune and Blend',
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
    source: 'Source on GitHub',
    follow: 'Follow',
    languages: 'Languages',
  },
  // the line of the Open Graph image (scripts/site/og.mjs)
  og: 'Free wavetable synth',
};

export type Messages = typeof en;
