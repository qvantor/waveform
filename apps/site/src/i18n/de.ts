import type { Messages } from './en';

// written for the searches in German (Wavetable Synthesizer online kostenlos, Synthesizer im Browser), not
// translated word for word; the knobs and sections keep the names of the synth
export const de: Messages = {
  meta: {
    title: 'Waveform: Wavetable-Synthesizer online & kostenlos',
    description:
      'Kostenloser Online-Synthesizer im Browser: zwei Wavetable-Oszillatoren mit 8-stimmigem Unisono, Filter, Hüllkurven und LFOs auf jedem Regler, Effekte und MIDI. Ohne Installation.',
    ogImageAlt: 'Waveform, ein kostenloser Wavetable-Synthesizer im Browser',
  },
  openSynth: 'Synthesizer öffnen',
  hero: {
    h1: 'Waveform: kostenloser Wavetable-Synthesizer im Browser',
    lead: 'Zwei Wavetable-Oszillatoren mit bis zu 8-stimmigem Unisono, ein Filter in jeder Stimme, drei Hüllkurven und vier LFOs, die du auf jeden Regler ziehst, Distortion, Delay und Reverb. Kostenlos, ohne Installation und ohne Anmeldung: Schließ ein MIDI-Keyboard an oder spiel auf der Computertastatur.',
    listen: 'Reinhören',
    platform: [
      'Kostenlos',
      'Ohne Installation und Anmeldung',
      'Chrome, Safari, Firefox',
      'Computer und Smartphone',
    ],
    screenshotAlt:
      'Der Synthesizer Waveform spielt Akkorde: Die Wellen beider Oszillatoren, die Punkte der Hüllkurven und des LFO, das Filter und das Spektrum bewegen sich',
  },
  listen: {
    h2: 'Gespielt auf Waveform',
    lead: 'Kurze Stücke, gespielt mit Presets der Seite und direkt am Ausgang des Synthesizers aufgenommen, nur die Lautstärke angeglichen. Öffne ein Preset in Waveform und spiel es selbst.',
  },
  features: {
    wavetables: {
      h2: 'Wavetable-Oszillatoren',
      text: [
        'Zwei Oszillatoren spielen Wavetables mit bis zu 256 Frames aus einer nach Ordnern sortierten Bibliothek. Der Regler Wave fährt durch die Tabelle, und jeder Wechsel des Frames wird weich eingeblendet. Tabellen mit Morph-Markierung werden auf 256 Frames erweitert.',
        'Jeder Oszillator hat Oct, Semi und Fine, und Phase und Phase rand legen fest, wo seine Stimmen beginnen.',
      ],
    },
    unison: {
      h2: 'Unisono',
      text: [
        'Bis zu 8 Stimmen pro Oszillator. Detune verstimmt sie gegeneinander, Blend regelt das Verhältnis der mittleren zu den äußeren Stimmen (Standard 75 %). Die äußeren Stimmen wechseln zwischen links und rechts: ein breiter Stereoklang.',
      ],
    },
    filter: {
      h2: 'Ein Filter in jeder Stimme',
      text: [
        'Ein Filter in jeder Stimme, nach den Oszillatoren: Lowpass (Tiefpass), Highpass (Hochpass), Bandpass, Low Shelf, High Shelf, Peaking, Notch und Allpass, mit Cutoff, Res und Gain. Weil jede Stimme ihr eigenes hat, öffnet eine Hüllkurve es bei jeder Note für sich, auch in Akkorden.',
      ],
    },
    modulation: {
      h2: 'Modulation',
      text: [
        'Drei Hüllkurven (ENV 1 ist die Lautstärke) mit einer Kurve, die du in jeder Phase biegst, vier LFOs mit fünf Formen, eigene Formen aus Punkten und fertige Muster Sidechain, Rhythm und Steps, dazu die Anschlagstärke jeder Note (VELO).',
        'Zieh den Tab einer Quelle auf einen beliebigen Regler, unipolar oder bipolar: bis zu 64 Routen, 4 pro Regler. Die LFOs, die Zeiten der Hüllkurven und das Delay laufen synchron zum Tempo, mit Triolen und punktierten Noten, oder folgen einer MIDI Clock.',
      ],
    },
    effects: {
      h2: 'Effekte',
      text: [
        'Distortion (Soft oder Hard Clip, mit Oversampling), ein Delay (normal oder Ping-Pong, mit Bandfilter im Feedback und Haas-Stereoversatz) und ein algorithmischer Reverb mit 16 Leitungen. Die Reihenfolge änderst du per Drag & Drop, jeder Effekt hat seinen Mix und eigene Presets. Ein Limiter auf dem Master verhindert Übersteuerung.',
      ],
    },
    playing: {
      h2: 'Spielen',
      text: [
        'Spiel auf einem MIDI-Keyboard (Anschlagstärke und Pitch Bend), der Computertastatur (mit Oktavumschaltung) oder dem Bildschirmklavier mit seinem Pitch-Rad. Bis zu 12 Noten in Poly, oder Mono, mit Legato und Portamento.',
      ],
    },
    editor: {
      h2: 'Wavetable-Editor',
      text: [
        'Zeichne einen Frame von Hand, mach eine Tabelle aus jeder Audiodatei oder lade eine WAV-Wavetable, wie andere Wavetable-Synthesizer sie schreiben (ihre clm-Markierung wird gelesen).',
      ],
      screenshotAlt: 'Der Wavetable-Editor von Waveform: die Frames einer Tabelle und der gerade gezeichnete',
    },
    presets: {
      h2: 'Presets der Community',
      text: [
        'Speichere einen Sound ohne Anmeldung und teile ihn per Link. Stöbere unter Popular in den Presets anderer oder suche sie nach Namen, und bearbeite deine eigenen später im selben Browser.',
      ],
      cta: 'Presets ansehen',
    },
  },
  figures: {
    wavetables:
      'Osc 1 von Waveform auf Frame 33 der Wavetable Spectral Gyro, mit den Reglern Gain, Wave, Detune und Blend',
    unison:
      'Detune gehalten auf Osc 1: die 8 Stimmen des Unisonos über einer Sägezahnwelle, die mittleren in Grün',
    filter:
      'Das Filter von Waveform: die Kurve eines resonanten Lowpass, mit den Reglern Cutoff, Res und Gain',
    modulation:
      'LFO 1 von Waveform mit der Form Kick, den Tabs LFO 1 bis 4 und den Reglern Rate, Delay, Rise, Smooth und Phase',
    effects:
      'Die Effekte von Waveform: Soft-Clip-Distortion, ein Ping-Pong-Delay mit Bandfilter und der Reverb',
    playing:
      'Waveform auf dem Smartphone: der Synthesizer über zwei Tastenreihen, die Oktavtasten und das Pitch-Rad',
  },
  finale: {
    h2: 'Jetzt spielen',
    text: 'Kein Download, kein Konto: Öffne den Synthesizer und spiel auf der Computertastatur, einem MIDI-Keyboard oder den Tasten auf dem Bildschirm.',
  },
  card: {
    categories: { bass: 'Bass', lead: 'Lead', pluck: 'Pluck', keys: 'Keys', pad: 'Pad', fx: 'FX' },
    open: 'In Waveform öffnen',
    play: '{name} abspielen',
    seek: 'Position in {name}',
  },
  demos: {
    'biting-brass-keys':
      'Zwei 8-stimmige Unisonos einer Moog-Sägezahntabelle im Oktavabstand; LFO 1 bewegt beide Wave-Positionen, ENV 2 öffnet Filter und Drive.',
    'rhodes-keys':
      'Eine Rhodes-Tabelle im 2-stimmigen Unisono über einer Vibraphon-Tabelle; ENV 2 auf dem Cutoff, ein langsamer LFO auf den Pegeln: Tremolo.',
    'lo-fi-tape-keys':
      'Eine Wurlitzer-Tabelle durch weiche Distortion; zwei LFOs lassen ein kurzes Delay schwanken: Bandflattern.',
    'ufo-drone':
      'Hüllkurven fahren die Wave-Position durch zwei Tabellen; der Pitch Bend sinkt um einen Ganzton und kehrt zurück.',
    'harp-pluck':
      'Tabellen echter Instrumente: eine Harfe und eine Nylongitarre eine Oktave höher, jede mit eigenem Decay.',
    'noise-riser':
      '8 + 4 Unisono-Stimmen; ENV 3 fächert das Detune auf, während sich der Riser öffnet, der Bend hebt ihn am Ende um zwei Halbtöne.',
    'acid-bass':
      'Eine 303-Sägezahntabelle; ENV 2 reißt den Lowpass bei jeder Note auf, Slides zwischen überlappenden Noten, ein Ping-Pong-Delay.',
    helicopter:
      'Eine eigene LFO-Form zerhackt die Lautstärke; ENV 2 beschleunigt den LFO wie einen anlaufenden Rotor.',
    'warehouse-lead':
      'LFO 1 bewegt die Wave-Position, ein schneller LFO auf Fine macht ihn rau, ENV 3 schließt das Filter; Distortion, Delay und Reverb.',
    'sonar-ping':
      'Drei Pings, beantwortet von einem langen Delay und Reverb; ENV 2 verschiebt das Band der Echos.',
    'zesty-drive-bass':
      'Distortion und Ping-Pong-Delay auf einem Mono-Bass; überlappende Noten gleiten ohne neuen Anschlag.',
    theremin: 'Mono-Legato: Jede Note gleitet in die nächste (150 ms Portamento), in der Mitte ein Atemzug.',
    'sub-bass': 'Ein Sub im 808-Stil, der zwischen überlappenden Noten gleitet; am besten mit Kopfhörern.',
  },
  faq: {
    h2: 'Häufige Fragen',
    items: [
      { q: 'Ist Waveform kostenlos?', a: 'Ja. Waveform ist kostenlos und ohne Anmeldung.' },
      {
        q: 'Muss ich etwas installieren?',
        a: 'Nein. Waveform läuft im Browser: Chrome, Edge, Safari und Firefox, auf dem Computer oder dem Smartphone. Die Klangerzeugung ist in Rust geschrieben und nach WebAssembly SIMD kompiliert. Chrome auf dem Computer hat einen Modus mit niedriger Latenz.',
      },
      {
        q: 'Funktioniert es mit meinem MIDI-Keyboard?',
        a: 'Ja, in Browsern mit Web MIDI: Chrome, Edge, Opera und Firefox auf dem Computer, Chrome auf Android. Safari (und jeder Browser auf iPhone und iPad) hat kein Web MIDI: Dort spielst du auf der Computertastatur oder dem Bildschirmklavier. Waveform liest Noten, Anschlagstärke, Pitch Bend und MIDI Clock.',
      },
      {
        q: 'Kann ich beliebige Wavetables importieren?',
        a: 'Ja: jede WAV-Wavetable mit Frames von 2048 Samples, wie andere Wavetable-Synthesizer sie schreiben (ihre clm-Markierung wird gelesen). Eine Tabelle lässt sich auch aus einer kurzen Audiodatei machen oder von Hand zeichnen.',
      },
      {
        q: 'Funktioniert es auf dem Smartphone?',
        a: 'Ja. Auf dem Smartphone hat es ein eigenes Layout, mit den Tasten auf einem eigenen Bildschirm.',
      },
      {
        q: 'Wie teile ich einen Sound?',
        a: 'Speichere ihn als Preset und kopiere den Link: Wer ihn öffnet, hört denselben Sound.',
      },
      {
        q: 'Ist der Quellcode verfügbar?',
        a: 'Ja, auf GitHub, unter der Lizenz PolyForm Noncommercial.',
      },
    ],
  },
  featureList: [
    'Zwei Wavetable-Oszillatoren, Tabellen mit bis zu 256 Frames',
    'Unisono mit bis zu 8 Stimmen pro Oszillator, Detune und Blend',
    'Ein Filter in jeder Stimme, 8 Typen',
    'Drei Hüllkurven, vier LFOs und die Anschlagstärke auf jedem Regler',
    'Tempo-Sync und MIDI Clock',
    'Distortion, Delay und Reverb in beliebiger Reihenfolge, Limiter auf dem Master',
    'MIDI-Keyboards, Pitch Bend, die Computertastatur und ein Bildschirmklavier',
    'Poly und Mono, Legato und Portamento',
    'Wavetable-Editor: Zeichnen, Audiodateien, WAV-Wavetables anderer Synthesizer',
    'Presets der Community, per Link geteilt',
  ],
  footer: {
    source: 'Quellcode auf GitHub',
    follow: 'Folgen',
    languages: 'Sprachen',
  },
  og: 'Kostenloser Wavetable-Synthesizer im Browser',
};
