"use client";

import { Camera, QrCode as QrIcon, X } from "@phosphor-icons/react";
import jsQR from "jsqr";
import QRCode from "qrcode";
import { useEffect, useRef, useState } from "react";
import { Link } from "@/lib/mesh/transport";
import { answerPairing, finishPairing, Pairing, startPairing } from "@/lib/mesh/webrtc";
import { Button } from "../ui/button";

// Pairing two phones with no internet: one shows a code, the other scans it and shows one back,
// the first scans that, and the phones talk directly over their shared Wi-Fi or hotspot.

type AddLink = (link: Link, listen: (receive: (text: unknown) => void) => void) => () => void;

type Step =
  | { kind: "idle" }
  | { kind: "working"; message: string }
  | { kind: "show"; code: string; next: "scan-answer" | "wait" }
  | { kind: "scan"; purpose: "offer" | "answer" }
  | { kind: "connected" }
  | { kind: "error"; message: string };

function QrCode({ text }: { text: string }) {
  const [svg, setSvg] = useState("");
  useEffect(() => {
    let live = true;
    void QRCode.toString(text, { type: "svg", errorCorrectionLevel: "L", margin: 1 }).then((markup) => live && setSvg(markup));
    return () => {
      live = false;
    };
  }, [text]);
  const [copied, setCopied] = useState(false);
  const copy = () => void navigator.clipboard?.writeText(text).then(() => setCopied(true), () => setCopied(false));
  return (
    <div className="flex flex-col items-center gap-2">
      {/* The markup is generated here from our own code, never from outside input. */}
      <div data-code={text} className="aspect-square w-full max-w-72 bg-white p-2" dangerouslySetInnerHTML={{ __html: svg }} />
      <button type="button" onClick={copy} className="type-small font-semibold text-on-panel-muted hover:text-on-panel">
        {copied ? "Copied" : "Copy the code instead"}
      </button>
    </div>
  );
}

type Detector = { detect: (source: CanvasImageSource) => Promise<{ rawValue: string }[]> };
type DetectorConstructor = new (options: { formats: string[] }) => Detector;

async function readFrame(video: HTMLVideoElement, canvas: HTMLCanvasElement, detector: Detector | null) {
  if (detector) {
    const codes = await detector.detect(video);
    return codes[0]?.rawValue ?? null;
  }
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context || canvas.width === 0) return null;
  context.drawImage(video, 0, 0);
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  return jsQR(image.data, image.width, image.height)?.data ?? null;
}

// The camera, reading QR codes with the browser's detector where there is one and jsQR elsewhere.
// Typing or pasting the code works too, for a phone without a camera.
function Scanner({ onCode, onCancel }: { onCode: (code: string) => void; onCancel: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [typed, setTyped] = useState("");
  const [cameraError, setCameraError] = useState("");
  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let live = true;
    const canvas = document.createElement("canvas");
    const Native = (globalThis as { BarcodeDetector?: DetectorConstructor }).BarcodeDetector;
    const detector = Native ? new Native({ formats: ["qr_code"] }) : null;
    const tick = async () => {
      if (!live || !video.current) return;
      const code = await readFrame(video.current, canvas, detector).catch(() => null);
      if (code && live) onCode(code);
      else timer = setTimeout(tick, 200);
    };
    void navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: "environment" } })
      .then((media) => {
        stream = media;
        if (!video.current || !live) return;
        video.current.srcObject = media;
        void video.current.play();
        void tick();
      })
      .catch(() => setCameraError("No camera here. Paste the code instead."));
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [onCode]);
  return (
    <div className="flex flex-col gap-2">
      {cameraError ? <p className="type-small text-on-panel-muted">{cameraError}</p> : <video ref={video} muted playsInline className="aspect-square w-full bg-black object-cover" />}
      <textarea
        value={typed}
        onChange={(event) => setTyped(event.target.value)}
        placeholder="Or paste the code"
        rows={2}
        className="type-small w-full resize-none border border-panel-raised bg-panel-raised/40 p-2 text-on-panel placeholder:text-on-panel-muted"
      />
      <div className="flex gap-2">
        <Button variant="onPanel" className="flex-1" disabled={!typed.trim()} onClick={() => onCode(typed)}>
          Use this code
        </Button>
        <Button variant="onPanelQuiet" onClick={onCancel} aria-label="Cancel">
          <X weight="bold" className="size-4" />
        </Button>
      </div>
    </div>
  );
}

