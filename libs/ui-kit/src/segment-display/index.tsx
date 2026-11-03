import React from 'react';
import { styled } from 'styled-components';
import { theme } from '../common/constants';

type Segment = 'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g';

// the segments of a cell: a on top, then clockwise, g in the middle
const SEGMENTS: Segment[] = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];

// the lit segments of each character; any other is blank
const CHAR_SEGMENTS: Record<string, Segment[]> = {
  '0': ['a', 'b', 'c', 'd', 'e', 'f'],
  '1': ['b', 'c'],
  '2': ['a', 'b', 'g', 'e', 'd'],
  '3': ['a', 'b', 'g', 'c', 'd'],
  '4': ['f', 'g', 'b', 'c'],
  '5': ['a', 'f', 'g', 'c', 'd'],
  '6': ['a', 'f', 'g', 'e', 'd', 'c'],
  '7': ['a', 'b', 'c'],
  '8': SEGMENTS,
  '9': ['a', 'b', 'c', 'd', 'f', 'g'],
  '-': ['g'],
};

// a cell in units: its height, width, the thickness of a segment and the gap between two
const H = 20;
const W = 11;
const T = 2.4;
const GAP = 0.5;
// units between two cells, the point in the middle of them
const SPACING = 3.6;
// the cells lean right as on a display of a device
const SLANT = Math.tan((6 * Math.PI) / 180);
// the digits after the point, smaller
const SMALL = 0.72;
// the opacity of an unlit segment: the 8 of every cell shows faintly
const GHOST = 0.09;

const h = T / 2;
const [left, right, top, middle, bottom] = [h, W - h, h, H / 2, H - h];

const horizontal = (y: number, x1: number, x2: number) =>
  `${x1},${y} ${x1 + h},${y - h} ${x2 - h},${y - h} ${x2},${y} ${x2 - h},${y + h} ${x1 + h},${y + h}`;
const vertical = (x: number, y1: number, y2: number) =>
  `${x},${y1} ${x + h},${y1 + h} ${x + h},${y2 - h} ${x},${y2} ${x - h},${y2 - h} ${x - h},${y1 + h}`;

const POLYGONS: Record<Segment, string> = {
  a: horizontal(top, left + GAP, right - GAP),
  g: horizontal(middle, left + GAP, right - GAP),
  d: horizontal(bottom, left + GAP, right - GAP),
  f: vertical(left, top + GAP, middle - GAP),
  b: vertical(right, top + GAP, middle - GAP),
  e: vertical(left, middle + GAP, bottom - GAP),
  c: vertical(right, middle + GAP, bottom - GAP),
};

interface Cell {
  char: string;
  point: boolean;
  small: boolean;
}

// the cells of a value: a point lights the one of the character before it (a blank one first), the last `small`
// of them smaller (the decimals)
const segmentCells = (value: string, small: number): Cell[] => {
  const cells: Omit<Cell, 'small'>[] = [];
  for (const char of value) {
    if (char === '.' && cells.length > 0) cells[cells.length - 1].point = true;
    else cells.push({ char: char === '.' ? ' ' : char, point: char === '.' });
  }
  return cells.map((cell, i) => ({ ...cell, small: i >= cells.length - small }));
};

const COLOR = theme.colors.accent;

const Svg = styled.svg`
  display: block;
  flex: none;
  overflow: visible;
  // lit segments glow a little; the unlit ones are too faint to
  filter: drop-shadow(0 0 1.5px ${COLOR});
`;

interface Props {
  // digits, ' ', '-'; a '.' lights the point of the character before it
  value: string;
  // the last cells smaller: the decimals
  small?: number;
  // px of a cell
  height?: number;
  className?: string;
}

// a seven-segment display: lit segments of the accent, the others faintly, the cells leaning right; a ' ' is a
// blank cell (its faint 8)
export const SegmentDisplay = ({ value, small = 0, height = 16, className }: Props) => {
  const cells = segmentCells(value, small);
  let x = 0;
  const placed = cells.map((cell) => {
    const scale = cell.small ? SMALL : 1;
    const at = x;
    x += (W + SPACING) * scale;
    return { ...cell, scale, at };
  });
  // up to the point of the last cell; the slant leans the tops right
  const last = placed.at(-1);
  const width = (last ? last.at + (W + SPACING / 2 + h) * last.scale : 0) + H * SLANT;
  return (
    <Svg
      className={className}
      viewBox={`0 0 ${width} ${H}`}
      height={height}
      width={(height * width) / H}
      role='img'
      aria-label={value.trim()}
    >
      {/* every cell leans on one axis: the bottoms stay, the tops move right */}
      <g transform={`translate(${H * SLANT}, 0) skewX(${(-Math.atan(SLANT) * 180) / Math.PI})`} fill={COLOR}>
        {placed.map(({ char, point, scale, at }, i) => {
          const lit = new Set(CHAR_SEGMENTS[char] ?? []);
          // a small cell on the bottom of the others
          return (
            <g key={i} transform={`translate(${at}, ${H * (1 - scale)}) scale(${scale})`}>
              {SEGMENTS.map((segment) => (
                <polygon
                  key={segment}
                  points={POLYGONS[segment]}
                  data-segment={segment}
                  data-lit={lit.has(segment) || undefined}
                  opacity={lit.has(segment) ? 1 : GHOST}
                />
              ))}
              <circle
                cx={W + SPACING / 2}
                cy={bottom}
                r={h * 0.9}
                data-point
                data-lit={point || undefined}
                opacity={point ? 1 : GHOST}
              />
            </g>
          );
        })}
      </g>
    </Svg>
  );
};
