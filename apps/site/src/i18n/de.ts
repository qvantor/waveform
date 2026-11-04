import type { Messages } from './en';

// written for the searches in German (Wavetable Synthesizer online kostenlos, Synthesizer im Browser), not
// translated word for word; the knobs and sections keep the names of the synth
export const de: Messages = {
  meta: {
    title: 'Waveform: Wavetable-Synthesizer online & kostenlos',
    description:
      'Kostenloser Online-Synthesizer im Browser: zwei Wavetable-Oszillatoren mit 8-stimmigem Unisono, Filter, Hüllkurven und LFOs auf jedem Regler, Effekte und MIDI. Ohne Installation.',
    ogImageAlt: 'Waveform, ein kostenloser Wavetable-Synthesizer',
  },
  openSynth: 'Synthesizer öffnen',
  hero: {
    h1: 'Waveform: kostenloser Wavetable-Synthesizer',
    lead: 'Waveform ist ein **kostenloser Wavetable-Synthesizer**, der im Browser läuft, auf dem Computer, einem Chromebook oder dem Smartphone: **ohne Download und ohne Konto**.',
    details:
      '**Zwei Wavetable-Oszillatoren** mit **Supersaw-Unisono** aus bis zu 8 Stimmen, ein Filter in jeder Stimme, drei Hüllkurven und vier LFOs, die du auf **jeden Regler** ziehst, Distortion, Delay und Reverb. Schließ ein MIDI-Keyboard an oder spiel auf der Computertastatur.',
    listen: 'Reinhören',
    screenshotAlt:
      'Der Synthesizer Waveform spielt Akkorde: Die Wellen beider Oszillatoren, die Punkte der Hüllkurven und des LFO, das Filter und das Spektrum bewegen sich',
  },
  listen: {
    h2: 'Kostenlose Synth-Presets zum Anhören',
    lead: 'Alle Sounds hier sind kostenlose Presets des Wavetable-Synthesizers Waveform, direkt an seinem Ausgang aufgenommen: Bässe, Leads, Plucks, Keys und FX. Öffne eines mit einem Klick, spiel es auf der Tastatur oder einem MIDI-Keyboard, dreh an jedem Regler und speichere deine eigene Version, ohne Anmeldung.',
  },
  synthesis: {
    h2: 'Was ist ein Wavetable-Synthesizer?',
    table: {
      h3: 'So funktioniert Wavetable-Synthese',
      text: 'Ein Wavetable-Synthesizer spielt statt einer festen Welle eine Tabelle von Einzelzyklus-Wellen (Frames). Fährt man durch die Tabelle, ändert sich der Klang, während die Note klingt: von einem weichen Sinus zu einem hellen Sägezahn, einem Vokal-Formanten oder einem metallischen Growl. So klingen viele moderne Bässe, Leads und Pads.',
      alt: 'Eine Wavetable: ihre Frames gestapelt von einem Sinus (Frame 1) bis zu einem Sägezahn (Frame 256), der Regler Wave auf dem Frame, der spielt',
    },
    styles: {
      h3: 'Jeder Stil elektronischer Musik',
      text: 'Mit Waveform machst du Musik in jedem elektronischen Stil und darüber hinaus, vom Club-Track bis zur Film- und Game-Musik. Seine Bässe, Leads, Pads, Plucks, Keys und Effekte passen überall, wo ein Synthesizer gebraucht wird.',
      genres: [
        'House',
        'Techno',
        'Trance',
        'Drum and Bass',
        'Dubstep',
        'Synthwave',
        'Lo-Fi-Hip-Hop',
        'Ambient',
        'Trap',
        'Pop',
        'Hip-Hop',
        'EDM',
      ],
    },
    online: {
      h3: 'Kostenlos und online, ohne Installation',
      text: 'Waveform ist ein kostenloser Online-Wavetable-Synthesizer: dieselbe Art der Synthese wie bei Wavetable-Synthesizern für den Desktop, ohne Installation. Öffne ihn, wähl eine Tabelle und dreh an Wave, um die Frames wechseln zu hören.',
    },
  },
  features: {
    wavetables: {
      h2: 'Wavetable-Oszillatoren mit 256 Frames',
      text: [
        'Lass den Klang sich verändern, während er spielt: Der Regler Wave fährt durch eine Wavetable, und der Klang wandert mit. Zwei Oszillatoren spielen Wavetables mit bis zu 256 Frames aus einer nach Ordnern sortierten Bibliothek, jeder Wechsel des Frames wird weich eingeblendet. Tabellen mit Morph-Markierung werden auf 256 Frames erweitert.',
        'Jeder Oszillator hat Oct, Semi und Fine, und Phase und Phase rand legen fest, wo seine Stimmen beginnen.',
      ],
    },
    unison: {
      h2: 'Supersaw-Unisono mit bis zu 8 Stimmen',
      text: [
        'Der breite, dichte Supersaw der Trance- und EDM-Leads. Bis zu 8 Stimmen pro Oszillator: Detune verstimmt sie gegeneinander, Blend regelt das Verhältnis der mittleren zu den äußeren Stimmen (Standard 75 %), und die äußeren wechseln zwischen links und rechts: ein breiter Stereoklang.',
      ],
    },
    filter: {
      h2: 'Ein Filter in jeder Stimme: 8 Typen',
      text: [
        'Jede Note hat ihr eigenes Filter, so öffnet eine Hüllkurve jede Note eines Akkords für sich, wie bei analogen polyphonen Synthesizern. Acht Typen: Lowpass (Tiefpass), Highpass (Hochpass), Bandpass, Low Shelf, High Shelf, Peaking, Notch und Allpass, mit Cutoff, Res und Gain.',
      ],
    },
    modulation: {
      h2: 'Modulation per Drag & Drop: Hüllkurven, LFOs, Anschlag',
      text: [
        'Bring jeden Regler in Bewegung: Zieh den Tab einer Quelle auf ihn, unipolar oder bipolar, mit bis zu 64 Routen, 4 pro Regler. Die Quellen: drei Hüllkurven (ENV 1 ist die Lautstärke) mit einer Kurve, die du in jeder Phase biegst, vier LFOs mit fünf Formen, eigene Formen aus Punkten und fertige Muster Sidechain, Rhythm und Steps, dazu die Anschlagstärke jeder Note (VELO).',
        'Die LFOs, die Zeiten der Hüllkurven und das Delay laufen synchron zum Tempo, mit Triolen und punktierten Noten, oder folgen einer MIDI Clock.',
      ],
    },
    effects: {
      h2: 'Effekte: Distortion, Delay, Reverb',
      text: [
        'Mach den Sound im Synthesizer fertig: Distortion (Soft oder Hard Clip, mit Oversampling), ein Delay (normal oder Ping-Pong, mit Bandfilter im Feedback und Haas-Stereoversatz) und ein algorithmischer Reverb mit 16 Leitungen. Die Reihenfolge änderst du per Drag & Drop, jeder Effekt hat seinen Mix und eigene Presets. Ein Limiter auf dem Master verhindert Übersteuerung.',
      ],
    },
    playing: {
      h2: 'Spielen mit MIDI, Computertastatur oder Touchscreen',
      text: [
        'Spiel ihn wie ein Instrument: auf einem MIDI-Keyboard (Anschlagstärke und Pitch Bend), der Computertastatur (mit Oktavumschaltung) oder dem Bildschirmklavier mit seinem Pitch-Rad, auch auf dem Touchscreen. Bis zu 12 Noten in Poly, oder Mono, mit Legato und Portamento.',
      ],
    },
    editor: {
      h2: 'Wavetable-Editor: Tabellen zeichnen oder importieren',
      text: [
        'Bau eigene Wavetables: Zeichne einen Frame von Hand, mach aus jeder Audiodatei eine Tabelle oder lade die WAV-Wavetables, die du schon von anderen Synthesizern und aus Wavetable-Packs hast (ihre clm-Markierung wird gelesen).',
      ],
      screenshotAlt: 'Der Wavetable-Editor von Waveform: die Frames einer Tabelle und der gerade gezeichnete',
    },
    presets: {
      h2: 'Kostenlose Community-Presets per Link',
      text: [
        'Speichere einen Sound ohne Anmeldung und teile ihn per Link: Wer ihn öffnet, hört denselben Sound. Stöbere unter Popular in den Presets anderer oder suche sie nach Namen, und bearbeite deine eigenen später im selben Browser.',
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
    h2: 'Jetzt kostenlos online spielen',
    text: 'Kein Download, kein Konto: Öffne Waveform und spiel auf der Computertastatur, einem MIDI-Keyboard oder den Tasten auf dem Bildschirm.',
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
      'Eine Wurlitzer-Tabelle durch weiche Distortion; zwei LFOs lassen ein kurzes Delay schwanken: das Bandflattern des Lo-Fi-Hip-Hop.',
    'ufo-drone':
      'Hüllkurven fahren die Wave-Position durch zwei Tabellen, der Pitch Bend sinkt um einen Ganzton und kehrt zurück: ein Sci-Fi-Drone für Ambient.',
    'harp-pluck':
      'Tabellen echter Instrumente: eine Harfe und eine Nylongitarre eine Oktave höher, jede mit eigenem Decay.',
    'noise-riser':
      '8 + 4 Unisono-Stimmen für EDM-Build-ups; ENV 3 fächert das Detune auf, während sich der Riser öffnet, der Bend hebt ihn am Ende um zwei Halbtöne.',
    'acid-bass':
      'Eine 303-Sägezahntabelle für Acid House und Techno; ENV 2 reißt den Lowpass bei jeder Note auf, Slides zwischen überlappenden Noten, ein Ping-Pong-Delay.',
    helicopter:
      'Eine eigene LFO-Form zerhackt die Lautstärke; ENV 2 beschleunigt den LFO wie einen anlaufenden Rotor.',
    'warehouse-lead':
      'Ein Techno-Lead: LFO 1 bewegt die Wave-Position, ein schneller LFO auf Fine macht ihn rau, ENV 3 schließt das Filter; Distortion, Delay und Reverb.',
    'sonar-ping':
      'Drei Pings, beantwortet von einem langen Delay und Reverb; ENV 2 verschiebt das Band der Echos.',
    'zesty-drive-bass':
      'Distortion und Ping-Pong-Delay auf einem Mono-Bass; überlappende Noten gleiten ohne neuen Anschlag.',
    theremin: 'Mono-Legato: Jede Note gleitet in die nächste (150 ms Portamento), in der Mitte ein Atemzug.',
    'sub-bass':
      'Ein Sub im 808-Stil für Trap und Hip-Hop, der zwischen überlappenden Noten gleitet; am besten mit Kopfhörern.',
  },
  faq: {
    h2: 'Häufige Fragen zum Online-Synthesizer',
    items: [
      { q: 'Ist Waveform kostenlos?', a: 'Ja. Waveform ist kostenlos und ohne Anmeldung.' },
      {
        q: 'Muss ich etwas installieren?',
        a: 'Nein. Waveform läuft im Browser: Chrome, Edge, Safari und Firefox, auf dem Computer oder dem Smartphone. Die Klangerzeugung ist in Rust geschrieben und nach WebAssembly SIMD kompiliert. Chrome auf dem Computer hat einen Modus mit niedriger Latenz.',
      },
      {
        q: 'Funktioniert Waveform auf Chromebook, iPad oder iPhone?',
        a: 'Ja. Auf dem Chromebook läuft Waveform in Chrome wie auf jedem Computer, auch mit MIDI-Keyboards: praktisch auf Schul- und Firmenrechnern, auf denen du nichts installieren darfst. Auf iPhone und iPad läuft es in Safari (ab iOS 16.4), auf Android in Chrome; auf dem Smartphone hat es ein eigenes Layout, mit den Tasten auf einem eigenen Bildschirm. iOS hat kein Web MIDI: Dort spielst du auf den Tasten am Bildschirm.',
      },
      {
        q: 'Funktioniert Waveform mit meinem MIDI-Keyboard?',
        a: 'Ja. Waveform funktioniert mit MIDI-Keyboards in Browsern mit Web MIDI: Chrome, Edge, Opera und Firefox auf dem Computer, Chrome auf Android. Safari (und jeder Browser auf iPhone und iPad) hat kein Web MIDI: Dort spielst du auf der Computertastatur oder dem Bildschirmklavier. Waveform liest Noten, Anschlagstärke, Pitch Bend und MIDI Clock.',
      },
      {
        q: 'Eignet sich Waveform zum Lernen von Synthese?',
        a: 'Ja. Waveform zeigt, was jeder Regler tut, während du ihn drehst: die Welle, die jeder Oszillator spielt, die Stimmen des Unisonos, solange Detune gehalten wird, die Kurve des Filters, die Hüllkurven und LFOs als Kurven mit einem Punkt der klingenden Note. Öffne ein beliebiges Preset, um zu sehen, wie sein Sound gebaut ist, ändere es und hör den Unterschied.',
      },
      {
        q: 'Kann ich beliebige Wavetables importieren?',
        a: 'Ja. Waveform lädt jede WAV-Wavetable mit Frames von 2048 Samples, aus anderen Wavetable-Synthesizern oder Wavetable-Packs (ihre clm-Markierung wird gelesen). Eine Tabelle lässt sich auch aus einer kurzen Audiodatei machen oder von Hand zeichnen.',
      },
      {
        q: 'Darf ich die Sounds in meinen Tracks verwenden?',
        a: 'Ja. Die Sounds, die du auf Waveform spielst, darfst du in deinen Tracks verwenden, auch in kommerziellen Releases.',
      },
      {
        q: 'Wie teile ich einen Sound?',
        a: 'Speichere ihn in Waveform als Preset und kopiere den Link: Wer ihn öffnet, hört denselben Sound.',
      },
      {
        q: 'Ist der Quellcode verfügbar?',
        a: 'Ja. Der Quellcode von Waveform liegt auf GitHub, unter der Lizenz PolyForm Noncommercial.',
      },
    ],
  },
  featureList: [
    'Zwei Wavetable-Oszillatoren, Tabellen mit bis zu 256 Frames',
    'Supersaw-Unisono mit bis zu 8 Stimmen pro Oszillator, Detune und Blend',
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
  og: 'Kostenloser Wavetable-Synthesizer',
};
