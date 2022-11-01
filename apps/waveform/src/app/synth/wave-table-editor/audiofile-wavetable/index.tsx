import React from 'react';
import { AudiofileProvider } from './modules';
import { LoadFile, AudiofileWavetable } from './components';
import { useOscillator } from '../../common/modules';

let initialBuffer = new Float32Array(0);

export default () => {
  const oscillator = useOscillator();
  const [audioBuffer, setAudioBuffer] = React.useState<Float32Array>(initialBuffer);
  const setAudioBufferInternal = (buffer: Float32Array) => {
    initialBuffer = buffer;
    setAudioBuffer(buffer);
  };

  if (audioBuffer.length === 0) return <LoadFile onLoad={setAudioBufferInternal} />;

  return (
    <AudiofileProvider initial={{ audioBuffer }} oscillator={oscillator}>
      <AudiofileWavetable />
    </AudiofileProvider>
  );
};
