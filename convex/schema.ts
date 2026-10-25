import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { hazard } from "./hazards";

// The shared contract. Every track reads and writes these tables.
// The owner column in PLAN.md "Contract" says who may change each table.

export const canLeave = v.union(v.literal("yes"), v.literal("no"), v.literal("unsure"));

// Mesh add-on traffic forecast (lib/crowd/forecast.ts). Every figure is a range over ensemble members.
const forecastRange = v.object({ median: v.union(v.number(), v.null()), p5: v.union(v.number(), v.null()), p95: v.union(v.number(), v.null()), n: v.number() });
export const trafficForecastFields = {
  issuedAt: v.number(),
  warningIssuedAt: v.number(),
  baseMinute: v.number(),
  horizonMinutes: v.number(),
  members: v.number(),
  households: v.number(),
  blockedSegments: v.number(),
  computeSeconds: v.number(),
  timeline: v.array(v.object({ minute: v.number(), moving: forecastRange, arrived: forecastRange, jammedShare: forecastRange, meanSpeed: forecastRange })),
  windows: v.array(
    v.object({
      from: v.number(),
      to: v.number(),
      streets: v.array(v.object({ name: v.string(), lostCarMinutes: forecastRange, slowdown: forecastRange, cars: forecastRange })),
      segments: v.array(v.object({ key: v.string(), lostCarMinutes: forecastRange, slowdown: forecastRange })),
    }),
  ),
};

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

// Where a real rider stands on the reach ladder workflow (convex/reachLadder.ts). The first four
// are live steps; the last three are how the ladder ended.
export const ladderStep = v.union(
  v.literal("waiting_to_retry"),
  v.literal("retry_due"),
  v.literal("retrying"),
  v.literal("awaiting_reply"),
  v.literal("reached"),
  v.literal("replied"),
  v.literal("door_check"),
);

export const reachLadder = v.object({
  workflowId: v.string(),
  step: ladderStep,
  // Voice attempts made in this ladder, the first miss included.
  attempt: v.number(),
  firstMissAt: v.number(),
  // Night-clock ms when the next step (a retry, or the door check) is due.
  nextStepAt: v.optional(v.number()),
  updatedAt: v.number(),
});

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
  v.literal("hazard_at_home"),
  v.literal("unservable"),
  v.literal("language_barrier"),
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

// Ready check (Track A): what a household told us before any disaster.
export const bedroomFloor = v.union(v.literal("ground"), v.literal("upstairs"), v.literal("basement"));
export const bedroomSide = v.union(v.literal("front"), v.literal("back"));
export const careNeed = v.union(
  v.literal("hearing"),
  v.literal("sight"),
  v.literal("memory"),
  v.literal("power_device"),
  v.literal("service_animal"),
);
export const exitPlan = v.union(v.literal("own_car"), v.literal("helper"), v.literal("needs_ride"));
export const readySource = v.union(v.literal("call"), v.literal("form"), v.literal("agency"));

export const readyProfile = v.object({
  at: v.number(),
  via: readySource,
  // A sign-up from /ready stays unverified until the agent confirms it by phone.
  verified: v.boolean(),
  exitPlan,
  // Where the person who needs help sleeps, so a crew knows where to go first.
  bedroom: v.optional(v.object({ floor: bedroomFloor, side: v.optional(bedroomSide) })),
  care: v.array(careNeed),
  note: v.optional(v.string()),
});

export const pickupStatus = v.union(
  v.literal("arranged"),
  v.literal("checking"),
  v.literal("coming"),
  v.literal("done"),
  v.literal("fell_through"),
);

