export interface FxControlsProps {
  params: Record<string, number>;
  setParam: (key: string, value: number) => void;
  // bypassed: the controls are disabled
  on: boolean;
  sampleRate: number;
}
