import { createGlobalStyle } from 'styled-components';

export const GlobalStyle = createGlobalStyle`
  * {
    margin: 0;
    padding: 0;
    font-family: 'Inter Tight', sans-serif;
  }

  body {
    user-select: none;
    -webkit-user-select: none;
    -webkit-tap-highlight-color: transparent;
    overscroll-behavior: none;
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
