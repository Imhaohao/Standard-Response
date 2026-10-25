// Calls falling into a dispatch room as grains of sand on a grid: each grain falls straight down,
// slides off the grain below it to either side, and settles. Four drains at the bottom are the four
// dispatchers; each takes one grain at a time and needs a while to answer it, so the rest pile up.

export const PILE = { columns: 80, rows: 86, cell: 10 } as const;
export const DRAINS = [16, 32, 48, 64];

const ANSWER_TICKS = 50;
const START_RATE = 2;
const PEAK_RATE = 12;
const RAMP_TICKS = 300;
// Calls pour in mostly over the middle, so they heap into a mound over the seats, and stop before the
// room is full so the heap keeps its shape.
const SPREAD_COLUMNS = 14;
const FULL_SHARE = 0.55;

export class CallPile {
  readonly grid = new Uint8Array(PILE.columns * PILE.rows);
  waiting = 0;
  answered = 0;
  private tick = 0;
  private seed = 7;
  private readonly busyUntil = DRAINS.map(() => 0);

  private random() {
    this.seed = (this.seed * 16807) % 2147483647;
    return this.seed / 2147483647;
  }

  private gaussian() {
    return Math.sqrt(-2 * Math.log(1 - this.random())) * Math.cos(2 * Math.PI * this.random());
  }

  private at(column: number, row: number) {
    return this.grid[row * PILE.columns + column];
  }

  private move(from: number, to: number) {
    this.grid[from] = 0;
    this.grid[to] = 1;
  }

  private spawn() {
    if (this.waiting > FULL_SHARE * PILE.columns * PILE.rows) return;
    const rate = START_RATE + (PEAK_RATE - START_RATE) * Math.min(1, this.tick / RAMP_TICKS);
    for (let i = 0; i < rate; i++) {
      const column = Math.round(PILE.columns / 2 + this.gaussian() * SPREAD_COLUMNS);
      if (column < 0 || column >= PILE.columns) continue;
      if (this.at(column, 0)) continue;
      this.grid[column] = 1;
      this.waiting++;
    }
  }

  // A dispatcher free to answer takes the grain sitting in its drain.
  private answer() {
    const bottom = (PILE.rows - 1) * PILE.columns;
    for (const [d, column] of DRAINS.entries()) {
      if (this.tick < this.busyUntil[d] || !this.grid[bottom + column]) continue;
      this.grid[bottom + column] = 0;
      this.busyUntil[d] = this.tick + ANSWER_TICKS;
      this.waiting--;
      this.answered++;
    }
  }

  private settle(column: number, row: number) {
    const here = row * PILE.columns + column;
    const below = here + PILE.columns;
    if (!this.grid[below]) return this.move(here, below);
    const first = this.random() < 0.5 ? -1 : 1;
    for (const side of [first, -first]) {
      const c = column + side;
      if (c >= 0 && c < PILE.columns && !this.grid[below + side]) return this.move(here, below + side);
    }
  }

  step() {
    this.tick++;
    for (let row = PILE.rows - 2; row >= 0; row--) {
      for (let column = 0; column < PILE.columns; column++) if (this.at(column, row)) this.settle(column, row);
    }
    this.answer();
    this.spawn();
  }

  // Seats that answered within the last moment light up.
  isAnswering(drain: number) {
    return this.tick < this.busyUntil[drain] && this.busyUntil[drain] - this.tick > ANSWER_TICKS - 14;
  }
}
