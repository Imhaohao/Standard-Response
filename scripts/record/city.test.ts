import assert from "node:assert/strict";
import { test } from "node:test";
import { minuteSchedule } from "./city";

test("each segment gets its own pace and the clip ends on the last minute", () => {
  const minutes = minuteSchedule(
    [
      { from: 255, to: 267, seconds: 1 },
      { from: 267, to: 274, seconds: 2 },
    ],
    4,
  );
  assert.equal(minutes.length, 4 + 8 + 1);
  assert.deepEqual(minutes.slice(0, 5), [255, 258, 261, 264, 267]);
  assert.equal(minutes[5], 267 + 7 / 8);
  assert.equal(minutes[minutes.length - 1], 274);
});
