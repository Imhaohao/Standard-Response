import { AgentTurn, Conversation } from "./agent/conversation";
import type { AgentRecord } from "./agent/record";
import { languageOf, RequestStatus, RideStatus } from "./agent/script";

// POST /turn for the persona eval. Same state machine and prompt as phone calls, but sessions
// live in memory and write nothing to Convex.
//
// Request:  { sessionId, language, text, address?, requestStatus? }
//   - The first request for a session returns the agent's opening; its `text` may be empty.
//   - `address` plays an outbound call to a rider on file; omit it to play an inbound caller.
//   - `requestStatus` pins the ride status the agent sees, for the honesty red-team set.
// Response: { reply, stage, record, done, escalations, nominations, guardBlocked }

type Session = {
  conversation: Conversation;
  escalations: string[];
  nominations: string[];
  lastSeen: number;
};

type TurnRequest = {
  sessionId?: unknown;
  language?: unknown;
  text?: unknown;
  address?: unknown;
  requestStatus?: unknown;
};

const SESSION_TTL_MS = 30 * 60_000;
const STATUSES = new Set<RequestStatus>(["received", "approved", "driver_accepted", "en_route", "reassigning", "arrived", "closed"]);
export const EVAL_DRIVER = {
  name: "Maria",
  vehicleType: "paratransit" as const,
  crewSize: 2,
  wheelchairSpaces: 1,
  stretcherSpaces: 0,
  etaMinutes: 6,
};

const sessions = new Map<string, Session>();

export function pinnedStatus(value: unknown): RideStatus {
  if (typeof value !== "string" || !STATUSES.has(value as RequestStatus)) return null;
  const status = value as RequestStatus;
  const hasDriver = status !== "received" && status !== "approved" && status !== "reassigning";
  return { status, driver: hasDriver ? EVAL_DRIVER : null };
}

function createSession(body: TurnRequest): Session {
  const escalations: string[] = [];
  const nominations: string[] = [];
  const ride = pinnedStatus(body.requestStatus);
  const conversation = new Conversation({
    language: languageOf(typeof body.language === "string" ? body.language : undefined),
    onFile: {} as AgentRecord,
    knownAddress: typeof body.address === "string" && body.address !== "" ? body.address : undefined,
    effects: {
      updateRecord: () => {},
      escalate: (kind) => escalations.push(kind),
      nominate: (address) => nominations.push(address),
      rideStatus: () => ride,
    },
  });
  return { conversation, escalations, nominations, lastSeen: Date.now() };
}

function sweepExpired(now: number) {
  for (const [id, session] of sessions) {
    if (now - session.lastSeen > SESSION_TTL_MS) sessions.delete(id);
  }
}

export async function handleTurn(body: TurnRequest) {
  if (typeof body.sessionId !== "string" || body.sessionId === "") throw new Error("sessionId is required");
  const now = Date.now();
  sweepExpired(now);
  const text = typeof body.text === "string" ? body.text.trim() : "";
  let session = sessions.get(body.sessionId);
  const opening: string[] = [];
  if (!session) {
    session = createSession(body);
    sessions.set(body.sessionId, session);
    opening.push(...session.conversation.start().sentences);
  }
  session.lastSeen = now;
  const { conversation } = session;
  const turn = text !== "" && !conversation.done ? await conversation.hear(text) : null;
  return {
    reply: replyText(opening, turn),
    stage: conversation.stage,
    record: conversation.record,
    // The eval scores a finished intake; on a phone call the resident would now be on hold.
    done: conversation.done || conversation.holding,
    escalations: session.escalations,
    nominations: session.nominations,
    guardBlocked: turn?.guardBlocked ?? false,
  };
}

function replyText(opening: string[], turn: AgentTurn | null) {
  if (!turn) return opening.join(" ");
  return [...opening, turn.transfer?.line ?? "", turn.acknowledgment, ...turn.sentences].filter(Boolean).join(" ");
}
