// a color as the computed style of jsdom gives it (rgb(…) for a hex of the theme): the way it parses it
export const cssColor = (color: string) => {
  const element = document.createElement('div');
  element.style.color = color;
  return element.style.color;
};
