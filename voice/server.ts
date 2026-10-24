import http from "node:http";
import { WebSocketServer } from "ws";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { startCallbackRunner } from "./callbackRunner";
import { convex } from "./convex";
import { startDialer } from "./dialer";
import { env } from "./env";
import { watchHazard } from "./hazard";
import { handleMediaStream } from "./phone/callSession";
import { callEnded, liveByCallSid, onCallEnded } from "./phone/registry";
import { signatureIsValid, streamTwiml } from "./phone/twilio";
import { startTextFollowUp } from "./textFollowUp";
import { handleTurn } from "./textAgent";

// The Track B call server. Twilio webhooks and media streams, plus the text endpoint for the eval.
//   POST /twilio/inbound   a resident calls our number
//   POST /twilio/status    an outbound call finished (no answer, busy, completed)
//   POST /twilio/amd       answering-machine detection result
//   WS   /media            Twilio Media Streams audio for every call
//   POST /turn             the same agent over text, for Track D's persona eval
//   GET  /health

const NOT_REACHED = new Set(["no-answer", "busy", "failed", "canceled"]);
const MACHINE = /^machine_end|^fax/;

const endedCalls = new Set<string>();
onCallEnded((ended) => {
  if (ended.callId) endedCalls.add(ended.callId);
});

async function readBody(req: http.IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

const formParams = (body: string) => Object.fromEntries(new URLSearchParams(body));

function send(res: http.ServerResponse, status: number, body: string, type = "text/plain") {
  res.writeHead(status, { "Content-Type": type });
  res.end(body);
}

function inbound(params: Record<string, string>) {
  return streamTwiml({ mode: "inbound", from: params.From });
}

// Twilio never connected a stream (no answer, busy, failed): run the reach ladder.
function callStatus(query: URLSearchParams, params: Record<string, string>) {
  const callId = query.get("callId") ?? "";
  const mode = query.get("mode");
  const reached = !NOT_REACHED.has(params.CallStatus ?? "");
  if (reached || liveByCallSid.has(params.CallSid ?? "") || (callId && endedCalls.has(callId))) return;
  if (mode === "survey" && callId) {
    void convex().mutation(api.calls.end, { callId: callId as Id<"calls">, answered: false });
    callEnded({ mode: "survey", callId, answered: false });
  } else if (mode === "callback") {
    callEnded({ mode: "callback", callbackId: query.get("callbackId") ?? undefined, answered: false });
  }
}

function machineDetected(params: Record<string, string>) {
  if (MACHINE.test(params.AnsweredBy ?? "")) liveByCallSid.get(params.CallSid ?? "")?.onMachine();
}

async function twilioWebhook(req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
  const params = formParams(await readBody(req));
  const signature = req.headers["x-twilio-signature"] as string | undefined;
  if (!signatureIsValid(signature, `${url.pathname}${url.search}`, params)) return send(res, 403, "bad signature");
  if (url.pathname === "/twilio/inbound") return send(res, 200, inbound(params), "text/xml");
  if (url.pathname === "/twilio/status") callStatus(url.searchParams, params);
  if (url.pathname === "/twilio/amd") machineDetected(params);
  send(res, 204, "");
}

async function turn(req: http.IncomingMessage, res: http.ServerResponse) {
  try {
    const result = await handleTurn(JSON.parse(await readBody(req)));
    send(res, 200, JSON.stringify(result), "application/json");
  } catch (error) {
    send(res, 400, JSON.stringify({ error: (error as Error).message }), "application/json");
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (req.method === "GET" && url.pathname === "/health") return send(res, 200, "ok");
  if (req.method === "POST" && url.pathname === "/turn") return void turn(req, res);
  if (req.method === "POST" && url.pathname.startsWith("/twilio/")) return void twilioWebhook(req, res, url);
  send(res, 404, "not found");
});

const media = new WebSocketServer({ noServer: true });
media.on("connection", handleMediaStream);
server.on("upgrade", (req, socket, head) => {
  if (new URL(req.url ?? "/", "http://localhost").pathname !== "/media") return socket.destroy();
  media.handleUpgrade(req, socket, head, (ws) => media.emit("connection", ws, req));
});

server.listen(env.port, () => {
  console.log(`[voice] listening on :${env.port}`);
  watchHazard();
  if (process.env.VOICE_TEXT_ONLY === "true") return;
  startDialer();
  startCallbackRunner();
  startTextFollowUp();
});
