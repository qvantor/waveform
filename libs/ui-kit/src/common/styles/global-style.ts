import { createGlobalStyle } from 'styled-components';

export const GlobalStyle = createGlobalStyle`
  * {
    margin: 0;
    padding: 0;
    font-family: 'Inter Tight', sans-serif;
  }

  body {
    user-select: none;
  }

  h1 {
    margin: 0;
  }

  button {
    &:focus {
      outline: none;
    }
  }
`;
