// `--city <id>` picks a city from lib/cities.ts for fetch.mjs and bake.mjs. Without the flag both
// scripts bake Altadena exactly as before, from the values in frame.mjs.
// Node strips the types from lib/cities.ts on import (Node 22.18 and later).

function cityArgument(argv) {
  const flag = argv.indexOf("--city");
  if (flag >= 0) return argv[flag + 1];
  return argv.find((arg) => arg.startsWith("--city="))?.slice("--city=".length) ?? null;
}

export async function cityFromArgs(argv = process.argv) {
  const id = cityArgument(argv);
  if (!id) return null;
  const { CITIES } = await import("../../lib/cities.ts");
  const city = CITIES.find((each) => each.id === id);
  if (!city) throw new Error(`No city "${id}" in lib/cities.ts. Known: ${CITIES.map((each) => each.id).join(", ")}`);
  return city;
}
