import { decideAll, DroidPermissions, RequestedAction } from "./policy";
import { DroidClient, DroidSessionRequest, DroidSessionResult } from "./triageCore";

// The one file that touches @factory/droid-sdk (https://docs.factory.com/sdk/typescript). It is
// imported by name at runtime so everything else typechecks and tests without the package or a key.

type ToolUse = { details: { type: string; filePath?: string; command?: string } };
type PermissionAsk = { toolUses: ToolUse[]; options: { value: string }[] };
type StreamMessage = { type: string; text?: string; success?: boolean; error?: { message?: string }; subtype?: string };
type Session = { id: string; stream(prompt: string): AsyncIterable<StreamMessage>; close(): Promise<void> };
type DroidSdk = { createSession(options: Record<string, unknown>): Promise<Session> };

const SDK_MODULE = "@factory/droid-sdk/node";

const loadSdk = async (): Promise<DroidSdk> => {
  try {
    return (await import(SDK_MODULE)) as DroidSdk;
  } catch {
    throw new Error("Cannot load @factory/droid-sdk. Run `npm install`, and install the Droid CLI: https://docs.factory.ai/cli");
  }
};

const actionOf = ({ details }: ToolUse): RequestedAction => {
  if ((details.type === "edit" || details.type === "create") && details.filePath) return { kind: details.type, filePath: details.filePath };
  if (details.type === "exec" && details.command) return { kind: "exec", command: details.command };
  return { kind: "other" };
};

const offered = (ask: PermissionAsk, outcome: string) => ask.options.some((option) => option.value === outcome);

export const permissionHandlerFor = (permissions: DroidPermissions) => (ask: PermissionAsk) => {
  const allowed = decideAll(permissions, ask.toolUses.map(actionOf)) === "allow" && offered(ask, "proceed_once");
  return allowed ? "proceed_once" : "cancel";
};

export const sessionOptionsFor = (permissions: DroidPermissions) => ({
  cwd: permissions.cwd,
  autonomyLevel: permissions.autonomy,
  disabledToolIds: permissions.disabledToolIds,
  permissionHandler: permissionHandlerFor(permissions),
});

async function collectText(session: Session, prompt: string): Promise<string> {
  let text = "";
  for await (const message of session.stream(prompt)) {
    if (message.type === "assistant") text += message.text ?? "";
    if (message.type === "result" && message.success === false) throw new Error(message.error?.message ?? `Droid turn ended: ${message.subtype}`);
  }
  return text;
}

export class FactoryDroidClient implements DroidClient {
  async runSession(request: DroidSessionRequest): Promise<DroidSessionResult> {
    const sdk = await loadSdk();
    const session = await sdk.createSession(sessionOptionsFor(request.permissions));
    try {
      return { sessionId: session.id, finalText: await collectText(session, request.prompt) };
    } finally {
      await session.close();
    }
  }
}
