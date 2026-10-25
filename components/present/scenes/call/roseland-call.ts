// The test call with Roseland, as it played. Fill `transcript` from the recording, timing each line by
// when it starts in the audio, and drop the recording at public/present/roseland-call.mp3. Until the
// transcript has lines, the phone shows a marked slot naming this file.
export type CallTurn = { speaker: "agent" | "resident"; text: string; atSeconds: number };
export type RecordField = { label: string; value: string; atSeconds: number };

export const ROSELAND_CALL = {
  name: "Roseland",
  audio: "/present/roseland-call.mp3",
  file: "components/present/scenes/call/roseland-call.ts",
  transcript: [] as CallTurn[],
  record: [
    { label: "People at home", value: "", atSeconds: 0 },
    { label: "Wheelchair", value: "", atSeconds: 0 },
    { label: "Language", value: "", atSeconds: 0 },
  ] as RecordField[],
};
