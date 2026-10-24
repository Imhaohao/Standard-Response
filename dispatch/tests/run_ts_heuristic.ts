// Reads problems (JSON array) on stdin, prints convex/heuristic.ts's solutions. Used by test_parity.py.
import { solveHeuristic } from "../../convex/heuristic";

let input = "";
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  const problems = JSON.parse(input);
  process.stdout.write(JSON.stringify(problems.map(solveHeuristic)));
});
