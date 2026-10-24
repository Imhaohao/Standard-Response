import { Link } from "./transport";

// Two phones, no internet, no server: a WebRTC data channel whose offer and answer travel as QR
// codes from one screen to the other camera. With no ICE servers configured, the phones connect
// over host candidates, so they need to share a local network (the same Wi-Fi, or one phone's
// hotspot) but nothing beyond it. The descriptions are compressed so a code stays scannable.

const ICE_GATHER_TIMEOUT_MS = 5000;
const CONNECT_TIMEOUT_MS = 25_000;
// On macOS a browser without the Local Network permission can't announce its mDNS names, so this
// is the usual cause on a laptop (checked: Chrome's *.local names never resolve there, the Mac's own do).
const UNREACHABLE =
  "The phones couldn't reach each other. Put both on the same Wi-Fi or one phone's hotspot, then try again. On a Mac, allow your browser under Privacy & Security, Local Network.";
const CHANNEL = "rollcall-mesh";
const PREFIX = "RCM1:";

function base64url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64url(text: string) {
  const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream) {
  const output = new Blob([bytes as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(output).arrayBuffer());
}

// Candidates for other networks (relay, server-reflexive) can't work offline, so they're dropped
// to keep the code small.
function trimSdp(sdp: string) {
  return sdp
    .split("\r\n")
    .filter((line) => !(line.startsWith("a=candidate") && !line.includes(" typ host")))
    .join("\r\n");
}

export async function encodeDescription(description: RTCSessionDescriptionInit) {
  const json = JSON.stringify({ t: description.type, s: trimSdp(description.sdp ?? "") });
  return PREFIX + base64url(await pipe(new TextEncoder().encode(json), new CompressionStream("deflate-raw")));
}

export async function decodeDescription(code: string): Promise<RTCSessionDescriptionInit> {
  const trimmed = code.trim();
  if (!trimmed.startsWith(PREFIX)) throw new Error("That isn't a pairing code from this app.");
  const bytes = await pipe(fromBase64url(trimmed.slice(PREFIX.length)), new DecompressionStream("deflate-raw"));
  const { t, s } = JSON.parse(new TextDecoder().decode(bytes)) as { t: RTCSdpType; s: string };
  if ((t !== "offer" && t !== "answer") || typeof s !== "string") throw new Error("That pairing code is damaged.");
  return { type: t, sdp: s };
}

function gathered(pc: RTCPeerConnection) {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise<void>((resolve) => {
    const done = () => {
      if (pc.iceGatheringState !== "complete") return;
      pc.removeEventListener("icegatheringstatechange", done);
      resolve();
    };
    pc.addEventListener("icegatheringstatechange", done);
    setTimeout(resolve, ICE_GATHER_TIMEOUT_MS);
  });
}

export type Pairing = {
  pc: RTCPeerConnection;
  // Resolves with a link once the data channel is open.
  opened: Promise<{ link: Link; channel: RTCDataChannel }>;
};

function linkFor(channel: RTCDataChannel, pc: RTCPeerConnection): Link {
  return {
    send: (text) => {
      if (channel.readyState === "open") channel.send(text);
    },
    close: () => {
      channel.close();
      pc.close();
    },
  };
}

// Browsers hide local addresses behind mDNS names (*.local), which the other phone must resolve on
// the shared network. If that or the connection never completes, say so instead of waiting forever.
function whenOpen(channel: RTCDataChannel, pc: RTCPeerConnection) {
  return new Promise<{ link: Link; channel: RTCDataChannel }>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(UNREACHABLE)), CONNECT_TIMEOUT_MS);
    channel.addEventListener(
      "open",
      () => {
        clearTimeout(timer);
        resolve({ link: linkFor(channel, pc), channel });
      },
      { once: true },
    );
    pc.addEventListener("connectionstatechange", () => {
      if (pc.connectionState !== "failed") return;
      clearTimeout(timer);
      reject(new Error(UNREACHABLE));
    });
  });
}

// The phone that shows the first code.
export async function startPairing(): Promise<Pairing & { offer: string }> {
  const pc = new RTCPeerConnection({ iceServers: [] });
  const channel = pc.createDataChannel(CHANNEL, { ordered: true });
  const opened = whenOpen(channel, pc);
  await pc.setLocalDescription(await pc.createOffer());
  await gathered(pc);
  return { pc, opened, offer: await encodeDescription(pc.localDescription!) };
}

// The phone that scans the first code and shows the second.
export async function answerPairing(offerCode: string): Promise<Pairing & { answer: string }> {
  const pc = new RTCPeerConnection({ iceServers: [] });
  const opened = new Promise<{ link: Link; channel: RTCDataChannel }>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(UNREACHABLE)), CONNECT_TIMEOUT_MS);
    pc.addEventListener(
      "datachannel",
      (event) => {
        clearTimeout(timer);
        whenOpen(event.channel, pc).then(resolve, reject);
      },
      { once: true },
    );
  });
  await pc.setRemoteDescription(await decodeDescription(offerCode));
  await pc.setLocalDescription(await pc.createAnswer());
  await gathered(pc);
  return { pc, opened, answer: await encodeDescription(pc.localDescription!) };
}

// Back on the first phone, after scanning the second code.
export async function finishPairing(pairing: Pairing, answerCode: string) {
  await pairing.pc.setRemoteDescription(await decodeDescription(answerCode));
}
