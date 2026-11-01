import React from 'react';
import { Observable } from 'rxjs';
import {
  HandleModulation,
  liveKnob,
  theme,
  useLineChartContext,
  useLiveCanvas,
  useLiveDraw,
} from '@waveform/ui-kit';
import { useBehaviorSubject, useObservable } from '@waveform/rxjs-react';
import { useOscillatorContext } from '../../hooks';
import { FadeRoot, useFadeOut } from './fade-overlay';
import { unisonVoices } from './unison-voices';

const BAR_WIDTH = 4;
// the voices in from the edges of the chart (a bar whole)
const INSET = 6;
const VEIL_OPACITY = 0.6;
// the centre voices green, the others blue a little brighter
const CENTER_OPACITY = 0.8;
const SIDE_OPACITY = 0.95;

// the voices of the unison over the wave: shown while Detune, Blend or Unison is held (`$visible`: only the overlay
// renders, not the oscillator), where the routes of Detune and Blend move them
export interface UnisonView {
  $visible: Observable<boolean>;
  detune?: HandleModulation[];
  blend?: HandleModulation[];
}

// the voices of the unison on a canvas: each a bar, as far from the middle as its detune (on a square root of the
// cents, the widest spread and its stack at the edges: a small spread still sets them apart), as high as its level
// in its channel (the full height: a voice alone at 1); the centre voices green, the others blue. Drawn again where
// the routes move Detune or Blend (useLiveDraw)
const Voices = ({ detune: detuneRoutes, blend: blendRoutes }: Omit<UnisonView, '$visible'>) => {
  const {
    width,
    height,
    padding: [paddingX, paddingY],
    scaleY,
  } = useLineChartContext();
  const [{ $osc, $unisonShape, $active, ranges }] = useOscillatorContext();
  const { unison, detune, blend } = useBehaviorSubject($osc);
  const shape = useBehaviorSubject($unisonShape);
  const active = useBehaviorSubject($active);
  const [canvas, begin] = useLiveCanvas('unison-voices');
  const [detuneMin, detuneMax] = ranges.detune;
  const [blendMin, blendMax] = ranges.blend;
  // a route that raises the spread: the voice keeps its voices at a Detune of 0 (modulation.raises)
  const raised = !!detuneRoutes?.some(({ amount, off }) => !off && amount > 0);
  const knobs = [
    liveKnob(detune, { min: detuneMin, max: detuneMax }, detuneRoutes),
    liveKnob(blend, { min: blendMin, max: blendMax }, blendRoutes),
  ];
  const draw = React.useCallback(
    ([spread, routedBlend]: number[]) => {
      const context = begin();
      if (!context) return;
      context.globalAlpha = VEIL_OPACITY;
      context.fillStyle = theme.colors.primaryDark;
      context.fillRect(-paddingX, -paddingY, width, height);
      const middle = (width - 2 * paddingX) / 2;
      const reach = Math.max(0, middle - INSET);
      const voices = unisonVoices(unison, spread, routedBlend, shape, raised);
      // the cents at the edges: the voices of the widest spread, on the farthest step of a stack
      const edge = detuneMax / 2 + Math.max(...voices.map(({ stack }) => Math.abs(stack)));
      const bottom = scaleY(-1);
      voices.forEach(({ cents, amplitude, isCenter }) => {
        const x = middle + Math.sign(cents) * Math.sqrt(Math.min(1, Math.abs(cents) / edge)) * reach;
        // (a voice of a few at the blend 0 is louder than one alone: the bar as high as the chart at most)
        const top = scaleY(-1 + 2 * Math.min(1, amplitude));
        context.fillStyle = isCenter ? theme.colors.accent : theme.colors.secondAccent;
        context.globalAlpha = isCenter ? CENTER_OPACITY : SIDE_OPACITY;
        context.fillRect(x - BAR_WIDTH / 2, top, BAR_WIDTH, bottom - top);
      });
    },
    [begin, paddingX, paddingY, width, height, scaleY, detuneMax, unison, shape, raised]
  );
  useLiveDraw(knobs, draw, active);
  return canvas;
};

// the voices of the unison over the wave while Detune, Blend or Unison is held, fading out once let go
export const UnisonOverlay = ({ $visible, ...routes }: UnisonView) => {
  const visible = useObservable($visible, false);
  const rendered = useFadeOut(visible);
  if (!rendered) return null;
  return (
    <FadeRoot data-testid='unison-overlay' style={{ opacity: visible ? 1 : 0 }}>
      <Voices {...routes} />
    </FadeRoot>
  );
};
