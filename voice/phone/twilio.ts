import twilio from "twilio";
import type { PlanPurpose } from "../agent/planCheck";
import { env } from "../env";

// Outbound calls connect straight to our media stream. Answering-machine detection runs
// asynchronously, so the greeting starts on pickup and a machine result cuts over to voicemail.

export type CallMode = "survey" | "callback" | "inbound" | "plan_check" | "ready";

export type StreamParameters = {
  mode: CallMode;
  householdId?: string;
  callId?: string;
  callbackId?: string;
  from?: string;
  planId?: string;
  role?: "helper" | "resident";
  // What a pickup call is for: its question, the resident's confirmation, or a status update.
  purpose?: PlanPurpose;
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
  const query = {
    mode: parameters.mode,
    callId: parameters.callId ?? "",
    callbackId: parameters.callbackId ?? "",
    householdId: parameters.householdId ?? "",
    planId: parameters.planId ?? "",
    role: parameters.role ?? "",
    purpose: parameters.purpose ?? "",
  };
  const machineDetection = env.twilioTrial
    ? {}
    : { machineDetection: "DetectMessageEnd", asyncAmd: "true", asyncAmdStatusCallback: callbackUrl("/twilio/amd", query) };
  const call = await rest().calls.create({
    to,
    from: env.twilio.fromNumber(),
    twiml: streamTwiml(parameters),
    timeout: 25,
    statusCallback: callbackUrl("/twilio/status", query),
    statusCallbackEvent: ["completed"],
    ...machineDetection,
  });
  return call.sid;
}

// Puts the person on this call through to another phone: Twilio drops our audio stream and dials
// them, showing our number, and the two talk directly. Our side of the call ends there.
export async function connectTo(callSid: string, phone: string) {
  const response = new twilio.twiml.VoiceResponse();
  response.dial({ callerId: env.twilio.fromNumber(), timeout: 30 }, phone);
  await rest().calls(callSid).update({ twiml: response.toString() });
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
