import React from 'react';
import styled from 'styled-components';
import { HighlightOutlined, SoundOutlined } from '@ant-design/icons';
import { Tabs } from '@waveform/ui-kit';
import AudiofileWavetable from '../audiofile-wavetable';
import ManualWavetable from '../manual-wavetable';

const Root = styled.div`
  display: grid;
  grid-template-columns: 50px 1fr;
`;

export const WaveTableEditor = () => {
  const [tab, setTab] = React.useState('Audio file');
  return (
    <Root>
      <Tabs activeTab={tab} onSelect={setTab}>
        <Tabs.Tab id='Manual' name={<HighlightOutlined />}>
          <ManualWavetable />
        </Tabs.Tab>
        <Tabs.Tab id='Audio file' name={<SoundOutlined />}>
          <AudiofileWavetable />
        </Tabs.Tab>
      </Tabs>
    </Root>
  );
};
