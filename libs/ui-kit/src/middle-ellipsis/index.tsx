import React from 'react';
import { styled } from 'styled-components';
import { useElementSize } from '../common/hooks';

export const ELLIPSIS = '…';

// the longest cut of `text` with an ellipsis in its middle that `fits`: as many characters kept before it as after
// it (one more before), the spaces at the cut dropped; the whole text when it fits, the ellipsis alone when nothing
// more does
export const middleEllipsis = (text: string, fits: (candidate: string) => boolean): string => {
  if (fits(text)) return text;
  const chars = Array.from(text);
  const cut = (kept: number) =>
    chars
      .slice(0, Math.ceil(kept / 2))
      .join('')
      .trimEnd() +
    ELLIPSIS +
    chars
      .slice(chars.length - Math.floor(kept / 2))
      .join('')
      .trimStart();
  // low is kept by a cut that fits (the ellipsis alone at worst), more than high by none
  let [low, high] = [0, chars.length - 1];
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (fits(cut(middle))) low = middle;
    else high = middle - 1;
  }
  return cut(low);
};

const Root = styled.span`
  display: block;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
`;

// the fonts loaded change the width of a text, not the one of its element: a count of their loads
const useFontLoads = () => {
  const [loads, setLoads] = React.useState(0);
  React.useEffect(() => {
    const fonts = document.fonts;
    if (!fonts) return;
    const loaded = () => setLoads((count) => count + 1);
    fonts.addEventListener('loadingdone', loaded);
    return () => fonts.removeEventListener('loadingdone', loaded);
  }, []);
  return loads;
};

// a line of text as wide as its place, cut in its middle where it doesn't fit (Modul…cratch: the start and the end
// of a name show), the whole of it in its title then; cut again when its place or the fonts change. Its text is
// laid out to be measured, so React renders no children of it
export const MiddleEllipsis = ({ text, className }: { text: string; className?: string }) => {
  const [ref, [width]] = useElementSize<HTMLSpanElement>();
  const fontLoads = useFontLoads();
  // what the text shown was cut for: the first size the observer reports (on every mount) is the one it was cut at
  const cutFor = React.useRef('');
  React.useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    // each step of the search lays the text out again
    const key = `${element.clientWidth} ${fontLoads} ${text}`;
    if (key === cutFor.current) return;
    cutFor.current = key;
    const shown = middleEllipsis(text, (candidate) => {
      element.textContent = candidate;
      return element.scrollWidth <= element.clientWidth;
    });
    element.textContent = shown;
    if (shown === text) element.removeAttribute('title');
    else element.title = text;
  }, [ref, text, width, fontLoads]);
  return <Root ref={ref} className={className} />;
};
