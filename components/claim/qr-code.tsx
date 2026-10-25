"use client";

import QRCode from "qrcode";
import { useEffect, useState } from "react";

// A QR code drawn as SVG. The markup comes from the qrcode package and our own URL, never from
// outside input. Its modules take the ink token. Until it is drawn, the square holds its place so the card doesn't jump.
export function QrCode({ text, label, className = "" }: { text: string | null; label: string; className?: string }) {
  const [drawn, setDrawn] = useState<{ text: string; svg: string } | null>(null);
  useEffect(() => {
    if (!text) return;
    let live = true;
    void QRCode.toString(text, { type: "svg", errorCorrectionLevel: "M", margin: 0, color: { light: "#0000" } }).then(
      (svg) => live && setDrawn({ text, svg }),
    );
    return () => {
      live = false;
    };
  }, [text]);
  const svg = drawn && drawn.text === text ? drawn.svg : null;
  return (
    <div role="img" aria-label={label} className={`aspect-square ${className}`}>
      {svg ? <div className="size-full [&_path]:stroke-ink [&>svg]:size-full" dangerouslySetInnerHTML={{ __html: svg }} /> : <div className="size-full animate-pulse rounded-lg bg-surface-sunk" />}
    </div>
  );
}
