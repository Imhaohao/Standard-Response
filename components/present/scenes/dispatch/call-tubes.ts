// Calls reaching a dispatch room with four dispatchers. Each dispatcher has one line, drawn as a tube:
// a new call joins the shortest line, and each dispatcher answers one call at a time from the bottom.
// Calls arrive faster and faster, so the lines fill, back up out of the tubes, and calls start spilling off.

export const AREA = { width: 800, height: 860 } as const;
export const TUBE = { count: 4, width: 76, top: 360, bottom: 856 } as const;
export const CALL_RADIUS = 10;

const SLOT = 26;
const QUEUE_SLOTS = Math.floor((TUBE.bottom - TUBE.top) / SLOT);
// A line can back up out of its tube until it nearly reaches the top of the room.
const LINE_SLOTS = QUEUE_SLOTS + Math.floor(TUBE.top / SLOT) - 1;

const ANSWER_SECONDS = 1.6;
const FLASH_SECONDS = 0.35;
const START_RATE = 1.5;
const PEAK_RATE = 30;
const RAMP_SECONDS = 6;
const GRAVITY = 2400;
const MAX_FALL = 1100;
const STEER = 6;
const SPILL_SECONDS = 1.4;

export type Call = { x: number; y: number; vx: number; vy: number; alpha: number };

type Line = { center: number; waiting: Call[]; answering: Call | null; busyUntil: number; flashUntil: number };

export const tubeCenter = (tube: number) => (AREA.width * (tube + 0.5)) / TUBE.count;

// Where the call `index` places from the bottom of its line sits.
const slotY = (index: number) => TUBE.bottom - CALL_RADIUS - 3 - index * SLOT;

export class CallTubes {
  readonly lines: Line[] = Array.from({ length: TUBE.count }, (_, tube) => ({
    center: tubeCenter(tube),
    waiting: [],
    answering: null,
    busyUntil: 0,
    flashUntil: 0,
  }));
  readonly spilled: Call[] = [];
  seconds = 0;
  private owed = 0;
  private seed = 7;

  private random() {
    this.seed = (this.seed * 16807) % 2147483647;
    return this.seed / 2147483647;
  }

  private rate() {
    return START_RATE + (PEAK_RATE - START_RATE) * Math.min(1, this.seconds / RAMP_SECONDS);
  }

  private shortest() {
    return this.lines.reduce((best, line) => (size(line) < size(best) ? line : best));
  }

  private arrive() {
    const line = this.shortest();
    const call = { x: AREA.width / 2 + (this.random() - 0.5) * 520, y: -CALL_RADIUS - this.random() * 40, vx: 0, vy: 0, alpha: 1 };
    if (size(line) < LINE_SLOTS) {
      line.waiting.push(call);
      return;
    }
    // Every line is full to the top: the call bounces off the heap and is lost.
    this.spilled.push({ ...call, x: line.center + (this.random() - 0.5) * 60, vx: (this.random() < 0.5 ? -1 : 1) * (140 + this.random() * 160) });
  }

  private spawn(dt: number) {
    this.owed += this.rate() * dt;
    for (; this.owed >= 1; this.owed--) this.arrive();
  }

  // A free dispatcher takes the call that has reached the bottom of the line.
  private answer(line: Line) {
    if (line.answering && this.seconds >= line.busyUntil) line.answering = null;
    const next = line.waiting[0];
    if (line.answering || !next || next.y < slotY(0) - 0.5) return;
    line.answering = line.waiting.shift() ?? null;
    line.busyUntil = this.seconds + ANSWER_SECONDS;
    line.flashUntil = this.seconds + FLASH_SECONDS;
  }

  private settleLine(line: Line, dt: number) {
    const offset = line.answering ? 1 : 0;
    for (const [i, call] of line.waiting.entries()) fallTo(call, line.center, slotY(i + offset), dt);
    if (line.answering) line.answering.alpha = Math.max(0, (line.busyUntil - this.seconds) / ANSWER_SECONDS);
  }

  private spill(dt: number) {
    for (const call of this.spilled) {
      call.vy = Math.min(MAX_FALL, call.vy + GRAVITY * dt);
      call.x += call.vx * dt;
      call.y += call.vy * dt;
      call.alpha -= dt / SPILL_SECONDS;
    }
    const kept = this.spilled.filter((call) => call.alpha > 0 && call.y < AREA.height + CALL_RADIUS);
    this.spilled.splice(0, this.spilled.length, ...kept);
  }

  step(dt: number) {
    this.seconds += dt;
    this.spawn(dt);
    for (const line of this.lines) {
      this.answer(line);
      this.settleLine(line, dt);
    }
    this.spill(dt);
  }

  isAnswering(tube: number) {
    return this.seconds < this.lines[tube].flashUntil;
  }
}

const size = (line: Line) => line.waiting.length + (line.answering ? 1 : 0);

// A call falls under gravity until it lands on its place, steering over its tube as it drops.
function fallTo(call: Call, center: number, target: number, dt: number) {
  call.x += (center - call.x) * Math.min(1, dt * STEER);
  if (call.y >= target) {
    call.y = target;
    call.vy = 0;
    return;
  }
  call.vy = Math.min(MAX_FALL, call.vy + GRAVITY * dt);
  call.y = Math.min(target, call.y + call.vy * dt);
}
