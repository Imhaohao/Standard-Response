import type { Lines } from "./types";
// Machine translation from en.ts. Not yet reviewed by a fluent speaker.

export const JA: Lines = {
  greetOutbound: (address, name) =>
    `もしもし${name ? `、${name}様` : ""}。こちらはAltadenaのパラトランジット避難専用ダイヤルです。お住まいの通りに避難警報が出ています。今、${address}にいらっしゃいますか。`,
  greetInbound: "こちらはAltadenaの避難専用ダイヤルです。避難のための車の手配をお手伝いします。",
  greetCallback: (name) => `もしもし${name ? `、${name}様` : ""}。こちらはAltadenaの避難専用ダイヤルです。お知らせがあります。`,
  askAddress: "今、どちらの住所にいらっしゃいますか。",
  askHouseNumber: (street) => `${street}の家の番号は何番ですか。`,
  confirmAddress: (address) => `住所は${address}ですね。合っていますか。`,
  addressRetry: "申し訳ありません、聞き取れませんでした。今いらっしゃる場所の住所を、もう一度お願いします。",
  addressEscalated: "ご住所に印をつけました。担当者が確認します。可能でしたら、911にも電話してください。",
  askCanLeave: "ご自宅の皆さんは、今、ご自分で避難できますか。",
  askHasCar: "お車か、運転してくれる方はいますか。",
  askHousehold: "今、何人でいらっしゃいますか。ペットはいますか。",
  askNeeds: "歩行器や車椅子を使う方、酸素が必要な方、寝たきりの方はいますか。",
  askNeedsOnFile: (onFile) => `記録では、${onFile}となっています。今も同じですか。酸素が必要な方はいますか。`,
  askAssistance: "外に出るのに、どれくらい手助けが必要ですか。必要なし、1人の手助け、2人で持ち上げる、のどれですか。",
  readbackIntro: "確認のため、繰り返します。",
  readbackQuestion: "合っていますか。",
  readbackFixed: "ありがとうございます。修正しました。",
  whatToFix: "どこを直しますか。",
  askNeighbor: "同じ通りに、避難できないかもしれない方はほかにいますか。いる場合は、その方の住所を教えてください。",
  leaveNow: "今すぐ避難してください。お薬と携帯電話の充電器を持っていってください。",
  goodbye: "ありがとうございました。電話のそばにいてください。失礼します。",
  repeatPrompt: "すみません、もう一度お願いします。",
  emergency: "可能でしたら、今すぐ911に電話してください。担当者には緊急として伝えてあります。",
  languageBarrier:
    "お電話を、チームの担当者につなぎます。安全に避難できる場合は、今すぐ避難してください。",
  voicemail:
    "こちらはAltadenaの避難専用ダイヤルです。お住まいの通りに避難警報が出ています。2分後にまたお電話します。避難のための車が必要な場合は、この番号にお電話ください。",
  people: (count) => `${count}人`,
  pets: "ペットと一緒",
  noCar: "車なし",
  leavingOnOwn: "ご自分で避難する",
  byCar: "車で",
  mobility: {
    walks: "皆さん歩けます",
    walker: "歩行器を使う方がいます",
    manual_wheelchair: "車椅子を使う方がいます",
    power_wheelchair: "電動車椅子を使う方がいます",
    bedbound: "寝たきりの方がいます",
  },
  assistance: {
    none: "外に出る手助けは不要",
    one_person_assist: "1人の手助けが必要",
    two_person_lift: "2人で持ち上げる必要あり",
  },
  oxygen: "酸素を使用",
  atAddress: (address) => `${address}にいる`,
  sentenceGap: "",
  listSeparator: "、",
  sentenceEnd: "。",
  textPrompt:
    "Altadena避難専用ダイヤルです。お住まいの通りに避難警報が出ています。ご自分で避難できる場合は1、車が必要な場合は2、車椅子のまま乗れる車が必要な場合は3を返信してください。ご一緒の方を書いていただくこともできます。",
  textThanks: "ありがとうございます。ご回答を受け取りました。",
  backchannels: ["はい。", "ええと。", "少々お待ちください。"],
  neutralAck: "わかりました。",
  waiting:
    "救助リストに、優先度の高い方として載っています。まだ引き受けた運転手はいません。引き受ける運転手が決まったら、すぐにお電話します。安全に避難できる場合は、今すぐ避難してください。",
  reassigning:
    "担当の運転手が、そちらに行けなくなりました。リストの先頭であることは変わりません。新しい運転手が引き受けたら、すぐにお電話します。安全に避難できる場合は、今すぐ避難してください。",
  safety: {
    wildfire: "火が家に届いたら、911に電話してください。",
    earthquake: "閉じ込められた人がいる場合や、ガスのにおいがする場合は、911に電話してください。",
    flood: "家に水が入ってきたら、いちばん高い階に上がって、911に電話してください。",
    hurricane: "水が入ってきたり、家が壊れたりしたら、911に電話してください。",
  },
  vehicle: {
    stretcher_van: "ストレッチャーを運べるバン",
    wheelchair_van: "車椅子対応のバン",
    paratransit: "パラトランジットのバン",
    bus: "バス",
    fire_unit: "消防の車両",
    ambulance: "救急車",
  },
  crew: (size) => `の乗員は${size}人です`,
  minutes: (count) => `${count}分`,
  accepted: (vehicle, crew, eta, driverName) => {
    const crewSentence = crew ? `${vehicle}${crew}。` : "";
    const distanceSubject = crew ? "その車両" : vehicle;
    return `${crewSentence}${distanceSubject}は、そちらから${eta}の距離にいます。運転手のお名前は${driverName}さんです。状況が変わったら、またお電話します。`;
  },
  enRoute: (driverName, eta) => `${driverName}さんが、今そちらに向かっています。約${eta}の距離です。状況が変わったら、またお電話します。`,
  arrived: (shelterName) => `運転手がご自宅に着きました。${shelterName ? `行き先は${shelterName}です。` : ""}`,
};
