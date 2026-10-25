import path from "node:path";
import { startStack } from "./stack";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
startStack(root, { build: process.argv.includes("--build") }).then((stack) => console.log(JSON.stringify(stack)));
