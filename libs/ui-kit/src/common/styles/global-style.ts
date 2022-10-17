import { createGlobalStyle } from 'styled-components';

export const GlobalStyle = createGlobalStyle`
  @import url('https://fonts.googleapis.com/css2?family=Inter+Tight:wght@100;400&display=swap');

  body {
    margin: 0;
    padding: 0;
    font-family: 'Inter Tight', sans-serif;
  }

  h1 {
    margin: 0;
  }
`;
