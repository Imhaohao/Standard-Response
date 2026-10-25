// A small client for Capital One's Nessie sandbox (https://api.nessieisreal.com; plain http does not answer). Every request
// carries the key as the `key` query parameter. Create calls answer
// `{ code: 201, message, objectCreated: { _id, ... } }`. No Convex functions live here.

export type NessieConfig = { key: string; baseUrl: string; agencyAccountId: string };

// The live sandbox (checked 2026-10-24) answers a create with `_id` but lists and fetches transfers
// with `id`, and a transfer names no payee: it only debits the paying account.
export type NessieTransfer = {
  id?: string;
  _id?: string;
  amount?: number;
  description?: string;
  status?: string;
};

export const transferIdOf = (transfer: NessieTransfer) => transfer.id ?? transfer._id ?? "";

const DEFAULT_BASE_URL = "https://api.nessieisreal.com";
// One payment makes at most seven requests, so 20 s each stays inside reimburse.ts's 5-minute claim.
const REQUEST_TIMEOUT_MS = 20_000;

// The sandbox needs an address for every customer. It gets the agency's, never the volunteer's home.
const AGENCY_ADDRESS = { street_number: "1", street_name: "Relief Center Way", city: "Altadena", state: "CA", zip: "91001" };

export class NessieError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

// Null when the key or the agency account isn't set: the caller records "not configured".
export function nessieConfig(): NessieConfig | null {
  const key = process.env.NESSIE_API_KEY?.trim();
  const agencyAccountId = process.env.NESSIE_AGENCY_ACCOUNT_ID?.trim();
  if (!key || !agencyAccountId) return null;
  const baseUrl = (process.env.NESSIE_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, "");
  return { key, baseUrl, agencyAccountId };
}

async function call<T>(config: NessieConfig, method: "GET" | "POST", path: string, body?: unknown, query: Record<string, string> = {}): Promise<T> {
  const params = new URLSearchParams({ ...query, key: config.key });
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${config.baseUrl}${path}?${params}`, {
      method,
      headers: body === undefined ? {} : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: abort.signal,
    });
    return await parsed<T>(response, method, path);
  } finally {
    clearTimeout(timer);
  }
}

async function parsed<T>(response: Response, method: string, path: string): Promise<T> {
  const text = await response.text();
  if (!response.ok) throw new NessieError(`Nessie ${method} ${path} answered ${response.status}: ${text.slice(0, 200)}`, response.status);
  return (text ? JSON.parse(text) : null) as T;
}

type Created = { objectCreated?: { _id?: string; status?: string } };

function createdId(result: Created, what: string) {
  const id = result?.objectCreated?._id;
  if (!id) throw new NessieError(`Nessie created a ${what} but sent back no id`, 0);
  return id;
}

export async function createCustomer(config: NessieConfig, name: string) {
  const [first, ...rest] = name.trim().split(/\s+/);
  const body = { first_name: first || "Volunteer", last_name: rest.join(" ") || "Volunteer", address: AGENCY_ADDRESS };
  return createdId(await call<Created>(config, "POST", "/customers", body), "customer");
}

export async function customerAccounts(config: NessieConfig, customerId: string) {
  return (await call<{ _id: string; type?: string }[]>(config, "GET", `/customers/${customerId}/accounts`)) ?? [];
}

export async function createCheckingAccount(config: NessieConfig, customerId: string) {
  const body = { type: "Checking", nickname: "Mileage reimbursements", rewards: 0, balance: 0 };
  return createdId(await call<Created>(config, "POST", `/customers/${customerId}/accounts`, body), "account");
}

// The live sandbox keeps whole dollars only and its transfers carry no payee, so a payment is the
// agency's transfer out and then a deposit of the same amount into the volunteer's account.
// amountCents is always a whole number of dollars here (see amountCentsFor in reimburse.ts).
export async function createTransfer(config: NessieConfig, payeeAccountId: string, amountCents: number, description: string) {
  const amount = Math.round(amountCents / 100);
  const transaction_date = new Date().toISOString().slice(0, 10);
  const sent = { amount, transaction_date, status: "pending", description: `${description}, to account ${payeeAccountId}` };
  const result = await call<Created>(config, "POST", `/accounts/${config.agencyAccountId}/transfers`, sent);
  const id = createdId(result, "transfer");
  const received = { medium: "balance", amount, transaction_date, status: "pending", description };
  await call<Created>(config, "POST", `/accounts/${payeeAccountId}/deposits`, received);
  return { id, status: result.objectCreated?.status };
}

// The transfer, or null when Nessie has no transfer with that id.
export async function getTransfer(config: NessieConfig, transferId: string) {
  try {
    return await call<NessieTransfer>(config, "GET", `/transfers/${transferId}`);
  } catch (error) {
    if (error instanceof NessieError && error.status === 404) return null;
    throw error;
  }
}

// Every transfer the agency account sent.
export async function agencyTransfers(config: NessieConfig) {
  return (await call<NessieTransfer[]>(config, "GET", `/accounts/${config.agencyAccountId}/transfers`)) ?? [];
}
