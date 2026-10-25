import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.daily("incident rider data safety sweep", { hourUTC: 11, minuteUTC: 0 }, internal.incident.sweep, {});

export default crons;
