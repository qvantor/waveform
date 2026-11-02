import React from 'react';
import styled, { keyframes } from 'styled-components';
import cls from 'classnames';
import { CaretDownOutlined, CaretUpOutlined } from '@ant-design/icons';
import { number } from '@waveform/math';
import { SegmentDisplay, singlePointerTracker, text10, theme } from '@waveform/ui-kit';
import { useBehaviorSubject } from '@waveform/rxjs-react';
import { useTransport } from '../common/modules';

// the tempo the display sets: dragged, stepped or typed, within them
const MIN = 30;
const MAX = 240;
// steps of the carets (Shift: of 0.01)
const STEP = 1;
const FINE_STEP = 0.01;
// px of a drag a step of 1 (Shift: of 0.01 every px)
const PX_PER_STEP = 4;
// within the range of the display (setBpm puts it on the grid of 0.01)
const toTempo = (value: number) => number.thresholds(value, MIN, MAX);
// what the display has room for: 3 digits, a point, 2 decimals
const TYPED = /^\d{0,3}(\.\d{0,2})?$/;

// the cells of a tempo, typed or not, where its digits stand: up to 3 before the point, right to it, 2 after it
const cells = (text: string) => {
  const [whole, fraction] = text.split('.');
  return `${whole.padStart(3, ' ')}${fraction === undefined ? '' : '.'}${(fraction ?? '').padEnd(2, ' ')}`;
};

const blink = keyframes`
  50% {
    opacity: 0.35;
  }
`;

// a screen of the synth: the tempo on the left, the carets on the right; while dragged or typed a ring of the accent
const Screen = styled.div`
  position: relative;
  height: 36px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 6px 0 10px;
  border-radius: 3px;
  background: ${theme.colors.primaryDark};
  box-shadow: inset 0 1px 3px rgb(0 0 0 / 70%);
  transition: box-shadow 150ms;

  // a drag selects nothing: the popover's text is selectable
  &.editable {
    cursor: ns-resize;
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
  }

  &.active,
  &.typing {
    box-shadow:
      inset 0 1px 3px rgb(0 0 0 / 70%),
      0 0 0 1px ${theme.colors.accent};
  }

  // the value as it was, all of it selected: it blinks until the first key replaces it
  &.fresh svg {
    animation: ${blink} 1s steps(1) infinite;
  }
`;

// takes the keys while typed, unseen: the display shows what it holds
const Input = styled.input`
  position: absolute;
  inset: 0;
  width: 100%;
  opacity: 0;
  border: none;
  padding: 0;
  cursor: text;
`;

const Unit = styled.span`
  ${text10};
  align-self: flex-end;
  margin-bottom: 9px;
  font-weight: 600;
  letter-spacing: 1px;
  color: ${theme.colors.primaryDarkHighContrast};
`;

// the carets of the values of the synth (Oct, Semi, Unison), each a key of its own, of the color of the unit
const Steps = styled.div`
  position: relative;
  cursor: default;
  margin-left: auto;
  display: flex;
  flex-direction: column;
  justify-content: center;
`;

const Step = styled.button`
  height: 13px;
  width: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: none;
  background: none;
  color: ${theme.colors.primaryDarkHighContrast};
  font-size: 14px;
  line-height: 0;
  cursor: pointer;
  transition: color 150ms;

  &:hover {
    color: ${theme.colors.accent};
  }

  &:active {
    color: ${theme.colors.secondAccent};
  }

  &:focus,
  &:focus-visible {
    outline: none;
  }
`;

// the tempo of the synth on a seven-segment display (in the settings): dragged up or right a step of 1 every 4 px
// (Shift 0.01 a px), its carets step it by 1 (Shift 0.01), a double click types it, Enter or a click elsewhere takes
// it, Escape doesn't; within 30..240. The tempo a MIDI Clock
// leads is only shown, to 0.1, as EXT
export const TempoDisplay = () => {
  const [{ $bpm, $tempo, $source }, { setBpm }] = useTransport();
  const bpm = useBehaviorSubject($bpm);
  const tempo = useBehaviorSubject($tempo);
  const editable = useBehaviorSubject($source) === 'internal';
  // the text typed; fresh: the value as it was, all of it selected, until the first key replaces it
  const [typing, setTyping] = React.useState<{ text: string; fresh: boolean } | null>(null);
  const [active, setActive] = React.useState(false);
  const [track] = React.useState(singlePointerTracker);

  // the field's own at once (the tempo in effect follows it at most every 20 ms); a measured tempo to 0.1: its last
  // digits jitter
  const shown = editable ? bpm : number.round(tempo, 10);
  // from the tempo of the field now: two clicks before a render step twice
  const step = (by: number) => setBpm(toTempo($bpm.value + by));
  const onPointerDown = (e: React.PointerEvent) => {
    if (!editable || typing !== null) return;
    const start = $bpm.value;
    const [startX, startY] = [e.clientX, e.clientY];
    const tracked = track(
      e,
      (move) => {
        const diff = move.clientX - startX - (move.clientY - startY);
        setBpm(
          toTempo(move.shiftKey ? start + diff * FINE_STEP : start + Math.round(diff / PX_PER_STEP) * STEP)
        );
      },
      () => setActive(false)
    );
    if (tracked) setActive(true);
  };
  const startTyping = () => {
    if (!editable) return;
    // up to 2 decimals, none of 0 (120, 128.5, 93.75): the field's own is on the grid of 0.01
    setTyping({ text: `${bpm}`, fresh: true });
  };
  const commit = () => {
    if (typing === null) return;
    const typed = Number.parseFloat(typing.text);
    setTyping(null);
    if (Number.isFinite(typed)) setBpm(toTempo(typed));
  };
  const change = (text: string) => {
    const next = text.replace(',', '.');
    if (!TYPED.test(next)) return;
    setTyping({ text: next, fresh: false });
  };

  return (
    <Screen
      className={cls({ editable, active, typing: typing !== null, fresh: typing?.fresh })}
      onPointerDown={onPointerDown}
      onDoubleClick={startTyping}
    >
      <SegmentDisplay value={cells(typing?.text ?? shown.toFixed(2))} small={2} height={20} />
      <Unit>{editable ? 'BPM' : 'EXT'}</Unit>
      {typing !== null && (
        <Input
          aria-label='Tempo'
          inputMode='decimal'
          autoFocus
          value={typing.text}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => change(e.currentTarget.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') setTyping(null);
          }}
        />
      )}
      {/* a double click on them is two steps, not typing */}
      {editable && (
        <Steps onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
          <Step type='button' aria-label='Faster' onClick={(e) => step(e.shiftKey ? FINE_STEP : STEP)}>
            <CaretUpOutlined />
          </Step>
          <Step type='button' aria-label='Slower' onClick={(e) => step(-(e.shiftKey ? FINE_STEP : STEP))}>
            <CaretDownOutlined />
          </Step>
        </Steps>
      )}
    </Screen>
  );
};
