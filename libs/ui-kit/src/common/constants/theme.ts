const colors = {
  white: '#fff',
  primary: '#ecf0f1',
  primaryMediumContrast: '#95a5a6',
  primaryHighContrast: '#7f8c8d',
  dark: '#2c3e50',
  accent: '#2ecc71',
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
