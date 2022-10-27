import React from 'react';
import { AudiofileWavetableProvider } from './modules';
import { LoadFile, AudiofileWavetable } from './components';
import { useAudioProcessor } from '../wave-table-editor';

export default () => {
  const audioProcessor = useAudioProcessor();
  const [audioBuffer, setAudioBuffer] = React.useState<Float32Array>(new Float32Array(0));

  if (audioBuffer.length === 0) return <LoadFile onLoad={setAudioBuffer} />;

  return (
    <AudiofileWavetableProvider initial={{}} audioProcessor={audioProcessor}>
      <AudiofileWavetable audioBuffer={audioBuffer} />
    </AudiofileWavetableProvider>
  );
};
