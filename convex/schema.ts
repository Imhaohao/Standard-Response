import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// The shared contract. Every team service reads and writes these tables.
// Change a field here only after telling its owners (see README "Who writes what").

export const canLeave = v.union(v.literal("yes"), v.literal("no"), v.literal("unsure"));

export const mobility = v.union(
  v.literal("walks"),
  v.literal("walker"),
  v.literal("manual_wheelchair"),
  v.literal("power_wheelchair"),
  v.literal("bedbound"),
);

export const medicalNeed = v.union(v.literal("oxygen"), v.literal("dialysis"), v.literal("other"));

export const callStatus = v.union(
  v.literal("not_called"),
  v.literal("in_call"),
  v.literal("no_answer"),
  v.literal("texted"),
  v.literal("door_check"),
  v.literal("complete"),
);

export const outcome = v.union(
  v.literal("unknown"),
  v.literal("leaving"),
  v.literal("needs_ride"),
  v.literal("needs_accessible"),
  v.literal("unreachable"),
);

export const callStage = v.union(
  v.literal("greet"),
  v.literal("confirm_address"),
  v.literal("can_leave"),
  v.literal("household"),
  v.literal("needs"),
  v.literal("readback"),
  v.literal("close"),
);

export const callPhase = v.union(
  v.literal("ringing"),
  v.literal("live"),
  v.literal("ended"),
  v.literal("no_answer"),
);

export const vehicleType = v.union(
  v.literal("paratransit"),
  v.literal("bus"),
  v.literal("fire_unit"),
  v.literal("ambulance"),
  v.literal("volunteer"),
);

export const householdFields = {
  address: v.string(),
  lat: v.number(),
  lng: v.number(),
  callbackNumber: v.string(),
  language: v.string(),
  canLeave: v.optional(canLeave),
  peopleCount: v.optional(v.number()),
  mobility: v.optional(mobility),
  medical: v.optional(v.array(medicalNeed)),
  pets: v.optional(v.boolean()),
  hasCar: v.optional(v.boolean()),
  confidence: v.optional(v.record(v.string(), v.number())),
};

export default defineSchema({
  households: defineTable({
    ...householdFields,
    callStatus,
    outcome,
    attempts: v.number(),
    lastAttemptAt: v.optional(v.number()),
    // Census block-group prior (ACS rates). Public data, never ground truth.
    needPrior: v.number(),
    // Written by the need model (David). Probability 0-1 that this home needs help.
    needProbability: v.number(),
    // Written by the fire model (David). Epoch ms when fire is predicted to arrive.
    fireArrivalAt: v.number(),
    // Higher is called sooner. Derived from the two fields above.
    callPriority: v.number(),
    simulated: v.boolean(),
  })
    .index("by_callStatus_and_callPriority", ["callStatus", "callPriority"])
    .index("by_outcome", ["outcome"]),

  calls: defineTable({
    householdId: v.id("households"),
    direction: v.union(v.literal("inbound"), v.literal("outbound")),
    phase: callPhase,
    stage: callStage,
    language: v.string(),
    attempt: v.number(),
    startedAt: v.number(),
    endedAt: v.optional(v.number()),
    simulated: v.boolean(),
  })
    .index("by_phase", ["phase"])
    .index("by_householdId", ["householdId"]),

  transcriptLines: defineTable({
    callId: v.id("calls"),
    speaker: v.union(v.literal("agent"), v.literal("resident")),
    text: v.string(),
    at: v.number(),
  }).index("by_callId", ["callId"]),

  events: defineTable({
    kind: v.union(
      v.literal("call"),
      v.literal("record"),
      v.literal("retry"),
      v.literal("model"),
      v.literal("dispatch"),
      v.literal("control"),
    ),
    message: v.string(),
    householdId: v.optional(v.id("households")),
    at: v.number(),
  }),

  vehicles: defineTable({
    label: v.string(),
    type: vehicleType,
    driverName: v.string(),
    lat: v.number(),
    lng: v.number(),
    seats: v.number(),
    wheelchairSpaces: v.number(),
    stretcherSpaces: v.number(),
  }),

  assignments: defineTable({
    householdId: v.id("households"),
    vehicleId: v.id("vehicles"),
    etaMinutes: v.number(),
    approved: v.boolean(),
    calledBack: v.boolean(),
  }).index("by_householdId", ["householdId"]),

  // Ground-truth cards for simulated residents. Only the stand-in voice agent
  // and the call-accuracy evaluation may read this; real agents must not.
  personas: defineTable({
    householdId: v.id("households"),
    name: v.string(),
    age: v.number(),
    answersPhone: v.number(),
    repliesToText: v.boolean(),
    truth: v.object({
      canLeave,
      peopleCount: v.number(),
      mobility,
      medical: v.array(medicalNeed),
      pets: v.boolean(),
      hasCar: v.boolean(),
    }),
  }).index("by_householdId", ["householdId"]),

  // Singleton row. Operator controls plus one switch per stand-in.
  control: defineTable({
    warningIssuedAt: v.optional(v.number()),
    dialerRunning: v.boolean(),
    maxConcurrentCalls: v.number(),
    simulateVoice: v.boolean(),
    simulateNeedModel: v.boolean(),
    tickGeneration: v.number(),
  }),
});
