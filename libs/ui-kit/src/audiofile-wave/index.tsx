import React from 'react';
import { LineChart, Line } from '../line-chart';
import { FileDrop } from '../file-drop';

export const AudiofileWave = () => {
  const [data, setData] = React.useState<Float32Array>(new Float32Array(0));

  const onChange = async (file: File) => {
    const audioContext = new AudioContext();
    const buffer = await file.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(buffer);
    if (audioBuffer.duration > 2) return;
    const data = audioBuffer.getChannelData(0);
    setData(data);
  };
  if (data.length === 0) return <FileDrop onChange={onChange} />;
  return (
    <LineChart domainY={[-1, 1]} domainX={[0, data.length]}>
      <Line data={[...data]} style={{ strokeWidth: 1 }} />
    </LineChart>
  );
};
