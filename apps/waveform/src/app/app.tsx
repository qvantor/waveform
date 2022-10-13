import React from 'react';
import styled from 'styled-components';
import { Handle, theme, GlobalStyle, textLight14b } from '@waveform/ui-kit';

const Root = styled.div`
  background: ${() => theme.colors.primary};
  padding: 60px 60px 60px 60px;
  display: flex;
  justify-content: space-between;
`;

const BoldText = styled.span`
  ${textLight14b};
`;

export function App() {
  const [val, setVal] = React.useState([8, 50, 1000]);
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
      <Handle
        min={4}
        max={15}
        value={val[0]}
        onChange={setValue(0)}
        rotateSpeed={20}
        formatValue={(value) => (
          <>
            <BoldText>Sampling:</BoldText> {2 ** value}
          </>
        )}
      />
      <Handle value={val[1]} onChange={setValue(1)} size="l" />
      <Handle
        min={0}
        step={10}
        max={2000}
        value={val[2]}
        onChange={setValue(2)}
      />
    </Root>
  );
}

export default App;
