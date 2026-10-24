// Random numbers for the mesh and the crowd model. Simulations pass a seeded source so a run can
// be repeated; phones use the platform's cryptographic source for identifiers.

export type Random = () => number;

export function seededRandom(seed: number): Random {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Standard normal draw (Box-Muller). Two uniforms per draw keeps it stateless.
export function gaussian(random: Random) {
  const u = Math.max(random(), 1e-12);
  const v = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export type IdSource = () => string;

// A fresh random identifier. Nothing in it comes from the device, the person, the place or the time.
export function randomId(bytes = 8): string {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  return Array.from(buffer, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function seededIds(random: Random, bytes = 8): IdSource {
  return () =>
    Array.from({ length: bytes }, () =>
      Math.floor(random() * 256)
        .toString(16)
        .padStart(2, "0"),
    ).join("");
}
