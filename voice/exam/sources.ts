// Where every exam item comes from. The rubric replicates the CritiCall dispatcher test as described
// in the first video; each call item adapts what a real caller said in a released 911 recording.
// `heard` is the caller's words as the video's captions give them (auto-captions, so lightly cleaned).

export type Source = { url: string; title: string; channel: string; heard?: string };

export const SOURCES = {
  criticall: {
    url: "https://www.youtube.com/watch?v=O8HKx8Rlug0",
    title: "911 Dispatcher Criticall Practice Test Prep",
    channel: "TSA Test Prep",
  },
  eatonRiviera: {
    url: "https://www.youtube.com/watch?v=O3p42m9FOyM",
    title: "Eaton Fire 911 calls show confusion, panic during start of blaze",
    channel: "ABC7",
    heard: "I need the fire department on Riviera Drive. There's houses on fire. ... 1470. 1470. Get him here now!",
  },
  eatonEvacuate: {
    url: "https://www.youtube.com/watch?v=4Q4MeZFmwaE",
    title: "Harrowing 911 calls released in California's Eaton Fire",
    channel: "CBS Evening News",
    heard: "We just walked outside. This looks like, we're panicking to evacuate.",
  },
  eatonRingCamera: {
    url: "https://www.youtube.com/watch?v=O3p42m9FOyM",
    title: "Eaton Fire 911 calls show confusion, panic during start of blaze",
    channel: "ABC7",
    heard: "I'm not at my house right now ... I've been looking at my Ring camera ... and I can see flames from the camera.",
  },
  eatonMitchell: {
    url: "https://www.youtube.com/watch?v=FUcBOt4UDBE",
    title: "Altadena man loses father and brother during Eaton Fire",
    channel: "CBS LA",
    heard: "Father in a wheelchair after an amputation, son bedridden with cerebral palsy, the caregiver son in the hospital. His last words were: help us.",
  },
  eatonMitchellYear: {
    url: "https://www.youtube.com/watch?v=KQA7fw-pOls",
    title: "Eaton Fire survivor wants answers after family member deaths during wildfire",
    channel: "CBS LA",
    heard: "His dad called for help to evacuate more than a dozen times and refused to leave his brother's side.",
  },
  campFlames: {
    url: "https://www.youtube.com/watch?v=4xanl4S5aRQ",
    title: "Paradise Police Release 9-1-1 Calls from Day of Camp Fire",
    channel: "Action News Now",
    heard: "We need to know where that fire is. ... It's not just smoke, I see flames, and the flames are burning a bush in my neighbor's yard.",
  },
  carrSurrounded: {
    url: "https://www.youtube.com/watch?v=1y5trlZGtbg",
    title: "Chilling 911 Calls From Carr Fire Show Desperate Plea For Help",
    channel: "CBS News Sacramento",
    heard: "If you can get out safely, get out. / I cannot. There is fire all around us. ... Do not risk anybody else's life for mine.",
  },
  carrNoWayOut: {
    url: "https://www.youtube.com/watch?v=1y5trlZGtbg",
    title: "Chilling 911 Calls From Carr Fire Show Desperate Plea For Help",
    channel: "CBS News Sacramento",
    heard: "They will not let me in to get them. They have no way out.",
  },
  lahainaMomsHouse: {
    url: "https://www.youtube.com/watch?v=WECuX4cqD3s",
    title: "911 calls from Lahaina wildfire show residents' terror and panic",
    channel: "Star-Advertiser",
    heard: "Please can you please send someone to my mom's house, I have 10 babies over there. / What is the address, ma'am? / Hello? Hello?",
  },
  lahainaTraffic: {
    url: "https://www.youtube.com/watch?v=Y3vnJTJKtMA",
    title: "Maui County officials release 911 calls from residents amid deadly Hawaii wildfires",
    channel: "CBS Mornings",
    heard: "We are caught in massive traffic and we're covered in ashes and embers. ... Very low on gas, any suggestions which direction I should go?",
  },
  lahainaInDanger: {
    url: "https://www.youtube.com/watch?v=TwtGEaCGFK8",
    title: "911 calls from deadly Lahaina wildfire reveal terror and panic in rush to escape",
    channel: "Leading Winds News (AP report)",
    heard: "Are we in danger? / No ma'am, no, we're trying our best.",
  },
  lahainaDoor: {
    url: "https://www.youtube.com/watch?v=TwtGEaCGFK8",
    title: "911 calls from deadly Lahaina wildfire reveal terror and panic in rush to escape",
    channel: "Leading Winds News (AP report)",
    heard: "I cannot get out of my door, there's flames blowing into the house.",
  },
  lahainaCarriedOut: {
    url: "https://www.youtube.com/watch?v=TwtGEaCGFK8",
    title: "911 calls from deadly Lahaina wildfire reveal terror and panic in rush to escape",
    channel: "Leading Winds News (AP report)",
    heard: "An 88-year-old man left behind in the house; the sliding doors were unlocked. He would literally have to be carried out. I just had to leave him because I had the rest of my family in the car.",
  },
  lahainaSeniorHome: {
    url: "https://www.youtube.com/watch?v=TwtGEaCGFK8",
    title: "911 calls from deadly Lahaina wildfire reveal terror and panic in rush to escape",
    channel: "Leading Winds News (AP report)",
    heard: "One of four people left at the senior residence: Are we supposed to evacuate?",
  },
  lahainaDog: {
    url: "https://www.youtube.com/watch?v=TwtGEaCGFK8",
    title: "911 calls from deadly Lahaina wildfire reveal terror and panic in rush to escape",
    channel: "Leading Winds News (AP report)",
    heard: "A family huddled in a fireplace, reluctant to leave without their frightened dog, as smoke alarms beeped incessantly.",
  },
  lahainaParents: {
    url: "https://www.youtube.com/watch?v=TwtGEaCGFK8",
    title: "911 calls from deadly Lahaina wildfire reveal terror and panic in rush to escape",
    channel: "Leading Winds News (AP report)",
    heard: "My dad was trying to fight the fire. The last words he said is I love you, we not going to make it.",
  },
  lahainaRoadsBlocked: {
    url: "https://www.youtube.com/watch?v=TwtGEaCGFK8",
    title: "911 calls from deadly Lahaina wildfire reveal terror and panic in rush to escape",
    channel: "Leading Winds News (AP report)",
    heard: "People calling because they were stuck in cars trapped by fallen trees and power lines.",
  },
  marshallFence: {
    url: "https://www.youtube.com/watch?v=IPH65G_fO34",
    title: "Marshall Fire 911 calls released",
    channel: "FOX31 Denver",
    heard: "The flames are right up against the fence behind the ... / OK, we've got help already on the way.",
  },
  austinNextDoor: {
    url: "https://www.youtube.com/watch?v=trD4xleDCew",
    title: "911 calls of Cedarcliffe Dr. fire released",
    channel: "KXAN",
    heard: "Very close to the house next to it. Let me go check anybody there.",
  },
  polkStayOnLine: {
    url: "https://www.youtube.com/watch?v=PB5jgT-iuu0",
    title: "Victim's family say elderly woman died in fire waiting for rescue",
    channel: "10 Tampa Bay News",
    heard: "They know I'm in here, right? / I'm just going to stay on the line until they get in there with you.",
  },
} as const satisfies Record<string, Source>;

export type SourceId = keyof typeof SOURCES;
