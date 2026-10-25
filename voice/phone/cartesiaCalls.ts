import type WebSocket from "ws";
import { env } from "../env";
import { callQuery, StreamParameters } from "./callParameters";
import { CallSession } from "./callSession";
import { reportUnreached } from "./callStatus";
import { CartesiaInput, CartesiaLine } from "./cartesiaLine";
import { callSidByCallId, streamedCallSids } from "./registry";

// Calls on Cartesia's telephony. We place outbound calls through its agents API; for every call,
// outbound or inbound, Cartesia asks POST /chats where to connect, then opens WS /ws to this server.

const API = "https://api.cartesia.ai";
// The Line SDK protocol version our socket speaks (cartesia-ai/line, voice_agent_app.py).
const PROTOCOL_VERSION = "2026-04-03";
const RING_SECONDS = 25;
// Cartesia sends no "nobody answered" event to a self-hosted agent: a call that hasn't opened its
// socket this long after it was placed never reached anyone.
const MISS_AFTER_MS = (RING_SECONDS + 20) * 1000;
// The socket can open before the API has told us the call's id; while a call is being placed, this
// is how long we wait for it.
const START_WAIT_MS = 5000;

type StartMessage = { type?: string; call_id?: string; agent_call_id?: string; from?: string; to?: string; agent?: { id?: string } };

// What each call we placed is for, by Cartesia's call id, until its socket opens.
const placed = new Map<string, StreamParameters>();
// Calls we've asked Cartesia to place that haven't come back with an id yet.
let placing = 0;

async function cartesiaApi(path: string, body: object) {
  const response = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { "X-API-Key": env.cartesia.telephonyApiKey(), "Cartesia-Version": env.cartesia.version, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Cartesia ${path} answered ${response.status}: ${text}`);
  return text === "" ? {} : (JSON.parse(text) as Record<string, unknown>);
}

export async function placeCartesiaCall(to: string, parameters: StreamParameters) {
  placing += 1;
  const response = await cartesiaApi("/agents/calls", {
    agent_id: env.cartesia.agentId(),
    from_number_id: env.cartesia.fromNumberId(),
    ringing_timeout_seconds: RING_SECONDS,
    outbound_calls: [{ to_number: to }],
  }).finally(() => (placing -= 1));
  const [call] = (response.calls ?? []) as { agent_call_id?: string; error?: unknown }[];
  if (!call?.agent_call_id) throw new Error(`Cartesia didn't place the call to ${to}: ${JSON.stringify(call ?? response)}`);
  const callSid = call.agent_call_id;
  placed.set(callSid, parameters);
  if (parameters.callId) callSidByCallId.set(parameters.callId, callSid);
  setTimeout(() => {
    placed.delete(callSid);
    reportUnreached(new URLSearchParams(callQuery(parameters)), streamedCallSids.delete(callSid));
  }, MISS_AFTER_MS);
  return callSid;
}

export async function cancelCartesiaCall(callSid: string) {
  try {
    await cartesiaApi(`/agents/calls/${callSid}/cancel`, {});
  } catch (error) {
    console.error(`[cartesia] cancel ${callSid} failed`, error);
  }
}

// POST /chats: Cartesia asks where this call's socket goes.
export function chatSession(body: { metadata?: unknown }) {
  return { websocket_url: "/ws", cartesia_version: PROTOCOL_VERSION, metadata: body.metadata ?? {} };
}

const digits = (phone: string | undefined) => (phone ?? "").replace(/\D/g, "");

async function placedCall(callSid: string) {
  const deadline = Date.now() + START_WAIT_MS;
  while (!placed.has(callSid) && placing > 0 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 100));
  const parameters = placed.get(callSid);
  placed.delete(callSid);
  return parameters;
}

// The person on the other end: the caller on a call to our number, the callee on one from it.
const otherParty = (start: StartMessage) => (digits(start.from) === digits(env.cartesia.phoneNumber()) ? start.to : start.from);

// A call we placed carries what it is for. Any other call (a resident calling in, or one dialed from
// Cartesia's dashboard or web preview) is a household conversation with whoever is on the other end.
export async function parametersFor(start: StartMessage): Promise<StreamParameters> {
  return (await placedCall(start.agent_call_id ?? "")) ?? { mode: "inbound", from: otherParty(start) };
}

// Older harnesses pass the call in the socket URL instead of a start message.
function startFromQuery(url: URL): StartMessage {
  const query = url.searchParams;
  return { call_id: query.get("call_id") ?? undefined, agent_call_id: query.get("agent_call_id") ?? undefined, from: query.get("from") ?? undefined, to: query.get("to") ?? undefined };
}

export function handleCartesiaSocket(socket: WebSocket, url: URL) {
  let line: CartesiaLine | null = null;
  let call: CallSession | null = null;
  let opened = false;
  const early: CartesiaInput[] = [];

  async function open(start: StartMessage) {
    if (start.agent?.id && start.agent.id !== env.cartesia.agentId()) return socket.close();
    const parameters = await parametersFor(start);
    const callSid = start.agent_call_id ?? start.call_id;
    if (!callSid) {
      console.error(`[cartesia] a call with no id: ${JSON.stringify(start)}`);
      return socket.close();
    }
    line = new CartesiaLine(socket, callSid, parameters);
    call = new CallSession(line);
    for (const message of early.splice(0)) line.receive(message);
    call.begin().catch((error) => {
      console.error("[cartesia] call failed to start", error);
      void call?.finish(false);
    });
  }

  socket.on("message", (raw) => {
    const message = JSON.parse(raw.toString()) as CartesiaInput;
    if (!opened) {
      opened = true;
      const isStart = message.type === "start";
      if (!isStart) early.push(message);
      return void open(isStart ? (message as StartMessage) : startFromQuery(url));
    }
    if (line) line.receive(message);
    else early.push(message);
  });
  socket.on("close", () => void call?.finish(null));
}
