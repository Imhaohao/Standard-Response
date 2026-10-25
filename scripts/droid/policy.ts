import { resolve, sep } from "node:path";

// What a triage Droid may do. The SDK gets exactly this: autonomy "off" (every edit or command
// asks), a tool list with the network tools removed, and a permission handler that answers each
// ask with decidePermission below. Nothing here is advice to the model; the SDK enforces it.

export const TEST_COMMAND = "npx tsx --test voice/agent/*.test.ts";
const TEST_COMMAND_PATTERN = /^npx tsx --test voice\/agent\/(\*|[\w-]+)\.test\.ts$/;

export type DroidPermissions = {
  cwd: string;
  autonomy: "off";
  disabledToolIds: string[];
  readRoots: string[];
  writeRoot: string;
  allowedCommands: string[];
  network: "factory-only";
};

export const NETWORK_TOOL_IDS = ["WebSearch", "FetchUrl"];

export function restrictedPermissions(workspace: string, repoRoot: string): DroidPermissions {
  return {
    cwd: workspace,
    autonomy: "off",
    disabledToolIds: NETWORK_TOOL_IDS,
    readRoots: [resolve(repoRoot, "voice"), resolve(repoRoot, "data")],
    writeRoot: workspace,
    allowedCommands: [TEST_COMMAND],
    network: "factory-only",
  };
}

export type RequestedAction =
  | { kind: "edit" | "create"; filePath: string }
  | { kind: "exec"; command: string }
  | { kind: "other" };

const isInside = (root: string, path: string) => {
  const target = resolve(root, path);
  return target === root || target.startsWith(root + sep);
};

const throughNodeModules = (path: string) => path.split(sep).includes("node_modules");

const mayWrite = (permissions: DroidPermissions, filePath: string) =>
  isInside(permissions.writeRoot, filePath) && !throughNodeModules(resolve(permissions.writeRoot, filePath));

const mayRun = (command: string) => TEST_COMMAND_PATTERN.test(command.trim());

export function decidePermission(permissions: DroidPermissions, action: RequestedAction): "allow" | "deny" {
  if (action.kind === "edit" || action.kind === "create") return mayWrite(permissions, action.filePath) ? "allow" : "deny";
  if (action.kind === "exec") return mayRun(action.command) ? "allow" : "deny";
  return "deny";
}

export const decideAll = (permissions: DroidPermissions, actions: RequestedAction[]) =>
  actions.length > 0 && actions.every((action) => decidePermission(permissions, action) === "allow") ? "allow" : "deny";
