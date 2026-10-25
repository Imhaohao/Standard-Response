import WebSocket from "ws";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { Escalation } from "../agent/conversation";
import { Language, languageOf, LINES, RideStatus, statusLine } from "../agent/script";
import { convex, fireAndForget, logSubscriptionError } from "../convex";
import { env } from "../env";
import type { TwilioStart } from "./twilioLine";
import { confidenceFor, CONVERSATION_URL, createAgent, deleteAgent, HouseholdBrief, recordFrom, SaveAnswers } from "./elevenlabs";
import { householdCallFor, onFileRecord } from "./householdCall";
import { callEnded, LiveCall, liveByCallSid, liveByHousehold, registerLive } from "./registry";
import { CallSpeech } from "./speech";
import type { StreamParameters } from "./callParameters";
import { hangUp } from "./twilio";

// One household call run end to end by an ElevenLabs agent. Twilio audio goes to ElevenLabs as is;
// the agent's audio comes back and goes to Twilio as is. Our side only writes what it hears to Convex
// through the client tools, and keeps the call's bookkeeping the same as the Cartesia stack.

type ToolCall = { tool_name: string; tool_call_id: string; parameters: Record<string, unknown> };
type ServerEvent =
  | { type: "audio"; audio_event: { audio_base_64: string } }
  | { type: "interruption" }
  | { type: "user_transcript"; user_transcription_event: { user_transcript: string } }
  | { type: "agent_response"; agent_response_event: { agent_response: string } }
  | { type: "client_tool_call"; client_tool_call: ToolCall }
  | { type: "ping"; ping_event: { event_id: number } }
  | { type: "client_error"; error_event?: unknown }
  | { type: "conversation_initiation_metadata" | "agent_response_complete" | "agent_tool_response" };

export class ElevenLabsCall implements LiveCall {
  householdId: string | null = null;
  private readonly params: StreamParameters;
  private readonly callSid: string;
  private readonly streamSid: string;
  private agent: WebSocket | null = null;
  private agentId: string | null = null;
  private callId: Id<"calls"> | null = null;
  private language: Language = "en";
  private ride: RideStatus = null;
  private unsubscribe: (() => void) | null = null;
  private pendingAudio: string[] = [];
  private announceWaiters: (() => void)[] = [];
  private residentSpoke = false;
  private ended = false;

  constructor(private readonly twilio: WebSocket, start: TwilioStart) {
    this.params = start.customParameters;
    this.callSid = start.callSid;
    this.streamSid = start.streamSid;
    registerLive(this.callSid, this);
  }

  async begin() {
    const { householdId, callId } = await householdCallFor(this.params);
    this.householdId = householdId;
    this.callId = callId;
    liveByHousehold.set(householdId, this);
    const household = await convex().query(api.voice.household, { householdId });
    if (!household) throw new Error(`Household ${householdId} not found`);
    this.language = languageOf(household.language);
    this.unsubscribe = convex().onUpdate(api.voice.statusFor, { householdId }, (ride) => {
      this.ride = ride;
    }, logSubscriptionError("statusFor"));
    const knownAddress = household.lat !== undefined ? household.address : undefined;
    this.agentId = await createAgent({
      language: this.language,
      firstMessage: this.firstMessage(knownAddress, household.residentName),
      residentName: household.residentName,
      knownAddress,
      onFile: onFileRecord(household),
    } satisfies HouseholdBrief);
    if (this.ended) return void deleteAgent(this.agentId);
    this.connect(this.agentId);
    fireAndForget("setPhase", convex().mutation(api.calls.setPhase, { callId, phase: "live" }));
  }

  private firstMessage(knownAddress: string | undefined, residentName: string | undefined) {
    const lines = LINES[this.language];
    if (this.params.mode === "survey" && knownAddress) return lines.greetOutbound(knownAddress, residentName);
    return `${lines.greetInbound} ${lines.askAddress}`;
  }

  private connect(agentId: string) {
    const agent = new WebSocket(`${CONVERSATION_URL}?agent_id=${agentId}`, { headers: { "xi-api-key": env.elevenlabs.apiKey() } });
    this.agent = agent;
    agent.on("open", () => {
      agent.send(JSON.stringify({ type: "conversation_initiation_client_data" }));
      for (const chunk of this.pendingAudio) this.sendAudio(chunk);
      this.pendingAudio = [];
    });
    agent.on("message", (raw) => this.handle(JSON.parse(raw.toString()) as ServerEvent));
    agent.on("error", (error) => console.error(`[call ${this.callSid}] elevenlabs socket: ${error.message}`));
    // The agent hangs up with its end_call tool by closing the conversation.
    agent.on("close", () => void this.finish(this.residentSpoke));
  }

  hearAudio(base64: string) {
    if (this.agent?.readyState === WebSocket.OPEN) this.sendAudio(base64);
    else if (!this.ended) this.pendingAudio.push(base64);
  }

  // Twilio marks only matter to the Cartesia stack, which tracks its own playback.
  markPlayed() {}

  private sendAudio(base64: string) {
    this.agent?.send(JSON.stringify({ user_audio_chunk: base64 }));
  }

