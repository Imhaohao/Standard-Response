"use client";

import { useMutation } from "convex/react";
import { ChangeEvent, useState } from "react";
import { UploadSimple } from "@phosphor-icons/react";
import { api } from "@/convex/_generated/api";
import { Panel } from "../ui/panel";

// A rider list a partner agency hands over as a CSV. Imported riders are real, so the voice
// stand-in leaves them alone and they wait for the real dialer.
export function RiderUpload({ className = "" }: { className?: string }) {
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
    <Panel title="Rider list" className={className}>
      <label className="flex cursor-pointer items-center gap-2 px-3 py-2 hover:bg-panel-raised">
        <UploadSimple weight="bold" className="size-4" />
        <span className="type-small font-semibold">Upload a CSV of riders</span>
        <input type="file" accept=".csv,text/csv" onChange={(event) => void onFile(event)} className="sr-only" />
      </label>
      {result && <p className="type-small border-t border-panel-raised px-3 py-2 text-on-panel-muted">{result}</p>}
    </Panel>
  );
}
