import { NEVER_BURNS } from "../ink-map/fire-field";
import { featuresOf, rawFeaturesOf, sigmoid } from "../mesh/federated";
import { gaussian, Random } from "../mesh/random";
import { Ground, fireMinutesAt, toXY } from "../crowd/grid";
import { nearbyBlockedShare, nearbySegments } from "../mesh/roads";

// Which streets are actually blocked in a simulated night: the ground truth the phones observe
// and the model is scored against. A segment blocks (downed lines, debris, abandoned cars, fire
// crews) with a probability that rises as the fire nears, more on minor roads, plus a spatially
// smooth term so blockages cluster. Each segment draws one uniform at the start and is blocked
// once its probability passes it, so a blocked street stays blocked. Simulation, not a forecast.

// Weights on [bias, fire within 30 min, fire arrived, minor road, lanes, hours since warning].
export const TRUE_WEIGHTS = [-5.2, 3.4, 2.2, 0.9, -0.5, 0.5];
const CLUSTER_SIGMA = 1.1;
const CLUSTER_METERS = 350;

export class BlockageWorld {
  readonly count: number;
  readonly fireMinutes: Float64Array;
  readonly kph: Float64Array;
  readonly lanes: Float64Array;
  readonly cluster: Float64Array;
  readonly threshold: Float64Array;
  readonly nearby: Int32Array[];
  readonly mid: [number, number][];

  constructor(ground: Ground, random: Random) {
    const segments = ground.segments;
    this.count = segments.length;
    this.mid = segments.map((s) => toXY(s.mid));
    this.fireMinutes = Float64Array.from(this.mid, ([x, y]) => fireMinutesAt(ground, x, y));
    this.kph = Float64Array.from(segments, (s) => s.kph);
    this.lanes = Float64Array.from(segments, (s) => s.lanes);
    this.threshold = Float64Array.from(segments, () => random());
    this.nearby = nearbySegments();
    this.cluster = this.smoothNoise(random);
  }

  // Gaussian-kernel average of white noise, rescaled to unit variance.
  private smoothNoise(random: Random) {
    const white = Float64Array.from({ length: this.count }, () => gaussian(random));
    const smooth = new Float64Array(this.count);
    for (let i = 0; i < this.count; i++) {
      let sum = white[i];
      let weight = 1;
      for (const j of this.nearby[i]) {
        const d = Math.hypot(this.mid[j][0] - this.mid[i][0], this.mid[j][1] - this.mid[i][1]);
        const w = Math.exp(-(d * d) / (2 * CLUSTER_METERS * CLUSTER_METERS));
        sum += w * white[j];
        weight += w;
      }
      smooth[i] = sum / weight;
    }
    const sd = Math.sqrt(smooth.reduce((s, v) => s + v * v, 0) / this.count) || 1;
    return smooth.map((v) => (v / sd) * CLUSTER_SIGMA);
  }

  minutesToFire(segment: number, minutes: number) {
    const arrival = this.fireMinutes[segment];
    return arrival >= NEVER_BURNS ? NEVER_BURNS : arrival - minutes;
  }

  private featureInput(segment: number, minutes: number, nearbyBlockedShare: number) {
    return {
      minutesToFire: this.minutesToFire(segment, minutes),
      kph: this.kph[segment],
      lanes: this.lanes[segment],
      minutesSinceWarning: minutes,
      nearbyBlockedShare,
    };
  }

  // Features as a phone computes them, given the share of nearby streets it believes blocked.
  features(segment: number, minutes: number, nearbyBlockedShare: number) {
    return featuresOf(this.featureInput(segment, minutes, nearbyBlockedShare));
  }

  // The truth is defined on the raw features, independent of how the model scales them.
  probability(segment: number, minutes: number) {
    const x = rawFeaturesOf(this.featureInput(segment, minutes, 0)).slice(0, TRUE_WEIGHTS.length);
    let z = this.cluster[segment];
    for (let i = 0; i < TRUE_WEIGHTS.length; i++) z += TRUE_WEIGHTS[i] * x[i];
    return sigmoid(z);
  }

  isBlocked(segment: number, minutes: number) {
    return this.threshold[segment] < this.probability(segment, minutes);
  }

  blockedAt(minutes: number) {
    const blocked = new Set<number>();
    for (let i = 0; i < this.count; i++) if (this.isBlocked(i, minutes)) blocked.add(i);
    return blocked;
  }

  // When each segment first blocks, by bisection on the monotone probability; Infinity if never.
  blockedSince(segment: number, horizon: number) {
    if (!this.isBlocked(segment, horizon)) return Infinity;
    let low = 0;
    let high = horizon;
    if (this.isBlocked(segment, 0)) return 0;
    for (let k = 0; k < 20; k++) {
      const middle = (low + high) / 2;
      if (this.isBlocked(segment, middle)) high = middle;
      else low = middle;
    }
    return high;
  }

  nearbyShare(segment: number, believedBlocked: (segment: number) => boolean) {
    return nearbyBlockedShare(segment, believedBlocked);
  }
}
