import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { hazard } from "./hazards";

// The shared contract. Every part of the system reads and writes these tables.
// The owner column in PLAN.md "Contract" says who may change each table.

export const canLeave = v.union(v.literal("yes"), v.literal("no"), v.literal("unsure"));

// Mesh add-on traffic forecast (lib/crowd/forecast.ts). Every figure is a range over ensemble members.
const forecastRange = v.object({ median: v.union(v.number(), v.null()), p5: v.union(v.number(), v.null()), p95: v.union(v.number(), v.null()), n: v.number() });
const forecastWindow = {
  from: v.number(),
  to: v.number(),
  streets: v.array(v.object({ name: v.string(), lostCarMinutes: forecastRange, slowdown: forecastRange, cars: forecastRange })),
  segments: v.array(v.object({ key: v.string(), lostCarMinutes: forecastRange, slowdown: forecastRange })),
};
export const trafficForecastFields = {
  issuedAt: v.number(),
  warningIssuedAt: v.number(),
  baseMinute: v.number(),
  // The night's clock (lib/sim-clock.ts) at baseMinute: window minutes count from here. Missing on
  // forecasts made before it was recorded.
  baseAt: v.optional(v.number()),
  horizonMinutes: v.number(),
  members: v.number(),
  households: v.number(),
  blockedSegments: v.number(),
  computeSeconds: v.number(),
  timeline: v.array(v.object({ minute: v.number(), moving: forecastRange, arrived: forecastRange, jammedShare: forecastRange, meanSpeed: forecastRange })),
  windows: v.array(v.object(forecastWindow)),
};
// What the runner sends: the forecast, plus each window's slowdown by direction of each street
// (directed edge key), which `mesh:publishTrafficForecast` keeps apart in `meshDriveTimes`.
export const trafficForecastArgs = {
  ...trafficForecastFields,
  baseAt: v.number(),
  windows: v.array(v.object({ ...forecastWindow, edges: v.array(v.object({ key: v.string(), slowdown: forecastRange })) })),
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

// Who a pickup call is for and why. The same values as `PlanRole` and `PlanPurpose` in voice/agent.
export const pickupRole = v.union(v.literal("helper"), v.literal("resident"));
export const pickupPurpose = v.union(v.literal("ask"), v.literal("confirm"), v.literal("notice"));

export const callFlow = v.union(
  v.object({ kind: v.literal("pickup"), planId: v.id("pickupPlans"), role: pickupRole, purpose: pickupPurpose }),
  v.object({ kind: v.literal("ready") }),
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
  // Full road closures from the "California evacuation status" Apify Actor (Caltrans lane closure feeds).
  v.literal("apify"),
);

// Ready check: what a household told us before any disaster.
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
  // The resident said no to the ride when we called to confirm it.
  v.literal("resident_declined"),
  // A later call changed the resident's needs so a neighbor's car can no longer take them.
  v.literal("needs_changed"),
  // A later call said the resident can get out on their own.
  v.literal("not_needed"),
);

// What one side of a pickup still has to hear from us. The helper hears that the resident confirmed
// and will be ready, or that the pickup is off; the resident hears that their helper can't come.
export const helperNotice = v.union(v.literal("resident_ready"), v.literal("called_off"));
export const residentNotice = v.literal("helper_cancelled");

export const point = v.object({ lat: v.number(), lng: v.number() });

// A volunteer's mileage payment (convex/reimburse.ts). `sending` means an attempt holds it right now;
// `nothing_owed` is a ride with no distance on file.
export const reimbursementStatus = v.union(
  v.literal("pending"),
  v.literal("sending"),
  v.literal("paid"),
  v.literal("failed"),
  v.literal("not_configured"),
  v.literal("nothing_owed"),
);

