import { loadFont } from "@remotion/fonts";
import { Easing, staticFile } from "remotion";

// Mirrors app/globals.css (light scheme). The map is paper and ink; red is the one signal.
export const color = {
  canvas: "oklch(0.982 0.002 30)",
  ink: "oklch(0.215 0.008 30)",
  panel: "oklch(0.255 0.006 30)",
  onPanel: "oklch(0.97 0.003 30)",
  onPanelMuted: "oklch(0.8 0.006 30)",
  signal: "oklch(0.585 0.215 27)",
  leaving: "oklch(0.58 0.13 155)",
  ride: "oklch(0.7 0.16 58)",
  unreachable: "oklch(0.55 0.012 30)",
  unknown: "oklch(0.62 0.006 30)",
  mapPaper: "oklch(0.963 0.012 85)",
  mapInk: "oklch(0.235 0.012 60)",
  night: "oklch(0.16 0.01 40)",
};

// Household kinds from the bake: accessible van, needs a ride, leaving on their own, unreachable.
export const kindColor = [color.signal, color.ride, color.leaving, color.unreachable];

export const FAMILY = "Archivo";

loadFont({ family: FAMILY, url: staticFile("fonts/archivo.woff2"), weight: "100 900", stretch: "62% 125%" });

export const type = {
  display: { fontFamily: FAMILY, fontWeight: 860, fontStretch: "88%", lineHeight: 1 },
  figure: { fontFamily: FAMILY, fontWeight: 820, fontStretch: "85%", lineHeight: 1, fontVariantNumeric: "tabular-nums" },
  label: { fontFamily: FAMILY, fontWeight: 600, fontStretch: "100%", lineHeight: 1.2 },
} as const;

export const ease = {
  outQuint: Easing.bezier(0.22, 1, 0.36, 1),
  standard: Easing.bezier(0.2, 0, 0, 1),
  inOut: Easing.bezier(0.65, 0, 0.35, 1),
  overshoot: Easing.bezier(0.34, 1.56, 0.64, 1),
};

export const FPS = 30;
export const WIDTH = 1920;
export const HEIGHT = 1080;
export const SAFE = 96;
