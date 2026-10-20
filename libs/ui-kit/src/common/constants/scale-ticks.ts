export type TickKind = 'mark' | 'major' | 'minor';

// the marks of a scale every 10% of the travel, the longer ones at 0, 50 and 100%; `from` (a share of the
// travel, the fillFrom of a control) is marked when it is on one
export const scaleTicks = (from?: number) =>
  Array.from({ length: 11 }, (_, i) => {
    const position = i / 10;
    const kind: TickKind =
      from !== undefined && Math.abs(position - from) < 1e-9 ? 'mark' : i % 5 === 0 ? 'major' : 'minor';
    return { position, kind };
  });
