import { ErrorInfo, Realtime, type InboundMessage } from "ably";

// The phone remote and the deck talk through Ably, a hosted live-messaging
// service, so they work on any network: venue Wi-Fi, a hotspot, or the phone
// on cellular. Each side keeps one connection open, and a tap is a message on
// it rather than a new web request. Each deck gets its own random room, and
// the phone learns it from the pairing QR code.
//
// The key ships inside the page, so it is limited in Ably's dashboard to
// publishing and subscribing on standard-response-deck:* channels.
const ABLY_KEY = process.env.NEXT_PUBLIC_ABLY_KEY;
const CHANNEL_PREFIX = "standard-response-deck";

// The phone sends next, previous and hello. The deck sends ready when it starts
// listening and paired in answer to a hello.
export type RemoteCommand = "next" | "previous" | "hello" | "ready" | "paired";

// Which end of the pair a message is for.
type Listener = "deck" | "phone";

const heardBy: Record<Listener, RemoteCommand[]> = {
  deck: ["next", "previous", "hello"],
  phone: ["ready", "paired"],
};

let client: Realtime | null = null;

function relay(): Realtime {
  if (!ABLY_KEY) throw new MissingKey();
  // A tap made while the phone is offline fails rather than waiting, so a
  // reconnect never delivers a burst of old taps that skips several slides.
  client ??= new Realtime({ key: ABLY_KEY, echoMessages: false, queueMessages: false });
  return client;
}

function channelFor(room: string) {
  return relay().channels.get(`${CHANNEL_PREFIX}:${room}`);
}

export const remoteAvailable = Boolean(ABLY_KEY);

export class MissingKey extends Error {
  constructor() {
    super("No Ably key was built into this page");
  }
}

export async function sendRemote(room: string, command: RemoteCommand) {
  await channelFor(room).publish(command, null);
}

// What to tell the presenter when a send fails.
export function sendFailureReason(error: unknown): string {
  if (error instanceof MissingKey) return "This page was built without the clicker key. Use the arrow keys on the laptop.";
  if (error instanceof ErrorInfo && (error.statusCode === 401 || error.statusCode === 403)) return "The clicker key was refused. Check it in Ably.";
  if (error instanceof ErrorInfo && error.statusCode === 429) return "Too many taps at once. Wait a moment, then tap again.";
  return "The tap didn’t reach the deck. Check the phone’s signal, then tap again.";
}

// Listens until the returned function is called. onOpen runs once the channel
// is attached, so a message sent from there reaches the other side.
export function listenForRemote(room: string, listener: Listener, onCommand: (command: RemoteCommand) => void, onOpen?: () => void) {
  const channel = channelFor(room);
  const onMessage = (message: InboundMessage) => onCommand(message.name as RemoteCommand);
  void channel.subscribe(heardBy[listener], onMessage).then(() => onOpen?.(), () => {});
  return () => channel.unsubscribe(heardBy[listener], onMessage);
}

// Calls back with true while the connection to Ably is up.
export function watchConnection(onChange: (connected: boolean) => void) {
  const connection = relay().connection;
  const update = () => onChange(connection.state === "connected");
  connection.on(update);
  update();
  return () => connection.off(update);
}

const ROOM_STORAGE_KEY = "present:remote-room";

function newRoom() {
  const bytes = crypto.getRandomValues(new Uint8Array(9));
  return Array.from(bytes, (byte) => byte.toString(36).padStart(2, "0")).join("");
}

// The same room survives a reload, so a paired phone keeps working.
export function deckRoom(): string {
  try {
    const stored = window.localStorage.getItem(ROOM_STORAGE_KEY);
    if (stored) return stored;
    const room = newRoom();
    window.localStorage.setItem(ROOM_STORAGE_KEY, room);
    return room;
  } catch {
    return newRoom();
  }
}

// The phone opens the remote on whichever site is showing the deck.
export function remoteUrl(room: string) {
  return `${window.location.origin}/present/remote?room=${room}`;
}
