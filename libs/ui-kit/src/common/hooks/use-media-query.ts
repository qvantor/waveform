import React from 'react';

export const useMediaQuery = (query: string) => {
  const [matches, setMatches] = React.useState(() => window.matchMedia(query).matches);
  React.useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);
  return matches;
};

// touch device with a phone/tablet-sized screen (landscape phones are caught by the height check)
const MOBILE_QUERY = '(pointer: coarse) and (max-width: 1024px), (pointer: coarse) and (max-height: 500px)';

export const useIsMobile = () => useMediaQuery(MOBILE_QUERY);

export const useIsPortrait = () => useMediaQuery('(orientation: portrait)');