function usePairing(addLink: AddLink) {
  const [step, setStep] = useState<Step>({ kind: "idle" });
  const pairing = useRef<Pairing | null>(null);

  const connect = (attempt: Pairing) => {
    pairing.current = attempt;
    void attempt.opened.then(
      ({ link, channel }) => {
        const remove = addLink(link, (receive) => channel.addEventListener("message", (event) => receive(event.data)));
        channel.addEventListener("close", remove, { once: true });
        setStep({ kind: "connected" });
      },
      (error: Error) => setStep({ kind: "error", message: error.message }),
    );
  };

  const fail = (error: unknown) => setStep({ kind: "error", message: error instanceof Error ? error.message : "Pairing failed." });

  return {
    step,
    show: async () => {
      setStep({ kind: "working", message: "Making a code…" });
      try {
        const attempt = await startPairing();
        connect(attempt);
        setStep({ kind: "show", code: attempt.offer, next: "scan-answer" });
      } catch (error) {
        fail(error);
      }
    },
    scan: (purpose: "offer" | "answer") => setStep({ kind: "scan", purpose }),
    scanned: async (code: string, purpose: "offer" | "answer") => {
      setStep({ kind: "working", message: "Connecting…" });
      try {
        if (purpose === "answer" && pairing.current) return await finishPairing(pairing.current, code);
        const attempt = await answerPairing(code);
        connect(attempt);
        setStep({ kind: "show", code: attempt.answer, next: "wait" });
      } catch (error) {
        fail(error);
      }
    },
    reset: () => {
      if (step.kind !== "connected") pairing.current?.pc.close();
      pairing.current = null;
      setStep({ kind: "idle" });
    },
  };
}

export function PairingCard({ addLink, links }: { addLink: AddLink; links: number }) {
  const { step, show, scan, scanned, reset } = usePairing(addLink);
  return (
    <section className="flex flex-col gap-3 px-4 py-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="type-heading">Pair with a phone nearby</h2>
        <span className="type-small text-on-panel-muted">{links === 1 ? "1 paired" : `${links} paired`}</span>
      </div>
      {step.kind === "idle" && (
        <>
          <p className="type-small text-on-panel-muted">Works with no internet. Both phones need the same Wi-Fi or one phone&apos;s hotspot.</p>
          <div className="flex gap-2">
            <Button variant="onPanel" className="flex-1" onClick={() => void show()}>
              <QrIcon weight="bold" className="size-4" />
              Show my code
            </Button>
            <Button variant="onPanelQuiet" className="flex-1" onClick={() => scan("offer")}>
              <Camera weight="bold" className="size-4" />
              Scan theirs
            </Button>
          </div>
        </>
      )}
      {step.kind === "working" && <p className="type-small text-on-panel-muted">{step.message}</p>}
      {step.kind === "show" && (
        <>
          <QrCode text={step.code} />
          <p className="type-small text-on-panel-muted">
            {step.next === "scan-answer" ? "Let the other phone scan this, then scan the code it shows." : "Let the first phone scan this. You'll connect in a moment."}
          </p>
          {step.next === "scan-answer" && (
            <Button variant="onPanel" onClick={() => scan("answer")}>
              <Camera weight="bold" className="size-4" />
              Scan their code
            </Button>
          )}
        </>
      )}
      {step.kind === "scan" && <Scanner onCode={(code) => void scanned(code, step.purpose)} onCancel={reset} />}
      {step.kind === "connected" && (
        <div className="flex items-center justify-between gap-3">
          <p className="type-small">Paired. The phones share what they know every 20 seconds.</p>
          <Button variant="onPanelQuiet" onClick={reset}>
            Pair another
          </Button>
        </div>
      )}
      {step.kind === "error" && (
        <div className="flex items-center justify-between gap-3">
          <p className="type-small text-on-panel-muted">{step.message}</p>
          <Button variant="onPanelQuiet" onClick={reset}>
            Try again
          </Button>
        </div>
      )}
    </section>
  );
}
