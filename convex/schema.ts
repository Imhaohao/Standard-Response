import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// The shared contract. Every track reads and writes these tables.
// The owner column in PLAN.md "Contract" says who may change each table.

export const canLeave = v.union(v.literal("yes"), v.literal("no"), v.literal("unsure"));

export const mobility = v.union(
  v.literal("walks"),
  v.literal("walker"),
  v.literal("manual_wheelchair"),
  v.literal("power_wheelchair"),
  v.literal("bedbound"),
);

export const assistanceRequired = v.union(
  v.literal("none"),
  v.literal("one_person_assist"),
  v.literal("two_person_lift"),
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

export const escalation = v.union(
  v.literal("address_unconfirmed"),
  v.literal("medical"),
  v.literal("flames"),
  v.literal("unservable"),
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

export const requestStatus = v.union(
  v.literal("received"),
  v.literal("approved"),
  v.literal("driver_accepted"),
  v.literal("en_route"),
  v.literal("reassigning"),
  v.literal("arrived"),
  v.literal("closed"),
);

export const assignmentStatus = v.union(
  v.literal("proposed"),
  v.literal("offered"),
  v.literal("accepted"),
  v.literal("declined"),
  v.literal("expired"),
  v.literal("replaced"),
  v.literal("revoked"),
  v.literal("completed"),
);

export const vehicleType = v.union(
  v.literal("paratransit"),
  v.literal("bus"),
  v.literal("fire_unit"),
  v.literal("ambulance"),
);

export const closureSource = v.union(
  v.literal("hazard"),
  v.literal("driver"),
  v.literal("resident"),
  v.literal("manual"),
);

export const point = v.object({ lat: v.number(), lng: v.number() });

export const load = v.object({
  seats: v.number(),
  wheelchairSpaces: v.number(),
  stretcherSpaces: v.number(),
});

export const correction = v.object({
  field: v.string(),
  from: v.string(),
  to: v.string(),
  at: v.number(),
});

export const auditKind = v.union(
  v.literal("plan"),
  v.literal("approved"),
  v.literal("accepted"),
  v.literal("stale_accept_rejected"),
  v.literal("declined"),
  v.literal("expired"),
  v.literal("replaced"),
  v.literal("revoked"),
  v.literal("callback_queued"),
  v.literal("callback_duplicate"),
  v.literal("status"),
);

export const householdFields = {
  address: v.string(),
  // Optional until an inbound caller's address is matched to a point.
  lat: v.optional(v.number()),
  lng: v.optional(v.number()),
  callbackNumber: v.string(),
  language: v.string(),
  riderId: v.optional(v.string()),
  residentName: v.optional(v.string()),
  canLeave: v.optional(canLeave),
  peopleCount: v.optional(v.number()),
  mobility: v.optional(mobility),
  assistanceRequired: v.optional(assistanceRequired),
  medical: v.optional(v.array(medicalNeed)),
  pets: v.optional(v.boolean()),
  hasCar: v.optional(v.boolean()),
  confidence: v.optional(v.record(v.string(), v.number())),
  corrections: v.optional(v.array(correction)),
};

export default defineSchema({
  households: defineTable({
    ...householdFields,
    callStatus,
    outcome,
    escalation: v.optional(escalation),
    // True when the household sits inside the current warning zone. Only these get called.
    inZone: v.boolean(),
    attempts: v.number(),
    lastAttemptAt: v.optional(v.number()),
    // Census base rate (Track D). Public data, never ground truth.
    needPrior: v.number(),
    // Track D. Probability 0-1 that this home needs help.
    needProbability: v.number(),
    // Track D hazard. Epoch ms when the hazard scenario reaches this home.
    fireArrivalAt: v.number(),
    // Higher is called sooner. Derived from the two fields above.
    callPriority: v.number(),
    // Track D door-check score. Higher is knocked on sooner.
    doorPriority: v.optional(v.number()),
    simulated: v.boolean(),
  })
    .index("by_callStatus_and_callPriority", ["callStatus", "callPriority"])
    .index("by_outcome", ["outcome"])
    .index("by_callbackNumber", ["callbackNumber"]),

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
    // Request status when an agent line was spoken. The honesty grader reads this.
    requestStatus: v.optional(requestStatus),
    at: v.number(),
  }).index("by_callId", ["callId"]),

  // The text channel. SMS registration won't clear, so these show on the simulated phone panel.
  texts: defineTable({
    householdId: v.id("households"),
    direction: v.union(v.literal("outbound"), v.literal("inbound")),
    body: v.string(),
    at: v.number(),
  }).index("by_householdId", ["householdId"]),

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

  requests: defineTable({
    householdId: v.id("households"),
    status: requestStatus,
    load,
    crewNeeded: v.number(),
    needsLift: v.boolean(),
    boardingMinutes: v.number(),
    deadlineAt: v.number(),
    weight: v.number(),
    updatedAt: v.number(),
  })
    .index("by_status", ["status"])
    .index("by_householdId", ["householdId"]),

  vehicles: defineTable({
    label: v.string(),
    type: vehicleType,
    driverName: v.string(),
    lat: v.number(),
    lng: v.number(),
    seats: v.number(),
    wheelchairSpaces: v.number(),
    stretcherSpaces: v.number(),
    crewSize: v.number(),
    liftCapable: v.boolean(),
    shiftEndsAt: v.number(),
    // False for the vehicles a teammate drives from the driver page during the demo.
    driverIsSimulated: v.boolean(),
  }),

  shelters: defineTable({
    name: v.string(),
    lat: v.number(),
    lng: v.number(),
    capacity: v.number(),
  }),

  plans: defineTable({
    version: v.number(),
    solver: v.union(v.literal("stand_in"), v.literal("heuristic"), v.literal("ortools")),
    solveMs: v.number(),
    changes: v.array(
      v.object({
        kind: v.union(v.literal("offer"), v.literal("replace"), v.literal("revoke")),
        requestId: v.id("requests"),
        vehicleId: v.optional(v.id("vehicles")),
      }),
    ),
    createdAt: v.number(),
  }).index("by_version", ["version"]),

  assignments: defineTable({
    requestId: v.id("requests"),
    householdId: v.id("households"),
    vehicleId: v.id("vehicles"),
    shelterId: v.optional(v.id("shelters")),
    planVersion: v.number(),
    status: assignmentStatus,
    etaMinutes: v.number(),
    // Position in the vehicle's run. New offers must come after every accepted stop.
    stopOrder: v.number(),
    proposedAt: v.number(),
    offeredAt: v.optional(v.number()),
    respondedAt: v.optional(v.number()),
  })
    .index("by_requestId", ["requestId"])
    .index("by_vehicleId", ["vehicleId"])
    .index("by_status", ["status"]),

  // One row per thing the resident must be told. The key makes a repeated event a no-op.
  callbacks: defineTable({
    key: v.string(),
    requestId: v.id("requests"),
    assignmentId: v.id("assignments"),
    householdId: v.id("households"),
    announces: v.union(v.literal("driver_accepted"), v.literal("reassigning")),
    state: v.union(v.literal("pending"), v.literal("placed"), v.literal("played"), v.literal("unanswered")),
    createdAt: v.number(),
    placedAt: v.optional(v.number()),
    playedAt: v.optional(v.number()),
  })
    .index("by_key", ["key"])
    .index("by_state", ["state"]),

  roadClosures: defineTable({
    // OSM edge id as "u-v-key" once Track C snaps the path to the road graph.
    edgeKey: v.optional(v.string()),
    path: v.array(point),
    source: closureSource,
    confirmed: v.boolean(),
    at: v.number(),
  }).index("by_edgeKey", ["edgeKey"]),

  nominations: defineTable({
    fromHouseholdId: v.optional(v.id("households")),
    spokenAddress: v.string(),
    status: v.union(v.literal("open"), v.literal("matched"), v.literal("unmatched")),
    matchedHouseholdId: v.optional(v.id("households")),
    at: v.number(),
  }).index("by_status", ["status"]),

  zones: defineTable({
    polygon: v.array(point),
    drawnAt: v.number(),
  }),

  auditLog: defineTable({
    kind: auditKind,
    message: v.string(),
    requestId: v.optional(v.id("requests")),
    assignmentId: v.optional(v.id("assignments")),
    planVersion: v.optional(v.number()),
    at: v.number(),
  }),

  // Ground-truth cards for simulated residents. Only stand-ins and the evaluation may read this.
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
      assistanceRequired,
      medical: v.array(medicalNeed),
      pets: v.boolean(),
      hasCar: v.boolean(),
    }),
    // What the resident says first before correcting it, for correction test cases.
    correction: v.optional(v.object({ field: v.string(), firstSays: v.string() })),
  }).index("by_householdId", ["householdId"]),

  // Singleton row. Operator controls plus one switch per stand-in.
  control: defineTable({
    warningIssuedAt: v.optional(v.number()),
    dialerRunning: v.boolean(),
    maxConcurrentCalls: v.number(),
    simulateVoice: v.boolean(),
    simulateNeedModel: v.boolean(),
    simulateDispatch: v.boolean(),
    simulateDrivers: v.boolean(),
    autoApprove: v.boolean(),
    tickGeneration: v.number(),
  }),
});
