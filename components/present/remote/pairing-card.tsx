"use client";

import { CheckCircle, WarningCircle } from "@phosphor-icons/react";
import QRCode from "qrcode";
import { useMemo } from "react";
import { Show } from "../show";
import { STAGE } from "../stage";
import { remoteAvailable, remoteUrl } from "./channel";

const QR_SIZE = 520;
const CARD = { width: 1380, height: 720 };

function qrModules(url: string) {
  const { size, data } = QRCode.create(url, { errorCorrectionLevel: "M" }).modules;
  let path = "";
  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size; column += 1) {
      if (data[row * size + column]) path += `M${column} ${row}h1v1h-1z`;
    }
  }
  return { size, path };
}

// Shown over the slide with P. It closes by itself a moment after the phone
// connects, so the audience never has to see it.
export function PairingCard({ room, shown, phoneConnected }: { room: string | null; shown: boolean; phoneConnected: boolean }) {
  const qr = useMemo(() => (room ? qrModules(remoteUrl(room)) : null), [room]);
  return (
    <Show
      when={shown && qr !== null}
      rise={0}
      className="card absolute z-50 flex items-center gap-20 rounded-[56px] p-20 shadow-popover"
      style={{ left: (STAGE.width - CARD.width) / 2, top: (STAGE.height - CARD.height) / 2, width: CARD.width, height: CARD.height }}
    >
      <div className="flex-1">
        <h2 className="type-deck-title">Use your phone as a clicker</h2>
        <p className="type-deck-lede mt-8 text-on-panel-muted">Scan this with your phone’s camera, then tap anywhere on your phone for the next slide.</p>
        <ConnectionState phoneConnected={phoneConnected} />
      </div>
      {qr && (
        <svg viewBox={`-2 -2 ${qr.size + 4} ${qr.size + 4}`} width={QR_SIZE} height={QR_SIZE} role="img" aria-label="QR code for the phone clicker" shapeRendering="crispEdges" className="shrink-0">
          <path d={qr.path} fill="currentColor" />
        </svg>
      )}
    </Show>
  );
}

function ConnectionState({ phoneConnected }: { phoneConnected: boolean }) {
  if (!remoteAvailable) {
    return (
      <p className="type-deck-label mt-12 flex items-center gap-4 text-signal">
        <WarningCircle size={48} weight="fill" />
        This copy of the deck was built without the clicker key.
      </p>
    );
  }
  if (phoneConnected) {
    return (
      <p className="type-deck-label mt-12 flex items-center gap-4 text-leaving">
        <CheckCircle size={48} weight="fill" />
        Phone connected
      </p>
    );
  }
  return (
    <p className="type-deck-label mt-12 flex items-center gap-5 text-on-panel-muted">
      <span className="relative flex size-6">
        <span className="absolute inset-0 animate-ping rounded-full bg-signal opacity-60 motion-reduce:hidden" />
        <span className="relative size-6 rounded-full bg-signal" />
      </span>
      Waiting for your phone
    </p>
  );
}
