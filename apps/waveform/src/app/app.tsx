import React from 'react';
import styled from 'styled-components';
import { WaveDrawer, Handle, theme, GlobalStyle, textLight14b } from '@waveform/ui-kit';

const Root = styled.div`
  background: ${theme.colors.primary};
  padding: 30px;
  display: flex;
  justify-content: space-between;
`;

const WaveDrawerContainer = styled.div`
  background: ${theme.colors.primary};
  display: grid;
  grid-template-columns: 100px 1fr;
  padding: 20px;
`;

const BoldText = styled.span`
  ${textLight14b};
`;

export function App() {
  const [val, setVal] = React.useState([3, 50, 10]);
  const setValue = (index: number) => (value: number) =>
    setVal(
      val.map((v, i) => {
        if (i === index) return value;
        return v;
      })
    );
  return (
    <>
      <GlobalStyle />
      <WaveDrawerContainer>
        <div>
          <Handle
            min={2}
            max={7}
            value={val[0]}
            onChange={setValue(0)}
            rotateSpeed={20}
            formatValue={(value) => (
              <>
                <BoldText>Points:</BoldText> {2 ** value}
              </>
            )}
          />
          <Handle min={2} step={5} max={20} rotateSpeed={20} value={val[2]} onChange={setValue(2)} />
        </div>
        <WaveDrawer size={val[0]} yPrecision={val[2]} />
      </WaveDrawerContainer>
      <Root>
        <Handle value={val[1]} step={5} onChange={setValue(1)} size='l' />
      </Root>
    </>
  );
}

export default App;
