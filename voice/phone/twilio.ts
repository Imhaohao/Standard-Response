import twilio from "twilio";
import { env } from "../env";

// Outbound calls connect straight to our media stream. Answering-machine detection runs
// asynchronously, so the greeting starts on pickup and a machine result cuts over to voicemail.

export type CallMode = "survey" | "callback" | "inbound";

export type StreamParameters = {
  mode: CallMode;
  householdId?: string;
  callId?: string;
  callbackId?: string;
  from?: string;
};

let client: ReturnType<typeof twilio> | null = null;
const rest = () =>
  (client ??= twilio(env.twilio.apiKeySid(), env.twilio.apiKeySecret(), { accountSid: env.twilio.accountSid() }));

const escapeXml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function streamTwiml(parameters: StreamParameters) {
  const wsUrl = `${env.publicUrl().replace(/^http/, "ws")}/media`;
  const params = Object.entries(parameters)
    .filter(([, value]) => value !== undefined)
    .map(([name, value]) => `<Parameter name="${name}" value="${escapeXml(String(value))}"/>`)
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Connect><Stream url="${wsUrl}">${params}</Stream></Connect></Response>`;
}

const callbackUrl = (path: string, query: Record<string, string>) => `${env.publicUrl()}${path}?${new URLSearchParams(query)}`;

export async function placeCall(to: string, parameters: StreamParameters) {
  const query = { mode: parameters.mode, callId: parameters.callId ?? "", callbackId: parameters.callbackId ?? "" };
  const call = await rest().calls.create({
    to,
    from: env.twilio.fromNumber(),
    twiml: streamTwiml(parameters),
    timeout: 25,
    statusCallback: callbackUrl("/twilio/status", query),
    statusCallbackEvent: ["completed"],
    machineDetection: "DetectMessageEnd",
    asyncAmd: "true",
    asyncAmdStatusCallback: callbackUrl("/twilio/amd", query),
  });
  return call.sid;
}

export async function hangUp(callSid: string) {
  try {
    await rest().calls(callSid).update({ status: "completed" });
  } catch (error) {
    console.error(`[twilio] hang up ${callSid} failed`, error);
  }
}

// Every Twilio webhook is signed. Reject anything that isn't, so nobody can fake call events.
export function signatureIsValid(signature: string | undefined, path: string, params: Record<string, string>) {
  if (!env.validateTwilioSignature) return true;
  if (!signature) return false;
  return twilio.validateRequest(env.twilio.authToken(), signature, `${env.publicUrl()}${path}`, params);
}
