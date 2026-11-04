import type { Messages } from './en';

// written for the searches in Spanish (sintetizador wavetable online gratis, sintetizador en el navegador), not
// translated word for word; the knobs and sections keep the names of the synth
export const es: Messages = {
  meta: {
    title: 'Chisper: sintetizador wavetable online gratis',
    description:
      'Sintetizador online gratis en el navegador: dos osciladores wavetable con unísono de 8 voces, filtro, envolventes y LFO en cualquier control, efectos y MIDI. Sin instalar.',
    ogImageAlt: 'Chisper, un sintetizador wavetable gratis',
  },
  openSynth: 'Abrir el sintetizador',
  hero: {
    h1: 'Chisper: sintetizador wavetable gratis',
    lead: 'Chisper es un **sintetizador wavetable gratis** (de tablas de ondas) que funciona en el navegador, en el ordenador, un Chromebook o el móvil: **sin descargas ni cuenta**.',
    details:
      '**Dos osciladores** con **unísono supersaw** de hasta 8 voces, un filtro en cada voz, tres envolventes y cuatro LFO que arrastras a **cualquier control**, distorsión, delay y reverb. Conecta un teclado MIDI o toca con el teclado del ordenador.',
    listen: 'Escúchalo',
    screenshotAlt:
      'El sintetizador Chisper tocando acordes: se mueven las ondas de los dos osciladores, los puntos de las envolventes y del LFO, el filtro y el espectro',
  },
  listen: {
    h2: 'Presets de sintetizador gratis: escúchalos',
    lead: 'Todos estos sonidos son presets gratis del sintetizador wavetable Chisper, grabados directamente de su salida: bajos, leads, plucks, teclados y FX. Abre cualquiera con un clic, tócalo con tu teclado, mueve sus controles y guarda tu propia versión, sin registrarte.',
  },
  synthesis: {
    h2: '¿Qué es un sintetizador wavetable?',
    table: {
      h3: 'Cómo funciona la síntesis wavetable',
      text: 'Un sintetizador wavetable toca una tabla de ondas de un solo ciclo (frames) en lugar de una onda fija. Al recorrer la tabla, el timbre cambia mientras suena la nota: de una onda sinusoidal suave a una sierra brillante, un formante vocal o un gruñido metálico. Es el sonido de muchos bajos, leads y pads actuales.',
      alt: 'Una wavetable: sus frames apilados de una onda sinusoidal (frame 1) a una sierra (frame 256), el control Wave en el frame que suena',
    },
    styles: {
      h3: 'Cualquier estilo de música electrónica',
      text: 'Con Chisper puedes hacer música de cualquier estilo electrónico y más allá, de temas de club a bandas sonoras de cine y videojuegos. Sus bajos, leads, pads, plucks, teclados y efectos encajan en cualquier producción con sintetizadores.',
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
      h3: 'Gratis y online, sin instalar nada',
      text: 'Chisper es un sintetizador wavetable online y gratis: la misma síntesis que los sintetizadores wavetable de escritorio, sin instalar nada. Ábrelo, elige una tabla y gira el control Wave para oír cómo cambian los frames.',
    },
  },
  features: {
    wavetables: {
      h2: 'Osciladores wavetable con tablas de 256 frames',
      text: [
        'Haz que el sonido cambie mientras suena: el control Wave recorre una wavetable y el timbre cambia con él. Dos osciladores tocan tablas de hasta 256 frames de una biblioteca ordenada en carpetas, y cada cambio de frame entra con un fundido suave. Las tablas con marca de morph se expanden a 256 frames.',
        'Cada oscilador tiene Oct, Semi y Fine, y Phase y Phase rand fijan dónde empiezan sus voces.',
      ],
    },
    unison: {
      h2: 'Unísono supersaw: hasta 8 voces',
      text: [
        'El supersaw ancho y denso de los leads de trance y EDM. Hasta 8 voces por oscilador: Detune las separa en afinación, Blend equilibra las voces centrales y las laterales (75 % por defecto) y las laterales se alternan a izquierda y derecha para un sonido estéreo amplio.',
      ],
    },
    filter: {
      h2: 'Un filtro en cada voz: 8 tipos',
      text: [
        'Cada nota tiene su propio filtro, así que una envolvente lo abre en cada nota de un acorde por separado, como en los sintetizadores polifónicos analógicos. Ocho tipos: lowpass (paso bajo), highpass (paso alto), bandpass (paso banda), low shelf, high shelf, peaking, notch y allpass, con Cutoff, Res y Gain.',
      ],
    },
    modulation: {
      h2: 'Modulación arrastrando: envolventes, LFO y velocidad',
      text: [
        'Haz que cualquier control se mueva: arrastra la pestaña de una fuente hasta él, en modo unipolar o bipolar, con hasta 64 rutas, 4 por control. Las fuentes: tres envolventes (ENV 1 es el volumen) con una curva ajustable en cada etapa, cuatro LFO con cinco formas, formas propias dibujadas con puntos y patrones listos de Sidechain, Rhythm y Steps, y la velocidad de cada nota (VELO).',
        'Los LFO, los tiempos de las envolventes y el delay se sincronizan con el tempo, con tresillos y puntillos, o siguen un MIDI Clock.',
      ],
    },
    effects: {
      h2: 'Efectos: distorsión, delay y reverb',
      text: [
        'Termina el sonido dentro del sintetizador: distorsión (soft o hard clip, con sobremuestreo), un delay (normal o ping-pong, con un filtro de banda en la realimentación y un desfase estéreo Haas) y una reverb algorítmica de 16 líneas. Arrástralos en cualquier orden; cada uno tiene su Mix y sus presets. Un limitador en el máster evita que la salida sature.',
      ],
    },
    playing: {
      h2: 'Toca con MIDI, el teclado del ordenador o la pantalla táctil',
      text: [
        'Tócalo como un instrumento: con un teclado MIDI (velocidad y pitch bend), con el teclado del ordenador (con cambio de octava) o con el piano en pantalla y su rueda de pitch, también en una pantalla táctil. Hasta 12 notas en Poly, o mono, con legato y portamento.',
      ],
    },
    editor: {
      h2: 'Editor de wavetables: dibuja o importa tablas',
      text: [
        'Crea tus propias wavetables: dibuja un frame a mano, convierte cualquier archivo de audio en una tabla o carga las wavetables WAV que ya tienes de otros sintetizadores y packs de wavetables (se lee su marca clm).',
      ],
      screenshotAlt: 'El editor de wavetables de Chisper: los frames de una tabla y el que se está dibujando',
    },
    presets: {
      h2: 'Presets gratis de la comunidad, por enlace',
      text: [
        'Guarda un sonido sin registrarte y compártelo con un enlace: quien lo abra oirá el mismo sonido. Explora los presets de otros en Popular o búscalos por nombre, y edita los tuyos más tarde desde el mismo navegador.',
      ],
      cta: 'Ver los presets',
    },
  },
  figures: {
    wavetables:
      'Los dos osciladores de Chisper: el Osc 1 en el frame 33 de la wavetable Spectral Gyro, el Osc 2 una octava abajo en el frame 17 de Growl Outer Space, cada uno con Gain, Wave, Detune y Blend',
    unison:
      'Detune pulsado en el Osc 1: las 8 voces de su unísono sobre una onda de sierra, las centrales en verde',
    filter:
      'El filtro de Chisper: la respuesta de un lowpass resonante, con sus controles Cutoff, Res y Gain',
    modulation:
      'El Osc 2 de Chisper en la wavetable Sub Sine sobre ENV 1 y LFO 1: la forma Kick del LFO 1 mueve el Gain del Osc 2 y ENV 2 mueve el Rate del LFO 1',
    effects:
      'Los efectos de Chisper: distorsión soft clip, un delay ping-pong con su filtro de banda y la reverb',
    playing:
      'Chisper en un móvil: el sintetizador sobre dos filas de teclas, las teclas de octava y la rueda de pitch',
  },
  finale: {
    h2: 'Toca ahora el sintetizador online gratis',
    text: 'Sin descargas ni cuenta: abre Chisper y toca con el teclado del ordenador, un teclado MIDI o las teclas en pantalla.',
  },
  card: {
    categories: { bass: 'Bajo', lead: 'Lead', pluck: 'Pluck', keys: 'Teclados', pad: 'Pad', fx: 'FX' },
    open: 'Abrir en Chisper',
    play: 'Reproducir {name}',
    seek: 'Posición en {name}',
  },
  demos: {
    'biting-brass-keys':
      'Dos unísonos de 8 voces de una tabla de sierra Moog a una octava; el LFO 1 mueve las dos posiciones de onda, la ENV 2 abre el filtro y la distorsión.',
    'rhodes-keys':
      'Una tabla de Rhodes en unísono de 2 voces sobre una tabla de vibráfono; ENV 2 en el cutoff y un LFO lento en las ganancias: trémolo.',
    'lo-fi-tape-keys':
      'Una tabla de Wurlitzer con distorsión suave; dos LFO hacen oscilar un delay corto: el flutter de cinta del lo-fi hip hop.',
    'ufo-drone':
      'Las envolventes barren la posición de onda por dos tablas y el pitch bend baja un tono y vuelve: un drone ambient de ciencia ficción.',
    'harp-pluck':
      'Tablas de instrumentos reales: un arpa y una guitarra de nailon una octava más arriba, cada una con su propio decay.',
    'noise-riser':
      'Unísono de 8 + 4 voces para los build-ups del EDM; la ENV 3 abre el detune a medida que crece el riser y el pitch bend lo sube dos semitonos al final.',
    'acid-bass':
      'Una tabla de sierra 303 para acid house y techno; la ENV 2 abre de golpe el lowpass en cada nota, slides entre notas solapadas y un delay ping-pong.',
    helicopter:
      'Una forma de LFO propia corta el volumen; la ENV 2 acelera el LFO como un rotor que arranca.',
    'warehouse-lead':
      'Un lead de techno: el LFO 1 mueve la posición de onda, un LFO rápido en Fine añade aspereza y la ENV 3 cierra el filtro; distorsión, delay y reverb.',
    'sonar-ping':
      'Tres pings a los que responden un delay largo y la reverb; la ENV 2 mueve la banda de los ecos.',
    'zesty-drive-bass':
      'Distorsión y delay ping-pong en un bajo mono; las notas solapadas se deslizan sin un nuevo ataque.',
    theremin:
      'Mono legato: cada nota se desliza hacia la siguiente (portamento de 150 ms), con una pausa para respirar en medio.',
    'sub-bass':
      'Un sub al estilo 808 para trap y hip hop, que se desliza entre notas solapadas; mejor con auriculares.',
  },
  faq: {
    h2: 'Preguntas frecuentes sobre el sintetizador online',
    items: [
      { q: '¿Chisper es gratis?', a: 'Sí. Chisper es gratis y no hace falta registrarse.' },
      {
        q: '¿Tengo que instalar algo?',
        a: 'No. Chisper funciona en el navegador: Chrome, Edge, Safari y Firefox, en el ordenador o en el móvil. Su motor de sonido está escrito en Rust y compilado a WebAssembly SIMD. Chrome en el ordenador tiene un modo de baja latencia.',
      },
      {
        q: '¿Chisper funciona en un Chromebook, iPad o iPhone?',
        a: 'Sí. En un Chromebook, Chisper funciona en Chrome como en cualquier ordenador, también con teclados MIDI: sirve en los ordenadores del colegio o del trabajo donde no puedes instalar programas. En iPhone y iPad funciona en Safari (iOS 16.4 o posterior), en Android en Chrome; en el móvil tiene su propia disposición, con el teclado en una pantalla aparte. iOS no tiene Web MIDI: ahí toca con las teclas en pantalla.',
      },
      {
        q: '¿Chisper funciona con mi teclado MIDI?',
        a: 'Sí. Chisper funciona con teclados MIDI en los navegadores con Web MIDI: Chrome, Edge, Opera y Firefox en el ordenador, Chrome en Android. Safari (y cualquier navegador en iPhone y iPad) no tiene Web MIDI: ahí toca con el teclado del ordenador o el piano en pantalla. Chisper lee notas, velocidad, pitch bend y MIDI Clock.',
      },
      {
        q: '¿Chisper sirve para aprender síntesis?',
        a: 'Sí. Chisper muestra lo que hace cada control mientras lo giras: la onda que toca cada oscilador, las voces del unísono mientras mantienes Detune, la respuesta del filtro, las envolventes y los LFO como curvas con un punto de la nota que suena. Abre cualquier preset para ver cómo está hecho su sonido, cámbialo y oye la diferencia.',
      },
      {
        q: '¿Puedo importar cualquier wavetable?',
        a: 'Sí. Chisper carga cualquier wavetable WAV con frames de 2048 muestras, de otros sintetizadores wavetable o de packs de wavetables (se lee su marca clm). También puedes crear una tabla a partir de un archivo de audio corto o dibujarla a mano.',
      },
      {
        q: '¿Puedo usar los sonidos en mis canciones?',
        a: 'Sí. Los sonidos que tocas en Chisper son tuyos para usarlos en tus canciones, también en lanzamientos comerciales.',
      },
      {
        q: '¿Cómo comparto un sonido?',
        a: 'Guárdalo como preset en Chisper y copia su enlace: quien lo abra oirá el mismo sonido.',
      },
      {
        q: '¿Está disponible el código fuente?',
        a: 'Sí. El código fuente de Chisper está en GitHub, con la licencia PolyForm Noncommercial.',
      },
    ],
  },
  footer: {
    source: 'Código en GitHub',
    follow: 'Síguenos',
    languages: 'Idiomas',
  },
  og: 'Sintetizador wavetable gratis',
};
