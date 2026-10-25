import { EN } from "@/voice/agent/lines/en";
import { ES } from "@/voice/agent/lines/es";
import { JA } from "@/voice/agent/lines/ja";
import { KO } from "@/voice/agent/lines/ko";
import { RU } from "@/voice/agent/lines/ru";
import { TL } from "@/voice/agent/lines/tl";
import { VI } from "@/voice/agent/lines/vi";
import { ZH } from "@/voice/agent/lines/zh";

// The eight languages a whole call can run in (SPOKEN_LANGUAGES in convex/languages.ts), each with the
// agent's real "can everyone leave?" question in that language, as Sonic speaks it.
export const LANGUAGES = [
  { name: "English", question: EN.askCanLeave },
  { name: "Español", question: ES.askCanLeave },
  { name: "中文", question: ZH.askCanLeave },
  { name: "한국어", question: KO.askCanLeave },
  { name: "Tiếng Việt", question: VI.askCanLeave },
  { name: "Tagalog", question: TL.askCanLeave },
  { name: "Русский", question: RU.askCanLeave },
  { name: "日本語", question: JA.askCanLeave },
];