export const rideParty =v.union(v.literal("patient"), v.literal("companions"));

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
  // Nobody is at the home: the resident said on a call that they're somewhere else and no one else
  // is there. Counted as safe: no ride, no neighbor sent, and never asked to drive for someone.
  away: v.optional(v.boolean()),
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
    // Census base rate. Public data, never ground truth.
    needPrior: v.number(),
    // Need model. Probability 0-1 that this home needs help.
    needProbability: v.number(),
    // Hazard runner. Epoch ms when the hazard scenario reaches this home.
    fireArrivalAt: v.number(),
    // Higher is called sooner. Derived from the two fields above.
    callPriority: v.number(),
    // Door-check score. Higher is knocked on sooner.
    doorPriority: v.optional(v.number()),
    // The Ready check profile, filled before any warning.
    ready: v.optional(readyProfile),
    // Ready check calls nobody answered.
    readyMisses: v.optional(v.number()),
    // How far 911 is looking for a neighbor to drive this home out, and since when (night
    // clock) nobody in that circle is being asked. Three quiet minutes widen the circle.
    neighborSearch: v.optional(v.object({ reachMeters: v.number(), idleSince: v.optional(v.number()) })),
    // Night clock when this neighbor turned down picking someone up. 911 asks them for nobody else tonight.
    helperDeclinedAt: v.optional(v.number()),
    // The reach ladder workflow for a real rider nobody has reached yet.
    ladder: v.optional(reachLadder),
    simulated: v.boolean(),
    // What a home had before a real number replaced its fictional one, so taking the number off puts
    // it back (convex/riders.ts).
    standIn: v.optional(v.object({ callbackNumber: v.string(), residentName: v.optional(v.string()), simulated: v.boolean() })),
  })
    .index("by_callStatus_and_callPriority", ["callStatus", "callPriority"])
    .index("by_outcome", ["outcome"])
    .index("by_callbackNumber", ["callbackNumber"])
    // The incident purge finds real riders' rows without scanning the table (convex/incident.ts).
    .index("by_simulated", ["simulated"]),

  // The call order Claude chose for one warning, most urgent first (convex/callPlans.ts).
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
    // Set on a pickup-check or Ready-check call. It's about `householdId` (for a pickup, the home
    // being picked up) and shows on the call floor, but it isn't that home's warning call: ending it
    // leaves the home's call status and retries alone.
    flow: v.optional(callFlow),
    // The call floor asked to hang this call up from our side (wall clock). The voice server does it.
    hangUpRequestedAt: v.optional(v.number()),
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
    // The call the event came out of, when it did: the activity list opens its transcript.
    callId: v.optional(v.id("calls")),
    at: v.number(),
  }),

  requests: defineTable({
    householdId: v.id("households"),
    status: requestStatus,
    // Set when no one vehicle can carry the whole home: the patient's ride, or everyone else's.
    party: v.optional(rideParty),
    load,
    crewNeeded: v.number(),
    needsLift: v.boolean(),
    boardingMinutes: v.number(),
    deadlineAt: v.number(),
    weight: v.number(),
    updatedAt: v.number(),
  })
    .index("by_status", ["status"])
    .index("by_householdId", ["householdId"])
    // The open request for a home, however many closed ones it has behind it.
    .index("by_householdId_and_status", ["householdId", "status"]),

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
    // People dropped off here so far.
    occupied: v.optional(v.number()),
  }),

  plans: defineTable({
    version: v.number(),
    solver: v.union(v.literal("stand_in"), v.literal("heuristic"), v.literal("ortools"), v.literal("alns")),
    solveMs: v.number(),
    // The size of the problem this plan solved, for the solver panel.
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
    // When the dispatcher last recomputed etaMinutes from the vehicle's position.
    etaUpdatedAt: v.optional(v.number()),
    // Night clock when the vehicle reached the home and the rider boarded (status "completed").
    completedAt: v.optional(v.number()),
  })
    .index("by_requestId", ["requestId"])
    // A request's live offer, however many re-plans and expiries came before it.
    .index("by_requestId_and_status", ["requestId", "status"])
    .index("by_vehicleId", ["vehicleId"])
    .index("by_status", ["status"])
    // A vehicle's accepted run in stop order, without reading its whole history.
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
    // OSM edge id as "u-v-key" once the dispatcher snaps the path to the road graph.
    edgeKey: v.optional(v.string()),
    // Every directed edge this closure shuts, both directions, once the dispatcher has snapped it.
    edgeKeys: v.optional(v.array(v.string())),
    streets: v.optional(v.array(v.string())),
    path: v.array(point),
    source: closureSource,
    // The outside record this closure came from ("caltrans-lcs:<id>" for Apify), so a repeat post is
    // ignored and a closure the source lifts is reopened.
    sourceKey: v.optional(v.string()),
    confirmed: v.boolean(),
    at: v.number(),
  })
    .index("by_edgeKey", ["edgeKey"])
    .index("by_sourceKey", ["sourceKey"]),

  nominations: defineTable({
    fromHouseholdId: v.optional(v.id("households")),
    spokenAddress: v.string(),
    status: v.union(v.literal("open"), v.literal("matched"), v.literal("unmatched")),
    matchedHouseholdId: v.optional(v.id("households")),
    // Why a nomination couldn't be matched ("no house number", "two streets match"), for the dispatcher.
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
  // The judges' kiosk at `/` (convex/claims.ts). One row per sign-in: the big screen shows its code as
  // a QR, the judge's phone (or the kiosk's own form) sends a number, and the kiosk advances. Holds a
  // judge's real number until `claims:clearAll`.
  kioskSessions: defineTable({
    code: v.string(),
    createdAt: v.number(),
    phone: v.optional(v.string()),
    phoneSubmissions: v.number(),
    householdId: v.optional(v.id("households")),
    claimedAt: v.optional(v.number()),
  })
    .index("by_code", ["code"])
    .index("by_createdAt", ["createdAt"]),

  // A judge took a demo house: their number is on it (through riders.ts) and `record` is what the
  // house said before, so `claims:clearAll` can put it back.
  claims: defineTable({
    householdId: v.id("households"),
    phone: v.string(),
    claimedAt: v.number(),
    // The judge's phone follows the house at /you/<statusToken> (convex/claimStatus.ts). Unguessable,
    // and gone with the claim when `claims:clearAll` runs.
    statusToken: v.optional(v.string()),
    record: v.object({
      language: v.string(),
      canLeave: v.optional(canLeave),
      peopleCount: v.optional(v.number()),
      mobility: v.optional(mobility),
      assistanceRequired: v.optional(assistanceRequired),
      medical: v.optional(v.array(medicalNeed)),
      pets: v.optional(v.boolean()),
      hasCar: v.optional(v.boolean()),
      outcome,
      ready: v.optional(readyProfile),
      helperDeclinedAt: v.optional(v.number()),
    }),
  })
    .index("by_householdId", ["householdId"])
    .index("by_phone", ["phone"])
    .index("by_statusToken", ["statusToken"]),

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

  // Singleton. The on-screen smoothing toggle, plus what the model runner last did.
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

  // Singleton: bumped by every closure written, lifted or snapped, so the loops that run every tick
  // learn that the closures changed from this one row instead of reading them all.
  roadState: defineTable({ version: v.number() }),

  // Singleton: the re-planner's lock and what its last run did.
  dispatchState: defineTable({
    replanStartedAt: v.optional(v.number()),
    lastReplanAt: v.number(),
    // The roadState version of the closures already planned around. Any closure added, lifted or
    // snapped since triggers a re-plan right away.
    closuresSeen: v.number(),
    lastSolver: v.optional(v.union(v.literal("heuristic"), v.literal("ortools"), v.literal("alns"))),
    lastSolveMs: v.optional(v.number()),
    lastFallbackReason: v.optional(v.string()),
    lastError: v.optional(v.string()),
    replans: v.number(),
  }),

  // The road path each vehicle is driving now. The rescue map can draw these.
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
    // The roadState version this path was computed around. When it changes, the path is recomputed.
    closuresSeen: v.number(),
    // Boarding: the vehicle waits at the pickup until then.
    dwellUntil: v.optional(v.number()),
    // When the vehicle row's lat/lng was last written from this route.
    positionWrittenAt: v.optional(v.number()),
    updatedAt: v.number(),
  }).index("by_vehicleId", ["vehicleId"]),

  // Riders on board each vehicle, kept by the movement tick so it never rescans history.
  vehicleLoads: defineTable({
    vehicleId: v.id("vehicles"),
    riders: v.array(v.object({ requestId: v.id("requests"), shelterId: v.optional(v.id("shelters")), load })),
  }).index("by_vehicleId", ["vehicleId"]),

  // The latest one-truck drill (convex/truckDrill.ts): one fire engine's whole run, worked out at
  // once and played back on the rescue map from `ranAt`. Times are seconds after the warning.
  truckDrills: defineTable({
    ranAt: v.number(),
    playbackRate: v.number(),
    source: v.union(v.literal("board"), v.literal("simulated_area")),
    speedMph: v.number(),
    seats: v.number(),
    station: v.object({ name: v.string(), lat: v.number(), lng: v.number() }),
    shelter: v.object({ name: v.string(), lat: v.number(), lng: v.number() }),
    endSeconds: v.number(),
    trucksNeeded: v.union(v.number(), v.null()),
    legs: v.array(v.object({ startSeconds: v.number(), path: v.array(v.object({ lat: v.number(), lng: v.number() })), legSeconds: v.array(v.number()) })),
    stops: v.array(
      v.object({
        kind: v.union(v.literal("board"), v.literal("too_late"), v.literal("unload")),
        home: v.union(v.number(), v.null()),
        atSeconds: v.number(),
        dwellSeconds: v.number(),
        onboard: v.number(),
      }),
    ),
    homes: v.array(
      v.object({
        householdId: v.optional(v.id("households")),
        address: v.string(),
        lat: v.number(),
        lng: v.number(),
        people: v.number(),
        fireSeconds: v.number(),
        reachedSeconds: v.union(v.number(), v.null()),
        outcome: v.union(v.literal("rescued"), v.literal("too_late"), v.literal("never_reached")),
      }),
    ),
  }),

  // A helper who agreed ahead of time to pick a household up. The pickup check calls them
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
    // Both sides confirm: once the helper says yes, the resident is called and asked whether they'll
    // go with them. Set when the resident says yes.
    residentConfirmedAt: v.optional(v.number()),
    confirmAttempts: v.optional(v.number()),
    // A status update still owed to one side, and how many times we've tried to give it.
    helperNotice: v.optional(helperNotice),
    helperNoticeAttempts: v.optional(v.number()),
    residentNotice: v.optional(residentNotice),
    residentNoticeAttempts: v.optional(v.number()),
    updatedAt: v.number(),
    simulated: v.boolean(),
  })
    .index("by_householdId", ["householdId"])
    .index("by_status", ["status"]),

  // A neighbor 911 calls next because of what another home's call heard (convex/neighborCalls.ts):
  // a home that can't get out needs someone nearby with a car ("driver"), or a neighbor driving out
  // could take someone nearby who needs a ride ("rider"). Removed when the call is placed.
  neighborCalls: defineTable({
    householdId: v.id("households"),
    forHouseholdId: v.id("households"),
    want: v.union(v.literal("driver"), v.literal("rider")),
    // Shown in the call queue: why this home is being called now.
    reason: v.string(),
    at: v.number(),
  })
    .index("by_householdId", ["householdId"])
    .index("by_forHouseholdId", ["forHouseholdId"])
    .index("by_at", ["at"]),

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
    // The Ready check campaign, before any warning. Bumping the generation stops a run.
    readyCheckStartedAt: v.optional(v.number()),
    readyCheckRunning: v.optional(v.boolean()),
    readyCheckGeneration: v.optional(v.number()),
    // The night's clock (lib/sim-clock.ts). Absent means it reads the wall clock.
    clock: v.optional(v.object({ speed: v.number(), realAt: v.number(), simAt: v.number(), ranMs: v.number() })),
    // Track A: set while a rewind or reset copies the night into `nightRuns`; nothing new starts until it's done.
    archivingRunId: v.optional(v.id("nightRuns")),
    // The incident closed (convex/incident.ts): real rider data is deleted after the retention window.
    incidentClosedAt: v.optional(v.number()),
    // The scheduled purge, so a reopen can cancel it.
    incidentPurgeId: v.optional(v.id("_scheduled_functions")),
    // When the purge finished deleting real rider data.
    incidentPurgedAt: v.optional(v.number()),
  }),

  // Track A: every night, kept when it is rewound or reset (convex/nightRuns.ts). A run starts at the
  // first Ready check or warning after the last rewind. Its `start` rows are the homes and arranged
  // pickups as they were then, and its `warning` rows the same just before the warning; a rewind puts
  // back either. Its `end` rows are everything the night left.
  // Times here are on the wall clock: they say when the run happened, not where the night's clock was.
  nightRuns: defineTable({
    startedAt: v.number(),
    endedAt: v.optional(v.number()),
    warningIssuedAt: v.optional(v.number()),
    hazard: v.optional(hazard),
    status: v.union(v.literal("current"), v.literal("archiving"), v.literal("archived")),
    endedBy: v.optional(v.union(v.literal("rewind"), v.literal("reset"))),
    // How many `end` rows the run kept.
    savedRows: v.optional(v.number()),
    // Where a rewind is putting homes back. A reset leaves this unset.
    rewindTo: v.optional(v.union(v.literal("start"), v.literal("warning"))),
    // The copy's place, so a step that died can run again from here instead of from the top.
    archiveStage: v.optional(v.union(v.literal("homes"), v.literal("tables"), v.literal("restore"))),
    archiveCursor: v.optional(v.string()),
    archiveSavedRows: v.optional(v.number()),
    archiveTouchedAt: v.optional(v.number()),
  }).index("by_status", ["status"]),

  // One saved document. `doc` is the row without its system fields, which are `docId` and `createdAt`.
  nightRunRows: defineTable({
    runId: v.id("nightRuns"),
    kind: v.union(v.literal("start"), v.literal("warning"), v.literal("end")),
    table: v.string(),
    docId: v.string(),
    createdAt: v.number(),
    doc: v.any(),
  }).index("by_runId_and_kind_and_table", ["runId", "kind", "table"]),

  // Mesh add-on (lib/mesh, convex/mesh.ts). Separate from the core flow, except that the dispatcher
  // reads `meshDriveTimes` for its drive times (convex/traffic.ts).
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
  // The same forecast cut down to what the dispatcher's drive times read (convex/traffic.ts) on
  // every re-plan: per window, the median slowdown of each direction of a street that slows.
  // `edgeKeys[i]` goes with `slowdowns[i]`.
  meshDriveTimes: defineTable({
    issuedAt: v.number(),
    warningIssuedAt: v.number(),
    baseAt: v.number(),
    windows: v.array(v.object({ from: v.number(), to: v.number(), edgeKeys: v.array(v.string()), slowdowns: v.array(v.number()) })),
  }).index("by_issuedAt", ["issuedAt"]),

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

  // Capital One Nessie add-on (convex/reimburse.ts). Mileage paid to a volunteer driver for a pickup
  // the resident confirmed. One row per ride, ever: `rideKey` is the resident's household and the
  // volunteer, so a rewound night that replays the same pickup is not paid again. Kept on rewind and
  // reset. `postedAt` is set before a transfer is sent, so a retry looks the transfer up in Nessie
  // before it sends another.
  reimbursements: defineTable({
    rideKey: v.string(),
    planId: v.id("pickupPlans"),
    householdId: v.id("households"),
    volunteerKey: v.string(),
    volunteerFirstName: v.string(),
    miles: v.number(),
    distanceSource: v.union(v.literal("road"), v.literal("straight_line")),
    ratePerMile: v.number(),
    amountCents: v.number(),
    status: reimbursementStatus,
    attempts: v.number(),
    claimedAt: v.optional(v.number()),
    postedAt: v.optional(v.number()),
    nessieTransferId: v.optional(v.string()),
    nessieStatus: v.optional(v.string()),
    error: v.optional(v.string()),
    createdAt: v.number(),
    paidAt: v.optional(v.number()),
  })
    .index("by_rideKey", ["rideKey"])
    .index("by_status", ["status"]),

  // The volunteer's Nessie sandbox ids, made the first time they're paid. Only the ids: no bank
  // numbers. `volunteerKey` is the digits of their phone.
  volunteerAccounts: defineTable({
    volunteerKey: v.string(),
    nessieCustomerId: v.optional(v.string()),
    nessieAccountId: v.optional(v.string()),
    updatedAt: v.number(),
  }).index("by_volunteerKey", ["volunteerKey"]),

  // The team's real phones for the demo (convex/demoNumbers.ts). Kept apart from households so a reset
  // that clears every home keeps them; `address` is the house a number was last put on. A paused
  // number is off its house but still remembers it.
  demoNumbers: defineTable({
    name: v.string(),
    phone: v.string(),
    address: v.optional(v.string()),
    paused: v.optional(v.boolean()),
  }).index("by_phone", ["phone"]),
});
