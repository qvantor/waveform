import React from 'react';
import styled from 'styled-components';
import cls from 'classnames';
import { number } from '@waveform/math';
import { theme } from '../common/constants';
import { useElementSize } from '../common/hooks';
import { Tooltip } from '../tooltip';
import { ValueTooltip } from '../tooltip/value-tooltip';

const WIDTH = 26;
// px of the slot around the drum
const INSET = 3;
const DRUM_WIDTH = WIDTH - 2 * INSET;
// the drum turns ±60° over the range of the value
const MAX_ANGLE = Math.PI / 3;
// the ribs of the drum, 15° apart
const RIB_STEP = Math.PI / 12;
// px of the mark facing straight out
const MARK_HEIGHT = 3;
// px of the ribs and the mark from the sides of the drum
const BAR = { x: 2, width: DRUM_WIDTH - 4 };
// the steps of the value (a 14-bit wheel has 16384)
const PRECISION = 1000;

// the dark slot the drum turns in, as high as its place (a flex row stretches it)
const Body = styled.div`
  position: relative;
  flex: none;
  align-self: stretch;
  width: ${WIDTH}px;
  border-radius: ${theme.borderRadius.m};
  background: ${theme.colors.primaryDark};
  box-shadow: inset 0 1px 3px rgb(0 0 0 / 60%);
  cursor: ns-resize;
  touch-action: none;
`;

// the rest position: a notch on each side of the drum
const Center = styled.div`
  position: absolute;
  left: 0;
  right: 0;
  top: 50%;
  height: 1px;
  background: ${theme.colors.primaryHighContrast};
`;

// a dark drum (as the value boxes beside it) lit from the front: darker towards its edges, where it turns away.
// Its ribs and the mark are drawn where they are on the drum as it turns, closer together towards the edges; the
// light mark is lit while it is held, as the line of the fader cap
const Drum = styled.div`
  position: absolute;
  inset: ${INSET}px;
  overflow: hidden;
  border-radius: ${theme.borderRadius.s};
  background: linear-gradient(
    180deg,
    ${theme.colors.primaryDark},
    ${theme.colors.primaryDarkMediumContrast} 50%,
    ${theme.colors.primaryDark}
  );
  box-shadow: inset 0 4px 4px -2px rgb(0 0 0 / 60%), inset 0 -4px 4px -2px rgb(0 0 0 / 60%);

  svg {
    display: block;
  }

  .groove {
    fill: rgb(0 0 0 / 55%);
  }

  .ridge {
    fill: rgb(255 255 255 / 14%);
  }

  .mark {
    fill: ${theme.colors.primary};
  }

  &.active .mark {
    fill: ${theme.colors.accent};
  }
`;

interface Props {
  // -1 all the way down .. 1 all the way up, 0 at rest
  value: number;
  onChange?: (value: number) => void;
  // the full name before the value in the tooltip while it is held, its accessible name
  name?: string;
  formatValue?: (value: number) => React.ReactNode;
  className?: string;
}

// the ribs and the mark of a drum of a radius turned by an angle (0: the mark faces the front), each where it is
// on the drum: as tall and as opaque as it faces the front. A render of the keys around it draws nothing
const DrumFace = React.memo(({ radius: r, angle }: { radius: number; angle: number }) => {
  const y = (phi: number) => r - r * Math.sin(phi);
  const ribs: React.ReactNode[] = [];
  const first = Math.ceil((-Math.PI / 2 - angle) / RIB_STEP);
  const last = Math.floor((Math.PI / 2 - angle) / RIB_STEP);
  for (let k = first; k <= last; k++) {
    const phi = angle + k * RIB_STEP;
    // the mark is in place of rib 0, one at an edge faces nowhere (cos ±90° isn't quite 0)
    if (k === 0 || Math.cos(phi) < 1e-9) continue;
    // a groove with the light on its lower edge: the drum is lit from above
    ribs.push(
      <g key={k} opacity={Math.cos(phi)}>
        <rect className='groove' {...BAR} y={y(phi) - 1} height={1} />
        <rect className='ridge' {...BAR} y={y(phi)} height={1} />
      </g>
    );
  }
  const mark = MARK_HEIGHT * Math.cos(angle);
  return (
    <>
      {ribs}
      <rect
        className='mark'
        data-testid='pitch-wheel-mark'
        {...BAR}
        y={y(angle) - mark / 2}
        height={mark}
        rx={1}
      />
    </>
  );
});

