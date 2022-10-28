const colors = {
  white: '#fff',
  primary: '#ecf0f1',
  primaryLowContrast: '#bdc3c7',
  primaryMediumContrast: '#95a5a6',
  primaryHighContrast: '#7f8c8d',

  primaryDark: '#121A22',
  primaryDarkMediumContrast: '#2c3e50',
  primaryDarkHighContrast: '#5A7FA4',

  accent: '#2ecc71',
  secondAccent: '#3498db',
  thirdAccent: '#f1c40f',
};

const borderRadius = {
  s: '2px',
  m: '4px',
  l: '6px',
};

export const theme = {
  colors,
  borderRadius,
};

export type Theme = typeof theme;
