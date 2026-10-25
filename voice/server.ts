import http from "node:http";
import { WebSocketServer } from "ws";
import { loadApprovedAnswers } from "./agent/answerLookup";
import { startCallbackRunner } from "./callbackRunner";
import { startCallPlanRunner } from "./callPlanRunner";
import { startDialer } from "./dialer";
import { startPickupRunner } from "./pickupRunner";
import { startHangUpRunner } from "./hangUpRunner";
import { startReadyDialer } from "./readyDialer";
import { env } from "./env";
import { watchHazard } from "./hazard";
import { handleMediaStream } from "./phone/callSession";
import { reportUnreached } from "./phone/callStatus";
import { chatSession, handleCartesiaSocket } from "./phone/cartesiaCalls";
import { liveByCallSid, startDraining, streamedCallSids } from "./phone/registry";
import { signatureIsValid, streamTwiml } from "./phone/twilio";
import { startTextFollowUp } from "./textFollowUp";
import { handleTurn } from "./textAgent";

// The call server. Twilio webhooks and media streams, Cartesia's self-hosted agent socket, plus the
// text endpoint for the eval. VOICE_CARRIER picks which phone system places calls (env.ts).
//   POST /twilio/inbound   a resident calls our number
//   POST /twilio/status    an outbound call finished (no answer, busy, completed)
//   POST /twilio/amd       answering-machine detection result
//   WS   /media            Twilio Media Streams audio for every call
//   POST /chats            Cartesia asks where a call's socket goes
//   WS   /ws               Cartesia's text events for every call on its telephony
//   GET  /status           Cartesia's health check
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

// Twilio never connected our stream (no answer, busy, failed, or a trial notice left unanswered).
function callStatus(query: URLSearchParams, params: Record<string, string>) {
  reportUnreached(query, streamedCallSids.delete(params.CallSid ?? ""));
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

async function chats(req: http.IncomingMessage, res: http.ServerResponse) {
  const body = JSON.parse((await readBody(req)) || "{}") as { metadata?: unknown };
  send(res, 200, JSON.stringify(chatSession(body)), "application/json");
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
  if (req.method === "POST" && url.pathname === "/chats") return void chats(req, res);
  if (req.method === "GET" && url.pathname === "/status") return send(res, 200, JSON.stringify({ status: "ok" }), "application/json");
  if (req.method === "POST" && url.pathname.startsWith("/twilio/")) return void twilioWebhook(req, res, url);
  send(res, 404, "not found");
});

const sockets = new WebSocketServer({ noServer: true });
server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname === "/media") return sockets.handleUpgrade(req, socket, head, handleMediaStream);
  if (url.pathname === "/ws") return sockets.handleUpgrade(req, socket, head, (ws) => handleCartesiaSocket(ws, url));
  socket.destroy();
});

// A deploy stops this machine with SIGINT and waits kill_timeout (voice/fly.toml) before killing it.
// Every call lives in this process, so a restart used to cut residents off mid-sentence (Jerry,
// Oct 25, two minutes into his call). Now nothing new is dialed and the live calls get to finish.
const DRAIN_LIMIT_MS = 280_000;
const DRAIN_POLL_MS = 1000;

async function drainThenExit(signal: string) {
  startDraining();
  const started = Date.now();
  console.log(`[voice] ${signal}: letting ${liveByCallSid.size} live call(s) finish before exiting`);
  while (liveByCallSid.size > 0 && Date.now() - started < DRAIN_LIMIT_MS) {
    await new Promise((resolve) => setTimeout(resolve, DRAIN_POLL_MS));
  }
  console.log(`[voice] exiting with ${liveByCallSid.size} live call(s) after ${Math.round((Date.now() - started) / 1000)} s`);
  process.exit(0);
}

process.once("SIGINT", () => void drainThenExit("SIGINT"));
process.once("SIGTERM", () => void drainThenExit("SIGTERM"));

server.listen(env.port, () => {
  console.log(`[voice] listening on :${env.port}, calls on ${env.carrier}`);
  watchHazard();
  void loadApprovedAnswers();
  if (process.env.VOICE_TEXT_ONLY === "true") return;
  startDialer();
  startCallPlanRunner();
  startCallbackRunner();
  startPickupRunner();
  startHangUpRunner();
  startReadyDialer();
  startTextFollowUp();
});
