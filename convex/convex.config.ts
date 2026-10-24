import { defineApp } from "convex/server";
import aggregate from "@convex-dev/aggregate/convex.config.js";
import workflow from "@convex-dev/workflow/convex.config.js";

const app = defineApp();
app.use(aggregate, { name: "householdsByOutcome" });
app.use(aggregate, { name: "householdsByCallStatus" });
app.use(workflow);

export default app;
