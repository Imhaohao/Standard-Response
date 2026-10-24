"use client";

import { Panel } from "../ui/panel";
import { Home, homeOccupancy } from "./marks";

type Count = { key: string; label: string; count: number; swatch: string; segment: string };

// Each swatch is the roof the map paints for that household, so the bar doubles as the legend.
function counts(homes: Home[], withOpenRequest: Set<string>): Count[] {
  let out = 0;
  let stillHome = 0;
  let ride = 0;
  for (const home of homes) {
    if (withOpenRequest.has(home._id)) ride += 1;
    else if (homeOccupancy(home, false) === "left") out += 1;
    else stillHome += 1;
  }
  return [
    { key: "ride", label: "Asked for a ride", count: ride, swatch: "bg-signal", segment: "bg-signal" },
    { key: "stillHome", label: "Still home", count: stillHome, swatch: "bg-map-ink", segment: "bg-map-ink" },
    { key: "out", label: "Out", count: out, swatch: "bg-map-paper ring-1 ring-inset ring-line-strong", segment: "bg-line-strong" },
  ];
}

export function HomesPanel({ homes, withOpenRequest }: { homes: Home[]; withOpenRequest: Set<string> }) {
  if (homes.length === 0) return null;
  const rows = counts(homes, withOpenRequest);
  return (
    <Panel title="Homes in the zone" aside={<span className="type-small pr-4 tabular-nums text-on-panel-muted">{homes.length}</span>}>
      <div className="flex flex-col gap-2.5 px-4 pb-3">
        <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-full" aria-hidden>
          {rows.map((row) => (
            <span key={row.key} className={`${row.segment} transition-[flex-grow] duration-500`} style={{ flexGrow: row.count, flexBasis: 0 }} />
          ))}
        </div>
        <dl className="flex items-end justify-between gap-3">
          {rows.map((row) => (
            <div key={row.key} className="flex flex-col gap-0.5">
              <dd className={`type-figure tabular-nums ${row.key === "ride" ? "text-3xl text-signal" : "text-2xl"}`}>{row.count}</dd>
              <dt className="type-small flex items-center gap-1.5 text-on-panel-muted">
                <span className={`size-2.5 rounded-sm ${row.swatch}`} aria-hidden />
                {row.label}
              </dt>
            </div>
          ))}
        </dl>
      </div>
    </Panel>
  );
}
