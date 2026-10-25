import type { Compass } from "../../../convex/fireArrival";
import type { Language } from "../script";

// What the 911 screen lets the agent say about the fire and the way out (voice/agent/brief.ts).
// Figures come from the fire model and the road graph, so each line says where it comes from and
// that it is an estimate; none says that help is coming. English and Spanish are reviewed; the rest
// are machine translations awaiting review, like the other line files.

export type SituationLines = {
  compass: Record<Compass, string>;
  // The model has the fire at the home's street now.
  fireAtStreet: string;
  // miles: one decimal, already formatted ("1.4").
  fireNear: (miles: string, direction: string) => string;
  reachesIn: (minutes: number) => string;
  routeOut: (streets: string[], destination: string, minutes: number) => string;
};

const EN: SituationLines = {
  compass: { north: "north", northeast: "northeast", east: "east", southeast: "southeast", south: "south", southwest: "southwest", west: "west", northwest: "northwest" },
  fireAtStreet: "Our fire map shows the fire at your street now. If you can leave safely, leave now.",
  fireNear: (miles, direction) => `Our fire map shows the fire about ${miles} miles to your ${direction}.`,
  reachesIn: (minutes) => `It could reach your street in about ${minutes} minutes.`,
  routeOut: (streets, destination, minutes) =>
    `The fastest way out right now is ${streets.join(", then ")}, toward ${destination}. That's about ${minutes} minutes by car.`,
};

const ES: SituationLines = {
  compass: { north: "norte", northeast: "noreste", east: "este", southeast: "sureste", south: "sur", southwest: "suroeste", west: "oeste", northwest: "noroeste" },
  fireAtStreet: "Nuestro mapa muestra el fuego en su calle ahora. Si puede salir sin peligro, salga ya.",
  fireNear: (miles, direction) => `Nuestro mapa muestra el fuego a unas ${miles} millas al ${direction} de usted.`,
  reachesIn: (minutes) => `Podría llegar a su calle en unos ${minutes} minutos.`,
  routeOut: (streets, destination, minutes) =>
    `La salida más rápida ahora es por ${streets.join(", luego ")}, hacia ${destination}. Son unos ${minutes} minutos en carro.`,
};

const russianMinutes = (count: number) => {
  const lastTwoDigits = count % 100;
  const lastDigit = count % 10;
  if (lastTwoDigits >= 11 && lastTwoDigits <= 14) return "минут";
  if (lastDigit === 1) return "минуту";
  if (lastDigit >= 2 && lastDigit <= 4) return "минуты";
  return "минут";
};

const ZH: SituationLines = {
  compass: { north: "北", northeast: "东北", east: "东", southeast: "东南", south: "南", southwest: "西南", west: "西", northwest: "西北" },
  fireAtStreet: "我们的火情地图显示，火已经到您所在的街道了。如果您能安全离开，请现在就走。",
  fireNear: (miles, direction) => `我们的火情地图显示，火在您家${direction}方向，大约${miles}英里远。`,
  reachesIn: (minutes) => `大约${minutes}分钟后，火可能会到达您所在的街道。`,
  routeOut: (streets, destination, minutes) =>
    `现在最快的出路是走${streets.join("，然后")}，前往${destination}。开车大约${minutes}分钟。`,
};

const KO: SituationLines = {
  compass: { north: "북쪽", northeast: "북동쪽", east: "동쪽", southeast: "남동쪽", south: "남쪽", southwest: "남서쪽", west: "서쪽", northwest: "북서쪽" },
  fireAtStreet: "저희 화재 지도에는 지금 불이 고객님 거리에 와 있다고 나옵니다. 안전하게 나가실 수 있으면 지금 나가세요.",
  fireNear: (miles, direction) => `저희 화재 지도에는 불이 고객님 댁에서 ${direction}으로 약 ${miles}마일 떨어진 곳에 있다고 나옵니다.`,
  reachesIn: (minutes) => `약 ${minutes}분 뒤에 고객님 거리에 닿을 수 있습니다.`,
  routeOut: (streets, destination, minutes) =>
    `지금 가장 빠른 길은 ${streets.join(", 그다음 ")}를 지나 ${destination} 쪽으로 가는 길입니다. 차로 약 ${minutes}분 걸려요.`,
};

const VI: SituationLines = {
  compass: { north: "bắc", northeast: "đông bắc", east: "đông", southeast: "đông nam", south: "nam", southwest: "tây nam", west: "tây", northwest: "tây bắc" },
  fireAtStreet: "Bản đồ cháy của chúng tôi cho thấy đám cháy đang ở phố của quý vị. Nếu quý vị có thể rời đi an toàn, xin hãy đi ngay.",
  fireNear: (miles, direction) => `Bản đồ cháy của chúng tôi cho thấy đám cháy cách nhà quý vị khoảng ${miles} dặm về phía ${direction}.`,
  reachesIn: (minutes) => `Lửa có thể đến phố của quý vị trong khoảng ${minutes} phút.`,
  routeOut: (streets, destination, minutes) =>
    `Đường ra nhanh nhất lúc này là ${streets.join(", rồi ")}, về hướng ${destination}. Đi xe khoảng ${minutes} phút.`,
};

