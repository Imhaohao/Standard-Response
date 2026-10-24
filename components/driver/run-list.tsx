"use client";

import { useMutation } from "convex/react";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import { Button } from "../ui/button";
import { RideNeeds } from "./ride-needs";
import { Stop } from "./stops";

function CantMakeIt({ stop }: { stop: Stop }) {
  const cancel = useMutation(api.offers.cancelByDriver);
  const [armed, setArmed] = useState(false);
  return (
    <Button
      variant={armed ? "onPanel" : "onPanelQuiet"}
      className="self-start !h-9 !px-3"
      onClick={() => {
        if (!armed) return setArmed(true);
        void cancel({ assignmentId: stop._id });
      }}
    >
      {armed ? "Tap again: the rider will be told" : "I can't make this pickup"}
    </Button>
  );
}

// The accepted run in the order the van drives it. The number matches the pin on the map.
export function RunList({ stops, focusId, onFocus }: { stops: Stop[]; focusId: string | undefined; onFocus: (stop: Stop) => void }) {
  if (stops.length === 0) return null;
  return (
    <section aria-labelledby="run-heading" className="flex flex-col bg-panel">
      <h2 id="run-heading" className="type-small px-4 pt-3 pb-1 font-bold text-on-panel-muted">
        Your run
      </h2>
      <ol className="flex flex-col">
        {stops.map((stop, index) => {
          const focused = stop._id === focusId;
          return (
            <li key={stop._id} className={`flex flex-col gap-3 border-t border-panel-raised px-4 py-3 ${focused ? "bg-panel-raised/50" : ""}`}>
              <button type="button" onClick={() => onFocus(stop)} aria-pressed={focused} className="flex items-center gap-3 text-left focus-visible:outline-2 focus-visible:outline-on-panel">
                <span className={`grid size-8 shrink-0 place-items-center rounded-full type-figure text-base ${focused ? "bg-signal text-on-panel" : "bg-on-panel text-panel"}`}>{index + 1}</span>
                <span className="type-heading min-w-0 flex-1">{stop.address}</span>
                <span className="type-figure shrink-0 text-lg">{stop.etaMinutes} min</span>
              </button>
              {focused && (
                <>
                  <RideNeeds stop={stop} large={false} />
                  <CantMakeIt stop={stop} />
                </>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
