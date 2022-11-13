import React from 'react';
import { Vector2D } from '@waveform/math';

const debounce = (fn: () => void, time = 300) => {
  let timer: ReturnType<typeof setTimeout> | undefined = undefined;
  return () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(fn, time);
  };
};

export const useScreenSize = () => {
  const [size, setSize] = React.useState<Vector2D>([window.innerWidth, window.innerHeight]);
  React.useEffect(() => {
    const onResize = debounce(() => {
      setSize([window.innerWidth, window.innerHeight]);
    });
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
    };
  }, []);
  return size;
};