export const pickupFailure = v.union(
  v.literal("helper_declined"),
  v.literal("helper_unreachable"),
  v.literal("helper_never_came"),
  v.literal("resident_unreachable"),
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
    // Track A: the Ready check profile, filled before any warning.
    ready: v.optional(readyProfile),
    // Track A: Ready check calls nobody answered.
    readyMisses: v.optional(v.number()),
    // Track A: how far 911 is looking for a neighbor to drive this home out, and since when (night
    // clock) nobody in that circle is being asked. Three quiet minutes widen the circle.
    neighborSearch: v.optional(v.object({ reachMeters: v.number(), idleSince: v.optional(v.number()) })),
    // Track B: the reach ladder workflow for a real rider nobody has reached yet.
    ladder: v.optional(reachLadder),
    simulated: v.boolean(),
  })
    .index("by_callStatus_and_callPriority", ["callStatus", "callPriority"])
    .index("by_outcome", ["outcome"])
    .index("by_callbackNumber", ["callbackNumber"]),

  // Track B: the call order Claude chose for one warning, most urgent first (convex/callPlans.ts).
  callPlans: defineTable({
    warningIssuedAt: v.number(),
    model: v.string(),
    ranked: v.array(v.object({ householdId: v.id("households"), reason: v.string() })),
    plannedAt: v.number(),
  }).index("by_warningIssuedAt", ["warningIssuedAt"]),

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
    // Agent lines on real calls: ms from the resident finishing to the agent's first audio.
    latencyMs: v.optional(v.number()),
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
    // Track C: people dropped off here so far.
    occupied: v.optional(v.number()),
  }),

  plans: defineTable({
    version: v.number(),
    solver: v.union(v.literal("stand_in"), v.literal("heuristic"), v.literal("ortools"), v.literal("alns")),
    solveMs: v.number(),
    // Track C: the size of the problem this plan solved, for the solver panel.
    requestCount: v.optional(v.number()),
    vehicleCount: v.optional(v.number()),
    // Why the heuristic ran instead of the solver service ("solver service unreachable"), when it did.
    fallbackReason: v.optional(v.string()),
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
    // When Track C last recomputed etaMinutes from the vehicle's position.
    etaUpdatedAt: v.optional(v.number()),
  })
    .index("by_requestId", ["requestId"])
    .index("by_vehicleId", ["vehicleId"])
    .index("by_status", ["status"])
    // Track C: a vehicle's accepted run in stop order, without reading its whole history.
    .index("by_vehicleId_and_status_and_stopOrder", ["vehicleId", "status", "stopOrder"]),

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
    // Every directed edge this closure shuts, both directions, once Track C has snapped it.
    edgeKeys: v.optional(v.array(v.string())),
    streets: v.optional(v.array(v.string())),
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
    // Track D: why a nomination couldn't be matched ("no house number", "two streets match"), for the dispatcher.
    note: v.optional(v.string()),
    at: v.number(),
  }).index("by_status", ["status"]),

  zones: defineTable({
    polygon: v.array(point),
    drawnAt: v.number(),
  }),

  // Evacuation zones the Apify Actor reported, one row per external zone. The row makes a repeated post a no-op.
  // warningIssuedAt is control.warningIssuedAt after the zone was applied, so a reset (which clears it) lets the zone apply again.
  apifyZones: defineTable({
    key: v.string(),
    name: v.string(),
    status: v.union(v.literal("warning"), v.literal("order")),
    rings: v.array(v.array(point)),
    ridersInside: v.number(),
    warningIssuedAt: v.optional(v.number()),
    receivedAt: v.number(),
  }).index("by_key", ["key"]),

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

  // Track D singleton. The on-screen smoothing toggle, plus what the model runner last did.
  modelState: defineTable({
    // Spatial smoothing of need estimates from answered neighbors. Toggled on screen.
    smoothing: v.boolean(),
    // Door-check aging weight, fixed once per incident (keyed by warningIssuedAt) so the order is stable.
    doorAlpha: v.optional(v.number()),
    incidentKey: v.optional(v.number()),
    // The last pass on the night's clock (shown), and on the wall clock (whether the runner is alive,
    // since faster playback stretches the runner's real-time cadence).
    lastRunAt: v.optional(v.number()),
    lastRunWallAt: v.optional(v.number()),
    // Counts from the last run: households estimated, door checks scored, closures added, matches.
    stats: v.optional(v.record(v.string(), v.number())),
  }),

  // Track C singleton: the re-planner's lock and what its last run did.
  dispatchState: defineTable({
    replanStartedAt: v.optional(v.number()),
    lastReplanAt: v.number(),
    // Closures already planned around. A new one triggers a re-plan right away.
    closuresSeen: v.number(),
    lastSolver: v.optional(v.union(v.literal("heuristic"), v.literal("ortools"), v.literal("alns"))),
    lastSolveMs: v.optional(v.number()),
    lastFallbackReason: v.optional(v.string()),
    lastError: v.optional(v.string()),
    replans: v.number(),
  }),

  // Track C: the road path each vehicle is driving now. The rescue map can draw these.
  vehicleRoutes: defineTable({
    vehicleId: v.id("vehicles"),
    target: v.union(
      v.object({ kind: v.literal("pickup"), assignmentId: v.id("assignments") }),
      v.object({ kind: v.literal("shelter"), shelterId: v.id("shelters") }),
    ),
    path: v.array(point),
    legSeconds: v.array(v.number()),
    // Road seconds already driven along `path`.
    progressSeconds: v.number(),
    // Closures this path was computed around. When it changes, the path is recomputed.
    closuresSeen: v.number(),
    // Boarding: the vehicle waits at the pickup until then.
    dwellUntil: v.optional(v.number()),
    // When the vehicle row's lat/lng was last written from this route.
    positionWrittenAt: v.optional(v.number()),
    updatedAt: v.number(),
  }).index("by_vehicleId", ["vehicleId"]),

  // Track C: riders on board each vehicle, kept by the movement tick so it never rescans history.
  vehicleLoads: defineTable({
    vehicleId: v.id("vehicles"),
    riders: v.array(v.object({ requestId: v.id("requests"), shelterId: v.optional(v.id("shelters")), load })),
  }).index("by_vehicleId", ["vehicleId"]),

  // Track A: a helper who agreed ahead of time to pick a household up. The pickup check calls them
  // the moment a warning covers the household, and a broken promise becomes a ride request.
  pickupPlans: defineTable({
    householdId: v.id("households"),
    helperName: v.string(),
    helperPhone: v.string(),
    // "neighbor", "daughter": said on the call so the helper knows who is asking.
    relation: v.optional(v.string()),
    // Set when the helper lives in the area: the rescue map draws the pickup from their home.
    helperHouseholdId: v.optional(v.id("households")),
    // A neighbor driving out whom 911 asked during the warning, with no arrangement beforehand.
    recruited: v.optional(v.boolean()),
    status: pickupStatus,
    reason: v.optional(pickupFailure),
    // Which call is ringing right now, if any. The rescue map shows the phone ringing.
    ringing: v.optional(v.union(v.literal("helper"), v.literal("resident"))),
    helperAttempts: v.number(),
    residentAttempts: v.number(),
    lastAttemptAt: v.optional(v.number()),
    checkStartedAt: v.optional(v.number()),
    helperEtaAt: v.optional(v.number()),
    // When the resident heard that their helper said yes, on the call they were on or a new one.
    residentToldAt: v.optional(v.number()),
    updatedAt: v.number(),
    simulated: v.boolean(),
  })
    .index("by_householdId", ["householdId"])
    .index("by_status", ["status"]),

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
    hazard: v.optional(hazard),
    // Set once householdCounts:backfill has filled the call-floor count aggregates.
    householdCountsReadyAt: v.optional(v.number()),
    // Track A: the Ready check campaign, before any warning. Bumping the generation stops a run.
    readyCheckStartedAt: v.optional(v.number()),
    readyCheckRunning: v.optional(v.boolean()),
    readyCheckGeneration: v.optional(v.number()),
    // Track A: the night's clock (lib/sim-clock.ts). Absent means it reads the wall clock.
    clock: v.optional(v.object({ speed: v.number(), realAt: v.number(), simAt: v.number(), ranMs: v.number() })),
  }),

  // Mesh add-on (lib/mesh, convex/mesh.ts). Separate from the core flow: nothing above reads these.
  // Anonymous road reports that phones passed to each other offline and a phone with internet
  // uploaded. No phone, person or uploader id is stored; times are rounded to the minute.
  meshReports: defineTable({
    reportId: v.string(),
    segment: v.string(),
    status: v.union(v.literal("blocked"), v.literal("clear")),
    cause: v.optional(v.string()),
    observedAt: v.number(),
    hops: v.number(),
    receivedAt: v.number(),
  })
    .index("by_reportId", ["reportId"])
    .index("by_observedAt", ["observedAt"]),

  // The shared street-blockage model, one row per version. `first`/`second` are the server
  // optimizer's state and never leave the server.
  meshModels: defineTable({
    version: v.number(),
    weights: v.array(v.number()),
    issuedAt: v.number(),
    contributors: v.number(),
    first: v.array(v.number()),
    second: v.array(v.number()),
    round: v.optional(v.object({ mass: v.number(), uploads: v.number(), staleMass: v.number() })),
  }).index("by_version", ["version"]),

  // Singleton: the round collecting mixes for the current model.
  meshRound: defineTable({
    baseVersion: v.number(),
    sum: v.array(v.number()),
    mass: v.number(),
    uploads: v.number(),
    staleMass: v.number(),
    refused: v.number(),
  }),

  // The traffic forecast the Langevin crowd model runner (scripts/mesh/traffic-forecast.ts) publishes
  // for the agency view. Simulated traffic of the synthetic town, with ranges over ensemble members.
  meshTrafficForecasts: defineTable(trafficForecastFields).index("by_issuedAt", ["issuedAt"]),

  // Readiness survey add-on (lib/prepare, convex/prepare.ts). Separate from the core flow and the
  // mesh: nothing else reads these. Households' answers never arrive here, only mixes of five or
  // more households' noised model updates and randomized-response counts. No phone, person or
  // uploader id is stored.
  // Each shared model, one row per task and version. `first`/`second` are the server optimizer's
  // state and never leave the server.
  prepareModels: defineTable({
    task: v.string(),
    version: v.number(),
    weights: v.array(v.number()),
    issuedAt: v.number(),
    contributors: v.number(),
    // The share of households asked to train this version (lib/prepare/tasks.ts).
    sampleRate: v.number(),
    first: v.array(v.number()),
    second: v.array(v.number()),
    round: v.optional(v.object({ mass: v.number(), uploads: v.number(), staleMass: v.number() })),
  }).index("by_task_version", ["task", "version"]),

  // One per task: the round collecting mixes for that task's current model.
  prepareRounds: defineTable({
    task: v.string(),
    baseVersion: v.number(),
    sum: v.array(v.number()),
    mass: v.number(),
    uploads: v.number(),
    staleMass: v.number(),
  }).index("by_task", ["task"]),

  // One per survey campaign: the summed counts, area by area (layout in lib/prepare/tally.ts), and
  // how many mixes of any kind the county refused.
  prepareTallies: defineTable({
    campaign: v.string(),
    sum: v.array(v.number()),
    mass: v.number(),
    uploads: v.number(),
    refused: v.number(),
  }).index("by_campaign", ["campaign"]),
});
