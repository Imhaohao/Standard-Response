// A mailbox greeting is not a person. AT&T often answers a new number itself, within a couple of
// seconds, and then records only what it hears after the beep. Talking over the greeting leaves
// silence, and the mailbox hangs up with "I couldn't hear you."

// How long to stay after the warning, so a mailbox that didn't record it can ask once more.
export const MAILBOX_QUIET_MS = 6000;

const GOODBYE = /try again later/;
const TROUBLE = /having trouble|couldn.?t hear|could not hear|didn.?t hear|did not hear/;
const UNHEARD = /couldn.?t hear you|could not hear you|didn.?t hear you|did not hear you/;
const CUE = /at the tone|after the (?:tone|beep)|record your message|finished recording/;
const BOX = /can.?t take your call|cannot take your call|voice ?mail/;

export type MailboxKind = "goodbye" | "unheard" | "cue" | "box";
export type MailboxAction = "person" | "swallow" | "speak" | "hangup";

// What this transcript is. A person who says "I couldn't hear you" has no recording cue in the
// same breath; the mailbox's retry does.
export function mailboxKind(text: string): MailboxKind | null {
  const heard = text.toLowerCase();
  if (GOODBYE.test(heard) && TROUBLE.test(heard)) return "goodbye";
  // The mailbox says it heard nothing and then plays the beep cue again. A person who
  // didn't hear us never mentions the beep.
  if (UNHEARD.test(heard) && CUE.test(heard)) return "unheard";
  if (CUE.test(heard)) return "cue";
  if (BOX.test(heard)) return "box";
  return null;
}

// One outbound call's mailbox. `attempt` ticks each time the warning should be spoken.
export class Mailbox {
  private phase: "live" | "box" | "spoken" | "done" = "live";
  attempt = 0;

  hear(text: string): MailboxAction {
    const kind = mailboxKind(text);
    if (this.phase === "done") return "swallow";
    if (this.phase === "live" && !opensMailbox(kind)) return "person";
    if (kind === "goodbye") return this.done();
    if (this.phase === "live") this.phase = "box";
    if (this.shouldSpeak(kind)) return this.speak();
    return "swallow";
  }

  private done(): MailboxAction {
    this.phase = "done";
    return "hangup";
  }

  private shouldSpeak(kind: MailboxKind | null) {
    if (kind !== "cue" && kind !== "unheard") return false;
    if (kind === "cue" && this.phase === "spoken") return false;
    return this.attempt < 2;
  }

  private speak(): MailboxAction {
    this.phase = "spoken";
    this.attempt += 1;
    return "speak";
  }
}

function opensMailbox(kind: MailboxKind | null) {
  return kind === "cue" || kind === "box" || kind === "unheard";
}
