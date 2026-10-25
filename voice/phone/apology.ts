import { Language, LINES } from "../agent/script";

// After the resident really talks over the agent (interrupts() stops its voice), the agent's next
// turn opens with a short "Sorry about that." It rides in the same Sonic request as the answer, so
// it adds only its own length, never a round trip. It is owed once per cut-off, never said on two
// agent turns in a row, dropped when the cut-off turned out to be noise, and never put in front of
// an emergency or safety line: a resident in danger hears the instruction first.

function carriesUrgentLine(sentences: string[], language: Language) {
  const lines = LINES[language];
  const urgent = [lines.emergency, lines.reassigning, ...Object.values(lines.safety)];
  return sentences.some((sentence) => urgent.some((line) => sentence.includes(line)));
}

export class CutOffApology {
  private owed = false;
  private saidLastTurn = false;

  // The resident stopped one of the agent's turns, not a filler, by really talking.
  cutOff() {
    this.owed = true;
  }

  // The talk that stopped the agent was noise, or the reply is a language hand-off.
  dismiss() {
    this.owed = false;
  }

  // Something else the agent says (a status cut-in, a question asked again): it owes nothing, and it
  // separates two apologies so they are no longer on consecutive turns.
  spokeOther() {
    this.saidLastTurn = false;
  }

  // The sentences of the agent's next turn, opened with the apology when one is owed.
  open(sentences: string[], language: Language, urgent: boolean): string[] {
    const apologize = this.owed && !this.saidLastTurn && !urgent && !carriesUrgentLine(sentences, language);
    this.owed = false;
    this.saidLastTurn = apologize;
    return apologize ? [LINES[language].apologyAfterCutOff, ...sentences] : sentences;
  }
}
