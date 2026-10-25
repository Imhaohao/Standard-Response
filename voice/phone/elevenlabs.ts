import { env } from "../env";
import { OUTLINE } from "../agent/conversation";
import type { AgentRecord, Confidence } from "../agent/record";
import type { Language } from "../agent/script";

// ElevenLabs Conversational AI, ported from the WMYhacks voicemail agent (server/elevenlabs_agent.py).
// One agent is created per call so its prompt carries this household's facts; the client tools are
// created once per process and shared. ElevenLabs runs speech-to-text, turn-taking, the LLM and the
// voice on its side, and Twilio's 8 kHz μ-law passes straight through in both directions.

const API_BASE = "https://api.elevenlabs.io";
export const CONVERSATION_URL = "wss://api.elevenlabs.io/v1/convai/conversation";
const PHONE_AUDIO = "ulaw_8000";
// eleven_flash_v2 is the fastest model but English-only; v2_5 covers our other languages.
const ttsModelFor = (language: Language) => (language === "en" ? "eleven_flash_v2" : "eleven_flash_v2_5");

const QUIET_LINE_ENDS_AFTER_SECS = 90;

// Words a resident says to show they're listening. Said under the agent's voice they don't stop it.
const LISTENING_NOISES = ["ok", "okay", "uh huh", "mhm", "mm-hm", "yeah", "right", "sure", "gotcha", "sí", "ajá", "claro"];

export const CLIENT_EVENTS = [
  "conversation_initiation_metadata",
  "audio",
  "interruption",
  "user_transcript",
  "agent_response",
  "agent_response_complete",
  "client_tool_call",
  "agent_tool_response",
  "ping",
  "client_error",
] as const;

type ToolParameters = { type: "object"; properties: Record<string, object>; required: string[] };
type ToolSpec = { name: string; description: string; parameters: ToolParameters };

// Confidence the record gets for an answer the agent saved. The agent reads it back before closing.
const SAVED_CONFIDENCE = 0.8;

// save_answers asks yes/no about oxygen and dialysis, which the record keeps as a list.
export type SaveAnswers = AgentRecord & { oxygen?: boolean; dialysis?: boolean };

export function recordFrom({ oxygen, dialysis, ...fields }: SaveAnswers): AgentRecord {
  const medical = [oxygen && "oxygen", dialysis && "dialysis"].filter((need): need is "oxygen" | "dialysis" => typeof need === "string");
  const record: AgentRecord = Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined && value !== null));
  return medical.length > 0 ? { ...record, medical } : record;
}

export const confidenceFor = (record: AgentRecord): Confidence =>
  Object.fromEntries(Object.keys(record).map((field) => [field, SAVED_CONFIDENCE]));

const enumOf = (values: string[], description: string) => ({ type: "string", enum: values, description });

export const TOOLS: ToolSpec[] = [
  {
    name: "save_answers",
    description:
      "Save what the resident just told you to their record. Call it as soon as you hear any answer, with only the fields you heard. Call it again when they correct something.",
    parameters: {
      type: "object",
      properties: {
        address: { type: "string", description: "Street address where they are right now, with house number." },
        canLeave: enumOf(["yes", "no", "unsure"], "Can everyone in the home leave on their own right now?"),
        hasCar: { type: "boolean", description: "They have a car or someone who can drive them out." },
        peopleCount: { type: "number", description: "People in the home, counting the resident." },
        pets: { type: "boolean", description: "Any pets in the home." },
        mobility: enumOf(["walks", "walker", "manual_wheelchair", "power_wheelchair", "bedbound"], "How the person with the most trouble moving gets around."),
        assistanceRequired: enumOf(["none", "one_person_assist", "two_person_lift"], "Help needed to get out of the home."),
        oxygen: { type: "boolean", description: "Someone in the home needs oxygen." },
        dialysis: { type: "boolean", description: "Someone in the home needs dialysis." },
      },
      required: [],
    },
  },
  {
    name: "escalate",
    description: "Flag this home for a human dispatcher right away. Use for fire or smoke at the home, a medical emergency, a hazard, or when you can't confirm the address or understand their language.",
    parameters: {
      type: "object",
      properties: {
        kind: enumOf(["flames", "medical", "hazard_at_home", "address_unconfirmed", "language_barrier", "unservable"], "Why a dispatcher is needed."),
      },
      required: ["kind"],
    },
  },
  {
    name: "nominate_neighbor",
    description: "Record a neighbor's address the resident thinks may not be able to leave on their own.",
    parameters: {
      type: "object",
      properties: { spokenAddress: { type: "string", description: "The neighbor's address as the resident said it." } },
      required: ["spokenAddress"],
    },
  },
  {
    name: "ride_status",
    description: "Get the one sentence you may say about this home's ride. Call it before saying anything about a vehicle, driver or arrival time.",
    parameters: { type: "object", properties: {}, required: [] },
  },
];

const headers = () => ({ "xi-api-key": env.elevenlabs.apiKey(), "content-type": "application/json" });

async function post<T>(path: string, body: object): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, { method: "POST", headers: headers(), body: JSON.stringify(body) });
  if (!response.ok) throw new Error(`ElevenLabs ${path} failed (${response.status}): ${(await response.text()).slice(0, 300)}`);
  return (await response.json()) as T;
}

