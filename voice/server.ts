import http from "node:http";
import { WebSocketServer } from "ws";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { loadApprovedAnswers } from "./agent/answerLookup";
import { startCallbackRunner } from "./callbackRunner";
import { startCallPlanRunner } from "./callPlanRunner";
import { convex } from "./convex";
import { startDialer } from "./dialer";
import { startPickupRunner } from "./pickupRunner";
import { startReadyDialer } from "./readyDialer";
import { env } from "./env";
import { watchHazard } from "./hazard";
import { handleMediaStream } from "./phone/callSession";
import { unreachedCall } from "./phone/callStatus";
import { callEnded, liveByCallSid, streamedCallSids } from "./phone/registry";
import { signatureIsValid, streamTwiml } from "./phone/twilio";
import { startTextFollowUp } from "./textFollowUp";
import { handleTurn } from "./textAgent";

// The call server. Twilio webhooks and media streams, plus the text endpoint for the eval.
//   POST /twilio/inbound   a resident calls our number
//   POST /twilio/status    an outbound call finished (no answer, busy, completed)
//   POST /twilio/amd       answering-machine detection result
//   WS   /media            Twilio Media Streams audio for every call
//   POST /turn             the same agent over text, for the persona eval
//   GET  /health
//   GET  /live             how many calls this server is holding, so a deploy can wait for them

const MACHINE = /^machine_end|^fax/;

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

// Twilio never connected our stream (no answer, busy, failed, or a trial notice left unanswered):
// the dialer, the runners and the Ready dialer count the miss when they hear about it.
function callStatus(query: URLSearchParams, params: Record<string, string>) {
  const ended = unreachedCall(query, streamedCallSids.delete(params.CallSid ?? ""));
  if (!ended) return;
  if (ended.mode === "survey" && ended.callId) {
    void convex().mutation(api.calls.end, { callId: ended.callId as Id<"calls">, answered: false });
  }
  callEnded(ended);
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
  if (req.method === "GET" && url.pathname === "/live") return send(res, 200, JSON.stringify({ calls: liveByCallSid.size }), "application/json");
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
  void loadApprovedAnswers();
  if (process.env.VOICE_TEXT_ONLY === "true") return;
  startDialer();
  startCallPlanRunner();
  startCallbackRunner();
  startPickupRunner();
  startReadyDialer();
  startTextFollowUp();
});
