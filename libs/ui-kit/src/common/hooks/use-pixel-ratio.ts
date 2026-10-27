import React from 'react';

const ratioNow = () => window.devicePixelRatio || 1;

// one query of the ratio now for every component that reads it (it changes once the ratio does); none without
// matchMedia (jsdom)
const listeners = new Set<() => void>();
let query: MediaQueryList | null = null;

const onChange = () => {
  watch();
  listeners.forEach((listener) => listener());
};

const unwatch = () => {
  query?.removeEventListener('change', onChange);
  query = null;
};

const watch = () => {
  unwatch();
  query = window.matchMedia?.(`(resolution: ${ratioNow()}dppx)`) ?? null;
  query?.addEventListener('change', onChange);
};

const subscribe = (listener: () => void) => {
  if (listeners.size === 0) watch();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) unwatch();
  };
};

// the device pixels of a css px (the backing size of a canvas: drawn as sharp as the screen), again when it changes
// (a zoom, another screen)
export const usePixelRatio = () => React.useSyncExternalStore(subscribe, ratioNow);
