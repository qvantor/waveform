import React from 'react';
import styled from 'styled-components';
import { WaveDrawer, Handle, theme, GlobalStyle, textLight14b } from '@waveform/ui-kit';
import { number } from '@waveform/math';

const Root = styled.div`
  background: ${theme.colors.primary};
  padding: 20px;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
`;

const WaveDrawerContainer = styled.div`
  background: ${theme.colors.primary};
  display: grid;
  grid-template-columns: 70px 1fr;
`;

const BoldText = styled.span`
  ${textLight14b};
`;

export function App() {
  const maxSize = 7;
  const [wave, setWave] = React.useState<Array<number>>(Array(number.powerOfTwo(maxSize)).fill(0));
  const [val, setVal] = React.useState([4, 5]);
  const setValue = (index: number) => (value: number) =>
    setVal(
      val.map((v, i) => {
        if (i === index) return value;
        return v;
      })
    );
  return (
    <Root>
      <GlobalStyle />
      <WaveDrawerContainer>
        <div>
          <Handle
            value={val[0]}
            onChange={setValue(0)}
            rotateSpeed={20}
            min={2}
            max={maxSize}
            formatValue={(value) => (
              <>
                <BoldText>Points:</BoldText> {number.powerOfTwo(value)}
              </>
            )}
          />
          <Handle step={[2, 5, 10, 20]} rotateSpeed={20} value={val[1]} onChange={setValue(1)} />
        </div>
        <WaveDrawer wave={wave} onChange={setWave} rate={val[0]} precision={val[1]} />
      </WaveDrawerContainer>
    </Root>
  );
}

export default App;