const toolConfig = (tool: ToolSpec) => ({
  tool_config: {
    type: "client",
    ...tool,
    expects_response: true,
    execution_mode: "immediate",
    interruption_mode: "allow",
    response_timeout_secs: 10,
  },
});

let toolIds: Promise<string[]> | null = null;
function createTools() {
  toolIds ??= Promise.all(TOOLS.map((tool) => post<{ id: string }>("/v1/convai/tools", toolConfig(tool)).then(({ id }) => id))).catch(
    (error: unknown) => {
      toolIds = null;
      throw error;
    },
  );
  return toolIds;
}

export type HouseholdBrief = {
  language: Language;
  firstMessage: string;
  residentName?: string;
  knownAddress?: string;
  onFile: AgentRecord;
};

const ORDER = ["ask_address", "can_leave", "has_car", "household", "needs", "assistance", "readback", "neighbor", "done"] as const;

function describeOnFile(brief: HouseholdBrief) {
  const facts = [
    brief.residentName ? `Resident's name: ${brief.residentName}.` : "",
    brief.knownAddress ? `Address on file: ${brief.knownAddress}. Confirm it instead of asking cold.` : "No confirmed address on file.",
    Object.keys(brief.onFile).length > 0 ? `Also on file, to confirm rather than ask from scratch: ${JSON.stringify(brief.onFile)}.` : "",
  ];
  return facts.filter((fact) => fact !== "").join("\n");
}

export function systemPrompt(brief: HouseholdBrief) {
  const goals = [...new Set(ORDER.map((step) => OUTLINE[step].goal))].map((goal, index) => `${index + 1}. ${goal}`).join("\n");
  return `You are the 911 voice agent on a phone call about the evacuation in Altadena. Many callers are older, hard of hearing, or use a wheelchair or oxygen.

How to talk:
- Let the caller finish. If they pause mid-thought, wait. Never talk over them, and never finish their sentence for them.
- One short question at a time. Plain words. No lists, no markdown, no emojis.
- Speak the caller's language. Start in the language code "${brief.language}" and switch if they switch.
- Never promise a vehicle, driver or time. For anything about a ride, call ride_status and say only the sentence it returns.

What the call must get done, in this order:
${goals}

The facts to collect: the address they are at now (with house number), whether everyone can leave on their own, whether they have a car or a ride, how many people and any pets, mobility (walks, walker, manual or power wheelchair, bedbound), oxygen or dialysis, and how much help getting out (none, one person, two to lift). Save each answer with save_answers as soon as you hear it.

Before closing, read the answers back in one or two sentences and fix anything they correct. Then ask whether a neighbor on their street may not be able to leave, and save that address with nominate_neighbor. Then tell them what happens next and to call this number back if anything changes, say goodbye, and call end_call in the same turn.

If they mention fire or smoke at the home, a medical emergency, or a hazard, call escalate right away and tell them a dispatcher has been alerted.

What we already know:
${describeOnFile(brief)}`;
}

function agentConfig(brief: HouseholdBrief, tools: string[]) {
  return {
    name: "Rollcall household call",
    platform_settings: { privacy: { record_voice: false } },
    conversation_config: {
      agent: {
        prompt: {
          prompt: systemPrompt(brief),
          llm: env.elevenlabs.llm,
          tool_ids: tools,
          built_in_tools: {
            end_call: {
              name: "end_call",
              description: "Hang up the call. Only call this after you have said goodbye to the caller in the same turn.",
              params: { system_tool_type: "end_call" },
            },
          },
        },
        first_message: brief.firstMessage,
        language: brief.language,
      },
      asr: { provider: "scribe_realtime", quality: "high", user_input_audio_format: PHONE_AUDIO, keywords: ["Altadena", "oxygen", "bedbound", "evacuation"] },
      turn: {
        turn_model: "turn_v3",
        turn_eagerness: env.elevenlabs.turnEagerness,
        // Never speak up on a quiet line ("Are you still there?"); hang up without a word after a
        // long silence, the same as the Cartesia stack.
        turn_timeout: -1,
        silence_end_call_timeout: QUIET_LINE_ENDS_AFTER_SECS,
        speculative_turn: true,
        interruption_ignore_terms: LISTENING_NOISES,
        soft_timeout_config: { timeout_seconds: 4.5, message: "One moment.", use_llm_generated_message: false },
      },
      tts: {
        model_id: ttsModelFor(brief.language),
        voice_id: env.elevenlabs.voiceId,
        agent_output_audio_format: PHONE_AUDIO,
        stability: 0.5,
        similarity_boost: 0.8,
        speed: 0.95,
      },
      conversation: { max_duration_seconds: 900, client_events: CLIENT_EVENTS },
    },
  };
}

export async function createAgent(brief: HouseholdBrief) {
  const { agent_id: agentId } = await post<{ agent_id: string }>("/v1/convai/agents/create", agentConfig(brief, await createTools()));
  return agentId;
}

export async function deleteAgent(agentId: string) {
  const response = await fetch(`${API_BASE}/v1/convai/agents/${agentId}`, { method: "DELETE", headers: headers() }).catch(() => null);
  if (response && !response.ok) console.warn(`[elevenlabs] agent delete returned ${response.status}`);
}