// a pitch bend wheel as on a hardware keyboard: a drum dragged up or down from where it is (its mark follows the
// pointer, the full travel turns it 60° each way), it springs back to the middle once let go, also when the
// window loses focus or its pointerup was lost (a move without a button). It shows the value it is given (a bend
// of a MIDI input too)
export const PitchWheel = ({ value, onChange, name = 'Pitch bend', formatValue, className }: Props) => {
  const [active, setActive] = React.useState(false);
  // the pointer that holds it, where it pressed, the value then and the last one it gave (not the value shown: it
  // may come a frame later, a render of the keys between would give the one before)
  const drag = React.useRef<{ pointerId: number; y: number; from: number; last: number } | null>(null);
  const changed = React.useRef(onChange);
  changed.current = onChange;
  const [drumRef, [, drumHeight]] = useElementSize<HTMLDivElement>();
  const radius = drumHeight / 2;

  const emit = React.useCallback((next: number) => {
    const held = drag.current;
    if (!held || next === held.last) return;
    held.last = next;
    changed.current?.(next);
  }, []);

  const release = React.useCallback(() => {
    const held = drag.current;
    if (!held) return;
    drag.current = null;
    setActive(false);
    if (held.last !== 0) changed.current?.(0);
  }, []);

  React.useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const held = drag.current;
      if (!held || e.pointerId !== held.pointerId) return;
      if (e.buttons === 0) {
        release();
        return;
      }
      // not laid out yet
      if (!radius) return;
      // the mark follows the pointer: it is radius · sin(angle) from the middle
      const sin = Math.sin(held.from * MAX_ANGLE) + (held.y - e.clientY) / radius;
      const share = Math.asin(number.thresholds(sin, -1, 1)) / MAX_ANGLE;
      emit(number.round(number.thresholds(share, -1, 1), PRECISION));
    };
    const onUp = (e: PointerEvent) => {
      if (e.pointerId === drag.current?.pointerId) release();
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
    window.addEventListener('blur', release);
    return () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
      window.removeEventListener('blur', release);
    };
  }, [radius, emit, release]);

  // unmounted while it is held: back at rest
  React.useEffect(() => release, [release]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (drag.current || e.button !== 0) return;
    // a finger is captured by the element it pressed: its moves are followed on the document
    if (e.target instanceof Element && e.target.hasPointerCapture(e.pointerId))
      e.target.releasePointerCapture(e.pointerId);
    drag.current = { pointerId: e.pointerId, y: e.clientY, from: value, last: value };
    setActive(true);
  };

  const formatted = formatValue?.(value) ?? value;
  return (
    // above it: the wheel is at the bottom of the screen
    <Tooltip bottom='calc(100% + 6px)' content={<ValueTooltip name={name}>{formatted}</ValueTooltip>}>
      <Body
        className={className}
        onPointerDown={onPointerDown}
        role='slider'
        aria-orientation='vertical'
        aria-valuemin={-1}
        aria-valuemax={1}
        aria-valuenow={value}
        aria-valuetext={typeof formatted === 'string' ? formatted : undefined}
        aria-label={name}
      >
        <Center />
        <Drum ref={drumRef} className={cls({ active })} aria-hidden>
          {drumHeight > 0 && (
            <svg width={DRUM_WIDTH} height={drumHeight}>
              <DrumFace radius={radius} angle={value * MAX_ANGLE} />
            </svg>
          )}
        </Drum>
      </Body>
    </Tooltip>
  );
};
