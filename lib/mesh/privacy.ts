import { gaussian, Random } from "./random";

// Local differential privacy for model updates. Each phone clips its update to a fixed L2 norm and
// adds Gaussian noise before the update leaves the phone, so every copy that travels the mesh,
// even one that reaches a single neighbour unmixed, is already a private release.

export function l2Norm(vector: readonly number[]) {
  let sum = 0;
  for (const value of vector) sum += value * value;
  return Math.sqrt(sum);
}

export function clipToNorm(vector: readonly number[], maxNorm: number) {
  const norm = l2Norm(vector);
  const scale = norm > maxNorm ? maxNorm / norm : 1;
  return vector.map((value) => value * scale);
}

// Clip to `clip`, then add N(0, (noiseMultiplier * clip)^2) to every coordinate.
export function privatize(vector: readonly number[], clip: number, noiseMultiplier: number, random: Random) {
  return clipToNorm(vector, clip).map((value) => value + gaussian(random) * noiseMultiplier * clip);
}

// Standard normal CDF via the complementary error function (Numerical Recipes erfcc, |error| < 1.2e-7).
function erfc(x: number) {
  const z = Math.abs(x);
  const t = 1 / (1 + 0.5 * z);
  const poly =
    -z * z -
    1.26551223 +
    t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277))))))));
  const value = t * Math.exp(poly);
  return x >= 0 ? value : 2 - value;
}

export const normalCdf = (x: number) => 0.5 * erfc(-x / Math.SQRT2);

// Exact delta of a Gaussian mechanism whose sensitivity-to-noise ratio is mu (Balle and Wang, 2018).
export function gaussianDelta(mu: number, epsilon: number) {
  return normalCdf(mu / 2 - epsilon / mu) - Math.exp(epsilon) * normalCdf(-mu / 2 - epsilon / mu);
}

// Smallest epsilon with gaussianDelta(mu, epsilon) <= delta, by bisection.
export function gaussianEpsilon(mu: number, delta: number) {
  if (gaussianDelta(mu, 0) <= delta) return 0;
  let low = 0;
  let high = 1;
  while (gaussianDelta(mu, high) > delta && high < 1e3) high *= 2;
  for (let i = 0; i < 80; i++) {
    const middle = (low + high) / 2;
    if (gaussianDelta(mu, middle) > delta) low = middle;
    else high = middle;
  }
  return high;
}

// What one phone has given away after contributing to `rounds` model versions. Gaussian mechanisms
// compose exactly in Gaussian differential privacy: mu adds in quadrature (Dong, Roth and Su, 2019).
// Neighbouring datasets differ by one phone's whole contribution, whose norm is at most `clip`.
export function privacySpent(noiseMultiplier: number, rounds: number, delta = 1e-5) {
  if (rounds <= 0) return { epsilon: 0, delta, mu: 0 };
  const mu = Math.sqrt(rounds) / noiseMultiplier;
  return { epsilon: gaussianEpsilon(mu, delta), delta, mu };
}
