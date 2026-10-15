import React from 'react';

export interface FxControlsProps {
  params: Record<string, number>;
  setParam: (key: string, value: number) => void;
  // bypassed: the controls are disabled
  on: boolean;
  sampleRate: number;
  // the common Out group of FxPanel, goes into LastGroups after the last group of the effect
  out?: React.ReactNode;
}
