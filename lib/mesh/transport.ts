import { emptyResult, MeetingResult, MeshMessage, MeshNode } from "./node";
import { randomId } from "./random";

// Carrying the mesh protocol between real phones. The protocol in node.ts doesn't care how bytes
// move; these are the two ways a browser can move them without a server:
//
// - PeerSession runs a meeting over any two-way link, such as a WebRTC data channel between two
//   phones on the same Wi-Fi or hotspot with no internet (see webrtc.ts). It says hello when the
//   link opens, again every RESYNC_MS, and whenever this phone learns something new.
// - TabMesh uses a BroadcastChannel, which reaches every tab of this site on the same device. It
//   stands in for a radio neighbourhood when one person demos several "phones" on one screen.
//
// A native app would put the same messages on Bluetooth LE or Wi-Fi Aware; nothing else changes.

const RESYNC_MS = 20_000;
const MAX_MESSAGE_CHARS = 512_000;

export type Link = { send(text: string): void; close(): void };
export type MeetingListener = (result: MeetingResult) => void;

const parse = (text: unknown) => {
  if (typeof text !== "string" || text.length > MAX_MESSAGE_CHARS) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
};

export class PeerSession {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly node: MeshNode,
    private readonly link: Link,
    private readonly onMeeting: MeetingListener,
  ) {}

  start() {
    this.sayHello();
    this.timer = setInterval(() => this.sayHello(), RESYNC_MS);
  }

  sayHello() {
    this.link.send(JSON.stringify(this.node.hello()));
  }

  receive(text: unknown) {
    const message = parse(text);
    if (message === null) return;
    const result = emptyResult();
    for (const reply of this.node.receive(message, result)) this.link.send(JSON.stringify(reply));
    this.onMeeting(result);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.link.close();
  }
}

type Envelope = { from: string; to: string | null; body: MeshMessage };

function isEnvelope(value: unknown): value is Envelope {
  if (typeof value !== "object" || value === null) return false;
  const envelope = value as Record<string, unknown>;
  return typeof envelope.from === "string" && (envelope.to === null || typeof envelope.to === "string") && typeof envelope.body === "object";
}

// Every tab announces itself with a hello to all; each tab that hears it meets the announcer
// one-to-one, with replies addressed to it, so aggregation mass is never delivered twice.
export class TabMesh {
  // A fresh address per page load, used only to route replies between tabs.
  private readonly address = randomId();
  private readonly channel: BroadcastChannel;
  private readonly peers = new Map<string, number>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly node: MeshNode,
    private readonly onMeeting: MeetingListener,
    name = "rollcall-mesh",
  ) {
    this.channel = new BroadcastChannel(name);
    this.channel.onmessage = (event) => this.receive(event.data);
  }

  start() {
    this.announce();
    this.timer = setInterval(() => this.announce(), RESYNC_MS);
  }

  announce() {
    this.post(null, this.node.hello());
  }

  // Tabs heard from in the last minute.
  peerCount(now = Date.now()) {
    for (const [address, at] of this.peers) if (now - at > 60_000) this.peers.delete(address);
    return this.peers.size;
  }

  private post(to: string | null, body: MeshMessage) {
    const envelope: Envelope = { from: this.address, to, body };
    this.channel.postMessage(envelope);
  }

  private receive(data: unknown) {
    if (!isEnvelope(data) || data.from === this.address) return;
    if (data.to !== null && data.to !== this.address) return;
    this.peers.set(data.from, Date.now());
    const result = emptyResult();
    const replies = this.node.receive(data.body, result);
    // A broadcast hello starts a meeting: answer it, and say hello back so the other tab answers too.
    if (data.to === null && data.body.type === "hello") replies.push(this.node.hello());
    for (const reply of replies) this.post(data.from, reply);
    this.onMeeting(result);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.channel.close();
  }
}
