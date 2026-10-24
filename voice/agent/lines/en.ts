import type { Lines } from "./types";

export const EN: Lines = {
  greetOutbound: (address, name) =>
    `Hello${name ? ` ${name}` : ""}, this is the Altadena paratransit evacuation line. An evacuation warning covers your street. Are you at ${address} right now?`,
  greetInbound: "This is the Altadena evacuation line. I can help get you a ride out.",
  greetCallback: (name) => `Hello${name ? ` ${name}` : ""}, this is the Altadena evacuation line with an update.`,
  askAddress: "What address are you at right now?",
  askHouseNumber: (street) => `What's the house number on ${street}?`,
  confirmAddress: (address) => `I have ${address}. Is that right?`,
  addressRetry: "Sorry, I didn't catch that. Can you tell me the street address where you are now?",
  addressEscalated: "I've flagged your address for a dispatcher to confirm. If you can, also call 911.",
  askCanLeave: "Can everyone in your home leave on their own right now?",
  askHasCar: "Do you have a car or someone who can drive you out?",
  askHousehold: "How many people are with you right now, and are there any pets?",
  askNeeds: "Does anyone there use a walker or a wheelchair, need oxygen, or stay in bed?",
  askNeedsOnFile: (onFile) => `Our records say ${onFile}. Is that still right, and does anyone need oxygen?`,
  askAssistance: "How much help do they need getting out: none, one person helping, or two people to lift?",
  readbackIntro: "Let me read that back.",
  readbackQuestion: "Is that right?",
  readbackFixed: "Thanks, I've fixed that.",
  whatToFix: "What should I change?",
  askNeighbor: "Is there anyone else on your street who might not be able to leave? If so, what's their address?",
  leaveNow: "Please leave now, and take your medications and phone charger.",
  goodbye: "Thank you. Stay by the phone. Goodbye.",
  transferOut: "Okay, let me transfer you. Give me two seconds.",
  transferIn: "Hi, I'll help you in English from here.",
  repeatPrompt: "Sorry, could you say that again?",
  emergency: "If you can, call 911 right now. I've marked you urgent for the dispatcher.",
  languageBarrier:
    "I'm passing your call to a person on our team. If you can leave safely, leave now.",
  voicemail:
    "This is the Altadena evacuation line. An evacuation warning covers your street. We'll call back in two minutes. If you need a ride out, call this number back.",
  people: (count) => (count === 1 ? "one person" : `${count} people`),
  pets: "with pets",
  noCar: "no car",
  leavingOnOwn: "you're leaving on your own",
  byCar: "by car",
  mobility: {
    walks: "everyone can walk",
    walker: "someone uses a walker",
    manual_wheelchair: "someone uses a wheelchair",
    power_wheelchair: "someone uses a power wheelchair",
    bedbound: "someone is bedbound",
  },
  assistance: {
    none: "no help needed getting out",
    one_person_assist: "needs one person to help",
    two_person_lift: "needs two people to lift",
  },
  oxygen: "on oxygen",
  atAddress: (address) => `at ${address}`,
  listSeparator: ", ",
  textPrompt:
    "Altadena evacuation line: an evacuation warning covers your street. Reply 1 if you can leave on your own, 2 if you need a ride, 3 if you need a wheelchair-accessible vehicle. You can also write who is with you.",
  textThanks: "Thank you. We have your answer.",
  backchannels: ["Mm-hm.", "Okay.", "Hmm, okay.", "Alright.", "One moment."],
  neutralAck: "Okay.",
  waiting:
    "You're on the rescue list as high priority. No driver has accepted yet. I'll call you back the moment one does. If you can leave safely, leave now.",
  reassigning:
    "Your driver can no longer reach you. You're still at the top of the list. I'll call the moment a new driver accepts. If you can leave safely, leave now.",
  safety: {
    wildfire: "If fire reaches your home, call 911.",
    earthquake: "If anyone is trapped or you smell gas, call 911.",
    flood: "If water comes into your home, go to the highest floor and call 911.",
    hurricane: "If water comes in or your home is damaged, call 911.",
  },
  vehicle: {
    stretcher_van: "van that carries a stretcher",
    wheelchair_van: "wheelchair-accessible van",
    paratransit: "paratransit van",
    bus: "bus",
    fire_unit: "fire department vehicle",
    ambulance: "ambulance",
  },
  crew: (size) => (size === 2 ? " with a two-person crew" : ` with a ${size}-person crew`),
  minutes: (count) => (count === 1 ? "1 minute" : `${count} minutes`),
  accepted: (vehicle, crew, eta, driverName) => {
    const article = /^[aeiou]/i.test(vehicle) ? "An" : "A";
    return `${article} ${vehicle}${crew} is ${eta} away. The driver's name is ${driverName}. I'll call again if anything changes.`;
  },
  enRoute: (driverName, eta) => `${driverName} is driving to you now, about ${eta} away. I'll call again if anything changes.`,
  arrived: (shelterName) => `Your driver is at your home now.${shelterName ? ` You're going to ${shelterName}.` : ""}`,
};
