"use client";

import { useMutation } from "convex/react";
import { ChangeEvent, useEffect, useState } from "react";
import { api } from "@/convex/_generated/api";
import { LatLng } from "@/lib/geo";
import { Button } from "../ui/button";
import { MapTool } from "./map-view";

const TOOL_LABELS: Record<MapTool, string> = {
  look: "Look around",
  zone: "Draw warning zone",
  closure: "Close a road",
};

const TOOL_HINTS: Record<MapTool, string> = {
  look: "",
  zone: "Click the map to add corners. Finish with three or more.",
  closure: "Click where the closure starts, then where it ends.",
};

function useFinishShortcuts(onFinish: () => void, onCancel: () => void) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Enter") onFinish();
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onFinish, onCancel]);
}

export function MapTools({
  tool,
  draft,
  onTool,
  onClearDraft,
}: {
  tool: MapTool;
  draft: LatLng[];
  onTool: (tool: MapTool) => void;
  onClearDraft: () => void;
}) {
  const setZone = useMutation(api.riders.setZone);
  const [status, setStatus] = useState("");

  const cancel = () => {
    onClearDraft();
    onTool("look");
  };
  const finishZone = async () => {
    if (tool !== "zone" || draft.length < 3) return;
    const covered = await setZone({ polygon: draft });
    setStatus(`Zone set. ${covered} households are inside it and will be called.`);
    cancel();
  };
  useFinishShortcuts(() => void finishZone(), cancel);

  return (
    <div className="flex flex-col gap-2 border-b border-line px-4 py-3">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Map tool">
        {(Object.keys(TOOL_LABELS) as MapTool[]).map((key) => (
          <Button
            key={key}
            variant={tool === key ? "primary" : "quiet"}
            aria-pressed={tool === key}
            onClick={() => {
              onClearDraft();
              onTool(key);
            }}
          >
            {TOOL_LABELS[key]}
          </Button>
        ))}
        {tool === "zone" && (
          <Button variant="primary" disabled={draft.length < 3} onClick={() => void finishZone()}>
            Finish zone
          </Button>
        )}
        {tool !== "look" && (
          <Button variant="quiet" onClick={cancel}>
            Cancel
          </Button>
        )}
      </div>
      {tool !== "look" && <p className="type-small text-ink-muted">{TOOL_HINTS[tool]}</p>}
      {status && (
        <p className="type-small" role="status">
          {status}
        </p>
      )}
    </div>
  );
}

export function RiderUpload() {
  const importCsv = useMutation(api.riders.importCsv);
  const [result, setResult] = useState("");

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const { imported, skippedLines } = await importCsv({ csv: await file.text() });
    const skipped = skippedLines.length > 0 ? ` Skipped lines ${skippedLines.join(", ")}.` : "";
    setResult(`Imported ${imported} riders. Draw a zone to start calling them.${skipped}`);
    event.target.value = "";
  };

  return (
    <div className="flex flex-col gap-2 px-4 py-3">
      <label className="type-small flex flex-col gap-1.5 font-semibold">
        Upload rider list (CSV)
        <input type="file" accept=".csv,text/csv" onChange={(event) => void onFile(event)} className="type-small font-normal" />
      </label>
      {result && (
        <p className="type-small" role="status">
          {result}
        </p>
      )}
    </div>
  );
}
