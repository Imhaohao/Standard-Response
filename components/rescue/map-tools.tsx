"use client";

import { useMutation } from "convex/react";
import { ChangeEvent, useState } from "react";
import { UploadSimple } from "@phosphor-icons/react";
import { api } from "@/convex/_generated/api";
import { ChromeSurface } from "./map-chrome";

// A rider list a partner agency hands over as a CSV. Imported riders are real, so the voice
// stand-in leaves them alone and they wait for the real dialer.
export function RiderUpload({ className = "" }: { className?: string }) {
  const importCsv = useMutation(api.riders.importCsv);
  const [result, setResult] = useState("");

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const { imported, skippedLines } = await importCsv({ csv: await file.text() });
    const skipped = skippedLines.length > 0 ? `, ${skippedLines.length} skipped` : "";
    setResult(`${imported} imported${skipped}`);
    event.target.value = "";
  };

  return (
    <ChromeSurface className={`flex items-center gap-2 pr-3 ${className}`}>
      <label className="type-small flex cursor-pointer items-center gap-2 rounded-2xl px-3 py-2.5 font-semibold hover:bg-panel-raised">
        <UploadSimple weight="bold" className="size-4" />
        Load riders (CSV)
        <input type="file" accept=".csv,text/csv" onChange={(event) => void onFile(event)} className="sr-only" />
      </label>
      {result && <span className="type-small text-on-panel-muted">{result}</span>}
    </ChromeSurface>
  );
}
