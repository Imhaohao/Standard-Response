import type { Transition } from "motion/react";

// Presenters click ahead of a move as often as not, so every move is a spring that retargets from
// wherever it is. The camera is slower and never overshoots.
export const sceneMove: Transition = { type: "spring", duration: 1.1, bounce: 0.1 };
export const cameraMove: Transition = { type: "spring", duration: 2.2, bounce: 0 };
export const quickFade: Transition = { duration: 0.5, ease: [0.2, 0, 0, 1] };

// How long the night map's camera takes to glide to a new shot. The 1.2 photo shrinks over the same time.
export const CAMERA_GLIDE_SECONDS = 2.2;
