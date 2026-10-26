// Calls reaching a dispatch room with four dispatchers. Each dispatcher has one line, drawn as a tube:
// a new call joins the shortest line, and each dispatcher answers one call at a time from the bottom.
// Calls arrive faster and faster, so the tubes fill and turn red, and then the calls nobody can take
// pile up between and over the tubes until they bury the room.

// The room reaches the top of the stage, so calls fall in from above the screen.
export const AREA = { width: 800, height: 910 } as const;
export const TUBE = { count: 4, width: 76, top: 410, bottom: 906 } as const;
export const CALL_RADIUS = 10;

const SLOT = 25;
const QUEUE_SLOTS = Math.floor((TUBE.bottom - TUBE.top) / SLOT);
const TUBE_SPACING = AREA.width / TUBE.count;
// The pile stacks in columns one slot apart, lined up so every tube's line is one of them.
const COLUMN_COUNT = AREA.width / SLOT - 1;
const ROOM_SLOTS = Math.floor((TUBE.bottom - 3 - 2 * CALL_RADIUS) / SLOT);
// A call rolls off a column whose neighbor sits this many slots lower, so the pile keeps a slope.
const ROLL_DROP = 2;

const ANSWER_SECONDS = 1.6;
const FLASH_SECONDS = 0.35;
const START_RATE = 1.5;
const PEAK_RATE = 30;
const RAMP_SECONDS = 6;
const GRAVITY = 2400;
const MAX_FALL = 1100;
const STEER = 6;
const REDDEN = 4;

export type Call = { x: number; y: number; vx: number; vy: number; alpha: number };

type Line = { center: number; waiting: Call[]; answering: Call | null; busyUntil: number; flashUntil: number; filled: boolean; red: number };
type Column = { x: number; base: number; calls: Call[]; line: Line | null };

export const tubeCenter = (tube: number) => TUBE_SPACING * (tube + 0.5);

// Where the call `index` places from the bottom of its line sits.
const slotY = (index: number) => TUBE.bottom - CALL_RADIUS - 3 - index * SLOT;

const size = (line: Line) => line.waiting.length + (line.answering ? 1 : 0);
const level = (column: Column) => (column.line ? size(column.line) : column.base + column.calls.length);

function tubeUnder(x: number) {
  const tube = Math.floor(x / TUBE_SPACING);
  return Math.abs(x - tubeCenter(tube)) < TUBE.width / 2 ? tube : null;
}

function makeColumn(x: number, lines: Line[]): Column {
  const tube = tubeUnder(x);
  if (tube === null) return { x, base: 0, calls: [], line: null };
  const line = lines[tube].center === x ? lines[tube] : null;
  return { x, base: QUEUE_SLOTS, calls: [], line };
}

export class CallTubes {
  readonly lines: Line[] = Array.from({ length: TUBE.count }, (_, tube) => ({
    center: tubeCenter(tube),
    waiting: [],
    answering: null,
    busyUntil: 0,
    flashUntil: 0,
    filled: false,
    red: 0,
  }));
  readonly columns: Column[] = Array.from({ length: COLUMN_COUNT }, (_, i) => makeColumn((i + 1) * SLOT, this.lines));
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
    if (size(line) < QUEUE_SLOTS) {
      line.waiting.push(call);
      return;
    }
    this.pile(call);
  }

  // Every tube is full: the call drops onto a random column and rolls down the pile's slope.
  private pile(call: Call) {
    const start = Math.floor(this.random() * COLUMN_COUNT);
    const landing = this.rollFrom(start);
    if (level(this.columns[landing]) >= ROOM_SLOTS) return;
    call.x = this.columns[start].x;
    const column = this.columns[landing];
    if (column.line) column.line.waiting.push(call);
    else column.calls.push(call);
  }

  private rollFrom(start: number) {
    let at = start;
    for (let next = this.lowerNeighbor(at); next !== null; next = this.lowerNeighbor(at)) at = next;
    return at;
  }

  private lowerNeighbor(at: number) {
    const here = level(this.columns[at]);
    const sides = [at - 1, at + 1].filter((i) => i >= 0 && i < COLUMN_COUNT && level(this.columns[i]) <= here - ROLL_DROP);
    if (sides.length < 2) return sides[0] ?? null;
    const [left, right] = sides.map((i) => level(this.columns[i]));
    if (left !== right) return left < right ? sides[0] : sides[1];
    return sides[this.random() < 0.5 ? 0 : 1];
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
    // Once a tube has filled it stays red: answering one call doesn't make the line manageable again.
    line.filled ||= size(line) >= QUEUE_SLOTS;
    line.red += ((line.filled ? 1 : 0) - line.red) * Math.min(1, dt * REDDEN);
  }

  private settlePile(dt: number) {
    for (const column of this.columns) {
      for (const [i, call] of column.calls.entries()) fallTo(call, column.x, slotY(column.base + i), dt);
    }
  }

  step(dt: number) {
    this.seconds += dt;
    this.spawn(dt);
    for (const line of this.lines) {
      this.answer(line);
      this.settleLine(line, dt);
    }
    this.settlePile(dt);
  }

  isAnswering(tube: number) {
    return this.seconds < this.lines[tube].flashUntil;
  }
}

// A call falls under gravity until it lands on its place, steering over its column as it drops.
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