const TL: SituationLines = {
  compass: { north: "hilaga", northeast: "hilagang-silangan", east: "silangan", southeast: "timog-silangan", south: "timog", southwest: "timog-kanluran", west: "kanluran", northwest: "hilagang-kanluran" },
  fireAtStreet: "Ayon po sa fire map namin, nasa kalye na ninyo ang sunog ngayon. Kung ligtas po kayong makakaalis, umalis na po kayo ngayon.",
  fireNear: (miles, direction) => `Ayon po sa fire map namin, nasa mga ${miles} milya ang sunog sa ${direction} ninyo.`,
  reachesIn: (minutes) => `Maaari po itong umabot sa kalye ninyo sa loob ng mga ${minutes} minuto.`,
  routeOut: (streets, destination, minutes) =>
    `Ang pinakamabilis na daan palabas ngayon po ay ${streets.join(", tapos ")}, papunta sa ${destination}. Mga ${minutes} minuto po iyon kung sasakay ng kotse.`,
};

const RU: SituationLines = {
  compass: { north: "севере", northeast: "северо-востоке", east: "востоке", southeast: "юго-востоке", south: "юге", southwest: "юго-западе", west: "западе", northwest: "северо-западе" },
  fireAtStreet: "По нашей карте пожара, огонь сейчас на вашей улице. Если вы можете уехать безопасно, уезжайте сейчас.",
  fireNear: (miles, direction) => `По нашей карте пожара, огонь примерно в ${miles} мили от вас, на ${direction}.`,
  reachesIn: (minutes) => `Он может дойти до вашей улицы примерно через ${minutes} ${russianMinutes(minutes)}.`,
  routeOut: (streets, destination, minutes) =>
    `Самый быстрый выезд сейчас: ${streets.join(", затем ")}, в сторону ${destination}. На машине это примерно ${minutes} ${russianMinutes(minutes)}.`,
};

const JA: SituationLines = {
  compass: { north: "北", northeast: "北東", east: "東", southeast: "南東", south: "南", southwest: "南西", west: "西", northwest: "北西" },
  fireAtStreet: "こちらの火災マップでは、今、火はお住まいの通りまで来ています。安全に避難できるなら、今すぐ出てください。",
  fireNear: (miles, direction) => `こちらの火災マップでは、火はお住まいから${direction}の方向に、約${miles}マイルのところにあります。`,
  reachesIn: (minutes) => `約${minutes}分でお住まいの通りに届くおそれがあります。`,
  routeOut: (streets, destination, minutes) =>
    `今、いちばん早く出られる道は、${streets.join("、次に")}を通って${destination}の方へ向かう道です。車で約${minutes}分です。`,
};

const FR: SituationLines = {
  compass: { north: "nord", northeast: "nord-est", east: "est", southeast: "sud-est", south: "sud", southwest: "sud-ouest", west: "ouest", northwest: "nord-ouest" },
  fireAtStreet: "Notre carte des incendies montre le feu dans votre rue en ce moment. Si vous pouvez partir en sécurité, partez maintenant.",
  fireNear: (miles, direction) => `Notre carte des incendies montre le feu à environ ${miles} miles au ${direction} de chez vous.`,
  reachesIn: (minutes) => `Il pourrait atteindre votre rue dans environ ${minutes} minutes.`,
  routeOut: (streets, destination, minutes) =>
    `Le chemin le plus rapide pour sortir en ce moment passe par ${streets.join(", puis ")}, en direction de ${destination}. Cela fait environ ${minutes} minutes en voiture.`,
};

const HI: SituationLines = {
  compass: { north: "उत्तर", northeast: "उत्तर-पूर्व", east: "पूर्व", southeast: "दक्षिण-पूर्व", south: "दक्षिण", southwest: "दक्षिण-पश्चिम", west: "पश्चिम", northwest: "उत्तर-पश्चिम" },
  fireAtStreet: "हमारे फ़ायर मैप के मुताबिक़ आग अभी आपकी गली में है। अगर आप सुरक्षित निकल सकते हैं, तो अभी निकल जाइए।",
  fireNear: (miles, direction) => `हमारे फ़ायर मैप के मुताबिक़ आग आपके घर से ${direction} दिशा में लगभग ${miles} मील दूर है।`,
  reachesIn: (minutes) => `यह लगभग ${minutes} मिनट में आपकी गली तक पहुँच सकती है।`,
  routeOut: (streets, destination, minutes) =>
    `अभी बाहर निकलने का सबसे तेज़ रास्ता ${streets.join(", फिर ")} से होकर ${destination} की तरफ़ जाता है। गाड़ी से यह लगभग ${minutes} मिनट है।`,
};

export const SITUATION_LINES: Record<Language, SituationLines> = { en: EN, es: ES, zh: ZH, ko: KO, vi: VI, tl: TL, ru: RU, ja: JA, fr: FR, hi: HI };
