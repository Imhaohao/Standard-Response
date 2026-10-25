// Snow is a clean, cool white, brighter than the cream paper, so a snowfall changes the colour of the
// whole map and says "snow" at any zoom. The one place it is defined: the 3D layer reads it as the
// uSnow uniform and the flat map as a CSS colour.
export const SNOW_WHITE = [0.984, 0.988, 0.992] as const;

export const SNOW_WHITE_CSS = `rgb(${SNOW_WHITE.map((channel) => Math.round(channel * 255)).join(" ")})`;
