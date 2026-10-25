import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Mailbox } from "./voicemail";

const GREETING =
  "six five zero seven zero nine nine nine one one can't take your call now. At the tone, please record your message. When you've finished recording, simply hang up.";
const RETRY = "I couldn't hear you. Please try again. At the tone, please record your message.";
const DONE = "Sorry you're having trouble. Please try again later. Goodbye.";

describe("mailbox greeting", () => {
  it("leaves the warning at the beep, and once more if the mailbox heard nothing", () => {
    const mailbox = new Mailbox();
    assert.equal(mailbox.hear(GREETING), "speak");
    assert.equal(mailbox.hear("When you've finished recording, hang up."), "swallow");
    assert.equal(mailbox.hear(RETRY), "speak");
    assert.equal(mailbox.hear(RETRY), "swallow");
    assert.equal(mailbox.hear(DONE), "hangup");
    assert.equal(mailbox.hear(GREETING), "swallow");
  });

  it("treats a person as a person, including someone who didn't hear us", () => {
    const mailbox = new Mailbox();
    assert.equal(mailbox.hear("No, I can't leave on my own."), "person");
    assert.equal(mailbox.hear("I couldn't hear you, say that again."), "person");
    assert.equal(mailbox.hear("I'll try again later."), "person");
  });

  it("waits through the greeting until it says to record", () => {
    const mailbox = new Mailbox();
    assert.equal(mailbox.hear("The number you called can't take your call now."), "swallow");
    assert.equal(mailbox.hear("At the tone, please record your message."), "speak");
  });
});
