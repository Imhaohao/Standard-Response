import type { Transition } from "motion/react";
import type { Beat } from "./script";

// Presenters click ahead of a move as often as not, so every move is a spring that retargets from
// wherever it is. The camera is slower and never overshoots.
export const sceneMove: Transition = { type: "spring", duration: 1.1, bounce: 0.1 };
export const cameraMove: Transition = { type: "spring", duration: 2.2, bounce: 0 };
export const quickFade: Transition = { duration: 0.5, ease: [0.2, 0, 0, 1] };

// How long the night map's camera takes to glide to a new shot. The 1.2 photo shrinks over the same time.
export const CAMERA_GLIDE_SECONDS = 2.2;

// 1.3 to 1.5 run faster than the rest of the deck so the story keeps up with the speaker. What plays on
// a slide (the fire spreading, the 911 calls ringing) speeds up the most; the camera and photo moving
// between slides speed up less, so they still glide.
export const STORY_ANIMATION_PACE = 1.75;
const STORY_TRANSITION_PACE = 1.5;
const BRISK_BEATS: ReadonlySet<Beat> = new Set(["night", "calls", "gone"]);

export function animationPaceFor(beat: Beat) {
  return BRISK_BEATS.has(beat) ? STORY_ANIMATION_PACE : 1;
}

export function transitionPaceFor(beat: Beat) {
  return BRISK_BEATS.has(beat) ? STORY_TRANSITION_PACE : 1;
}

export const briskSceneMove: Transition = { ...sceneMove, duration: 1.1 / STORY_TRANSITION_PACE };
