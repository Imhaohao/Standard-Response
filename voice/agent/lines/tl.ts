import type { Lines } from "./types";
// Machine translation from en.ts. Not yet reviewed by a fluent speaker.

export const TL: Lines = {
  greetOutbound: (address, name) =>
    `Hello po${name ? ` ${name}` : ""}, ito po ang paratransit evacuation line ng Altadena. May evacuation warning po sa kalye ninyo. Nasa ${address} po ba kayo ngayon?`,
  greetInbound: "Ito po ang evacuation line ng Altadena. Matutulungan ko po kayong makakuha ng sasakyan palabas.",
  greetCallback: (name) => `Hello po${name ? ` ${name}` : ""}, ito po ang evacuation line ng Altadena. May update po ako.`,
  askAddress: "Anong address po ninyo ngayon?",
  askHouseNumber: (street) => `Anong house number po sa ${street}?`,
  confirmAddress: (address) => `${address} po ang nakuha ko. Tama po ba?`,
  addressRetry: "Pasensya na po, hindi ko po narinig nang malinaw. Pakisabi po ulit ang street address ninyo ngayon.",
  addressEscalated: "Minarkahan ko po ang address ninyo para makumpirma ng dispatcher. Kung kaya po, tumawag din kayo sa 911.",
  askCanLeave: "Makakaalis po ba ang lahat sa bahay ninyo nang kusa ngayon?",
  askHasCar: "Mayroon po ba kayong kotse o kasamang puwedeng magmaneho para sa inyo?",
  askHousehold: "Ilan po kayong magkakasama ngayon, at mayroon po bang alagang hayop?",
  askNeeds: "May gumagamit po ba diyan ng walker o wheelchair, nangangailangan ng oxygen, o nakaratay sa kama?",
  askNeedsOnFile: (onFile) => `Ayon po sa records namin, ${onFile}. Tama pa po ba iyon, at may nangangailangan po ba ng oxygen?`,
  askAssistance: "Gaano po karaming tulong ang kailangan nila para makalabas: wala, isang taong aalalay, o dalawang tao para magbuhat?",
  readbackIntro: "Uulitin ko po ang nakuha ko.",
  readbackQuestion: "Tama po ba?",
  readbackFixed: "Salamat po, naituwid ko na.",
  whatToFix: "Ano po ang dapat kong baguhin?",
  askNeighbor: "Mayroon po bang iba sa kalye ninyo na hindi makakaalis? Kung mayroon, ano po ang address nila?",
  leaveNow: "Umalis na po kayo ngayon, at dalhin po ang mga gamot at charger ng telepono.",
  goodbye: "Salamat po. Manatili po kayo malapit sa telepono. Paalam po.",
  repeatPrompt: "Pasensya na po, puwede po bang ulitin ninyo?",
  emergency: "Kung kaya po, tumawag na kayo sa 911 ngayon. Minarkahan ko po kayong urgent para sa dispatcher.",
  languageBarrier:
    "Ipapasa ko po ang tawag ninyo sa isang tao sa aming team. Kung ligtas po kayong makakaalis, umalis na po kayo ngayon. Kung umabot ang apoy sa bahay ninyo, tumawag po kayo sa 911.",
  voicemail:
    "Ito po ang evacuation line ng Altadena. May evacuation warning po sa kalye ninyo. Tatawag po kaming muli sa loob ng dalawang minuto. Kung kailangan po ninyo ng sasakyan palabas, tawagan po ninyo ulit ang numerong ito.",
  people: (count) => (count === 1 ? "isang tao" : `${count} katao`),
  pets: "may alagang hayop",
  noCar: "walang kotse",
  leavingOnOwn: "aalis kayo nang kusa",
  byCar: "sakay ng kotse",
  mobility: {
    walks: "lahat ay nakakalakad",
    walker: "may gumagamit ng walker",
    manual_wheelchair: "may gumagamit ng wheelchair",
    power_wheelchair: "may gumagamit ng power wheelchair",
    bedbound: "may nakaratay sa kama",
  },
  assistance: {
    none: "hindi kailangan ng tulong sa paglabas",
    one_person_assist: "kailangan ng isang taong aalalay",
    two_person_lift: "kailangan ng dalawang tao para magbuhat",
  },
  oxygen: "gumagamit ng oxygen",
  atAddress: (address) => `sa ${address}`,
  listSeparator: ", ",
  textPrompt:
    "Evacuation line ng Altadena: may evacuation warning sa kalye ninyo. Sumagot ng 1 kung makakaalis kayo nang kusa, 2 kung kailangan ninyo ng sasakyan, 3 kung kailangan ninyo ng sasakyang accessible sa wheelchair. Maaari rin ninyong isulat kung sino ang kasama ninyo.",
  textThanks: "Salamat po. Natanggap na namin ang sagot ninyo.",
  backchannels: ["Opo.", "Nakuha ko po.", "Mm-hm, opo."],
  neutralAck: "Nakuha ko po.",
  waiting:
    "Nasa listahan po kayo ng sasagipin bilang mataas na prayoridad. Wala pa pong driver na tumatanggap. Tatawagan ko po kayo kapag may tumanggap na. Kung ligtas po kayong makakaalis, umalis na po kayo ngayon. Kung umabot ang apoy sa bahay ninyo, tumawag po kayo sa 911.",
  reassigning:
    "Hindi na po kayo maaabot ng driver ninyo. Nasa pinakaunang puwesto pa rin po kayo sa listahan. Tatawagan ko po kayo kapag may bagong driver na tumanggap. Kung ligtas po kayong makakaalis, umalis na po kayo ngayon. Kung umabot ang apoy sa bahay ninyo, tumawag po kayo sa 911.",
  vehicle: {
    stretcher_van: "van na may stretcher",
    wheelchair_van: "van na accessible sa wheelchair",
    paratransit: "paratransit van",
    bus: "bus",
    fire_unit: "sasakyan ng fire department",
    ambulance: "ambulansya",
  },
  crew: (size) => ` na may crew na ${size} katao`,
  minutes: (count) => (count === 1 ? "1 minuto" : `${count} minuto`),
  accepted: (vehicle, crew, eta, driverName) =>
    `Ang ${vehicle}${crew} ay ${eta} ang layo mula sa inyo. Ang pangalan po ng driver ay ${driverName}. Tatawag po akong muli kung may magbago.`,
  enRoute: (driverName, eta) =>
    `Papunta na po sa inyo si ${driverName}, mga ${eta} ang layo. Tatawag po akong muli kung may magbago.`,
  arrived: (shelterName) => `Nasa bahay na po ninyo ang driver ninyo.${shelterName ? ` Pupunta po kayo sa ${shelterName}.` : ""}`,
};
