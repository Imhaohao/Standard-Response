"use client";

import { useEffect, useRef, useState } from "react";

// The recording, once the browser can play it through. It stays null while the file is missing.
function useRecording(src: string) {
  const audio = useRef<HTMLAudioElement | null>(null);
  useEffect(() => {
    const element = new Audio(src);
    element.preload = "auto";
    const ready = () => (audio.current = element);
    element.addEventListener("canplaythrough", ready, { once: true });
    return () => {
      element.removeEventListener("canplaythrough", ready);
      element.pause();
      audio.current = null;
    };
  }, [src]);
  return audio;
}

// Seconds into the call while it runs: the recording's own position when the file exists and plays,
// otherwise the time since the beat began, so the transcript still streams in rehearsal.
export function useCallClock(src: string, running: boolean) {
  const audio = useRecording(src);
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (!running) return;
    const recording = audio.current;
    let playing = false;
    void recording
      ?.play()
      .then(() => (playing = true))
      .catch(() => (playing = false));
    const began = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      setSeconds(playing && recording ? recording.currentTime : (now - began) / 1000);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      if (!recording) return;
      recording.pause();
      recording.currentTime = 0;
    };
  }, [audio, running]);

  return running ? seconds : 0;
}
