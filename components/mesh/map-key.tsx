import { ReactNode } from "react";

export const KEY_SAMPLE = { width: 32, height: 16 } as const;

// A drawn key for a map: each entry is a scrap of the map, on the map's own paper, beside a short name.
export function MapKey({ children }: { children: ReactNode }) {
  return (
    <ul aria-label="Map key" className="flex flex-wrap items-center gap-x-4 gap-y-1">
      {children}
    </ul>
  );
}

export function KeyEntry({ sample, children }: { sample: ReactNode; children: ReactNode }) {
  return (
    <li className="type-small flex items-center gap-1.5">
      <svg
        aria-hidden
        width={KEY_SAMPLE.width}
        height={KEY_SAMPLE.height}
        viewBox={`0 0 ${KEY_SAMPLE.width} ${KEY_SAMPLE.height}`}
        className="shrink-0 rounded-sm bg-map-paper"
      >
        {sample}
      </svg>
      <span>{children}</span>
    </li>
  );
}

// A street segment across the middle of a key sample, stroked the way the map strokes it.
export function KeyLine(props: React.SVGProps<SVGLineElement>) {
  const middle = KEY_SAMPLE.height / 2;
  return <line x1={4} y1={middle} x2={KEY_SAMPLE.width - 4} y2={middle} fill="none" {...props} />;
}
