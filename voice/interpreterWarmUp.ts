import { warmCache } from "./agent/interpreter";
import { warmPlanInterpreter } from "./agent/planInterpreter";
import { warmReadyInterpreter } from "./agent/readyInterpreter";
import { currentHazard } from "./hazard";
import type { CallMode } from "./phone/callParameters";

// Each call warms the interpreter it reads turns with while it rings and greets, and the server
// warms them all on boot (voice/agent/warmUp.ts says why). Warming twice inside a few minutes sends
// nothing, so placing a call and then answering it costs one request.
export function warmInterpreterFor(mode: CallMode): Promise<void> {
  if (mode === "ready") return warmReadyInterpreter();
  if (mode === "plan_check") return warmPlanInterpreter(currentHazard());
  return warmCache(currentHazard());
}

export const warmEveryInterpreter = () => Promise.all([warmCache(), warmPlanInterpreter(), warmReadyInterpreter()]).then(() => undefined);