  private handle(event: ServerEvent) {
    switch (event.type) {
      case "audio":
        return this.toTwilio({ event: "media", streamSid: this.streamSid, media: { payload: event.audio_event.audio_base_64 } });
      case "interruption":
        return this.toTwilio({ event: "clear", streamSid: this.streamSid });
      case "user_transcript":
        return this.heardResident(event.user_transcription_event.user_transcript);
      case "agent_response":
        return this.agentSaid(event.agent_response_event.agent_response);
      case "client_tool_call":
        return this.runTool(event.client_tool_call);
      case "ping":
        return this.toAgent({ type: "pong", event_id: event.ping_event.event_id });
      case "client_error":
        return console.warn(`[call ${this.callSid}] elevenlabs client_error`, event.error_event);
    }
  }

  private heardResident(text: string) {
    if (text.trim() === "") return;
    this.residentSpoke = true;
    this.logLine("resident", text);
  }

  private agentSaid(text: string) {
    this.logLine("agent", text);
    const waiters = this.announceWaiters;
    this.announceWaiters = [];
    for (const resolve of waiters) resolve();
  }

  private runTool({ tool_name: name, tool_call_id: id, parameters }: ToolCall) {
    let result: string;
    let isError = false;
    try {
      result = this.toolResult(name, parameters);
    } catch (error) {
      result = error instanceof Error ? error.message : String(error);
      isError = true;
    }
    this.toAgent({ type: "client_tool_result", tool_call_id: id, result, is_error: isError });
  }

  private toolResult(name: string, parameters: Record<string, unknown>) {
    const householdId = this.householdId as Id<"households">;
    if (name === "ride_status") return statusLine(this.ride, this.language) ?? "There is no ride request for this home yet.";
    if (name === "save_answers") {
      const record = recordFrom(parameters as SaveAnswers);
      fireAndForget("households.update", convex().mutation(api.households.update, { householdId, patch: record, confidence: confidenceFor(record) }));
      return "Saved.";
    }
    if (name === "escalate") {
      const kind = parameters.kind as Escalation;
      fireAndForget("requests.escalate", convex().mutation(api.requests.escalate, { householdId, kind }));
      return "A dispatcher has been alerted.";
    }
    if (name === "nominate_neighbor") {
      const spokenAddress = String(parameters.spokenAddress ?? "");
      fireAndForget("nominations.add", convex().mutation(api.nominations.add, { fromHouseholdId: householdId, spokenAddress }));
      return "Saved the neighbor's address.";
    }
    throw new Error(`Unknown tool ${name}`);
  }

  // A status change mid-call: the agent says it next, in its own voice. Resolves once it has.
  announce(template: string) {
    this.toAgent({ type: "user_message", text: `(Dispatch update, not from the resident. Tell the resident this now, in their language, then carry on: "${template}")` });
    return new Promise<void>((resolve) => this.announceWaiters.push(resolve));
  }

  // Answering machine before anyone spoke: drop the agent and leave the usual voicemail in our voice.
  onMachine() {
    if (this.residentSpoke || this.ended) return;
    this.closeAgent();
    this.toTwilio({ event: "clear", streamSid: this.streamSid });
    const speech = new CallSpeech(this.twilio, this.streamSid);
    speech.say([LINES[this.language].voicemail], this.language);
    void speech.whenSilent().then(() => {
      speech.close();
      return this.finish(false);
    });
  }

  private logLine(speaker: "agent" | "resident", text: string) {
    if (!this.callId || text.trim() === "") return;
    const requestStatus = speaker === "agent" ? this.ride?.status : undefined;
    fireAndForget("calls.say", convex().mutation(api.calls.say, { callId: this.callId, speaker, text, requestStatus }));
  }

  private toTwilio(message: object) {
    if (this.twilio.readyState === WebSocket.OPEN) this.twilio.send(JSON.stringify(message));
  }

  private toAgent(message: object) {
    if (this.agent?.readyState === WebSocket.OPEN) this.agent.send(JSON.stringify(message));
  }

  private closeAgent() {
    const agent = this.agent;
    this.agent = null;
    agent?.removeAllListeners("close");
    agent?.close();
    if (this.agentId) void deleteAgent(this.agentId);
    this.agentId = null;
  }

  // answered: true or false when we end the call; null when Twilio or the caller ended it.
  async hangUpNow() {
    await this.finish(true);
  }

  async finish(answered: boolean | null) {
    if (this.ended) return;
    this.ended = true;
    this.closeAgent();
    this.unsubscribe?.();
    for (const resolve of this.announceWaiters) resolve();
    liveByCallSid.delete(this.callSid);
    if (this.householdId && liveByHousehold.get(this.householdId) === this) liveByHousehold.delete(this.householdId);
    if (answered !== null) await hangUp(this.callSid);
    const wasAnswered = answered ?? this.residentSpoke;
    if (this.callId) fireAndForget("calls.end", convex().mutation(api.calls.end, { callId: this.callId, answered: wasAnswered }));
    const { mode, householdId } = this.params;
    callEnded({ mode, callId: this.callId ?? undefined, householdId, answered: wasAnswered });
  }
}
