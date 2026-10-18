// one period of a wave from edge to edge (phase 0 to 360°) as the chart draws it: the first sample again at its
// end; the zeros outside the chart close the fill along the middle
export const periodLine = (wave: number[]) => (wave.length ? [0, ...wave, wave[0], 0] : []);

// the x in the period line of a phase (a share of the period) of a wave of length samples
export const periodX = (phase: number, length: number) => 1 + phase * length;
