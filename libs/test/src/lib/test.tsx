import styled from 'styled-components';

/* eslint-disable-next-line */
export interface TestProps {}

const StyledTest = styled.div`
  color: pink;
`;

export function Test(props: TestProps) {
  return (
    <StyledTest>
      <h1>Welcome to Test!</h1>
    </StyledTest>
  );
}

export default Test;
