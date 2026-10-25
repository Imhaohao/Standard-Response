"use client";

import { ImageSquare } from "@phosphor-icons/react";
import { useState } from "react";
import { PHOTOS, type PhotoName } from "./photos";

// A photo in grey, or, while the file is missing, a hatched slot that says which file to add.
export function Photo({ name, compact = false }: { name: PhotoName; compact?: boolean }) {
  const photo = PHOTOS[name];
  const [missing, setMissing] = useState(false);
  if (missing) return <PhotoSlot src={photo.src} alt={photo.alt} compact={compact} />;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- the deck scales one fixed stage, so next/image's sizing buys nothing here
    <img
      src={photo.src}
      alt={photo.alt}
      ref={(image) => {
        // A file that failed before hydration never fires onError, so check on mount as well.
        if (image?.complete && image.naturalWidth === 0) setMissing(true);
      }}
      onError={() => setMissing(true)}
      className="size-full object-cover grayscale"
    />
  );
}

function PhotoSlot({ src, alt, compact }: { src: string; alt: string; compact: boolean }) {
  return (
    <div className="relative flex size-full flex-col items-center justify-center gap-4 bg-night-raised text-on-night-muted">
      <div className="hatch absolute inset-0 opacity-[0.07]" aria-hidden />
      <ImageSquare size={compact ? 40 : 96} weight="light" aria-hidden />
      {!compact && (
        <>
          <p className="type-deck-label relative">{alt}</p>
          <p className="type-deck-note relative font-mono">public{src}</p>
        </>
      )}
    </div>
  );
}
