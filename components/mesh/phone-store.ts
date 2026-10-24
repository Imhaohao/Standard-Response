import { MeshNode, NodeSnapshot } from "@/lib/mesh/node";
import { cryptoRandom, randomId } from "@/lib/mesh/random";

// The resident's phone as an external store, read by React through useSyncExternalStore. Its state
// is saved in the browser so it survives reloads and works with no signal. Only one tab may own
// the saved phone (a Web Lock decides); any other tab on the device is a separate phone kept in
// that tab's session storage. Two tabs restoring the same phone would duplicate its share of the
// aggregation, so they never do.

const STORAGE_KEY = "rollcall-mesh-phone";
const LOCK_NAME = "rollcall-mesh-phone";

export type PhoneSettings = { gateway: boolean; warningIssuedAt?: number };
type Saved = { node?: Partial<NodeSnapshot> } & Partial<PhoneSettings>;

function load(storage: Storage): Saved {
  try {
    return JSON.parse(storage.getItem(STORAGE_KEY) ?? "{}") as Saved;
  } catch {
    return {};
  }
}

type Locks = { request: (name: string, options: { ifAvailable: boolean }, callback: (lock: unknown) => Promise<unknown> | null) => Promise<unknown> };

// Resolves with the storage this tab's phone lives in, holding the lock for the tab's lifetime.
function claimStorage(): Promise<Storage> {
  const locks = (navigator as { locks?: Locks }).locks;
  if (!locks) return Promise.resolve(localStorage);
  return new Promise((resolve) => {
    void locks.request(LOCK_NAME, { ifAvailable: true }, (lock) => {
      if (!lock) {
        resolve(sessionStorage);
        return null;
      }
      resolve(localStorage);
      return new Promise(() => {});
    });
  });
}

export class PhoneStore {
  readonly node = new MeshNode({ newId: randomId, random: cryptoRandom, now: Date.now, participate: false });
  settings: PhoneSettings = { gateway: false };
  private revision = 0;
  private restored = false;
  private listeners = new Set<() => void>();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private storage: Storage | null = null;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getRevision = () => this.revision;

  restoreOnce() {
    if (this.restored) return;
    this.restored = true;
    void claimStorage().then((storage) => {
      this.storage = storage;
      const saved = load(storage);
      if (saved.node) this.node.restore(saved.node);
      this.settings = { gateway: Boolean(saved.gateway), warningIssuedAt: saved.warningIssuedAt };
      this.changed();
    });
  }

  private online = false;

  update(settings: Partial<PhoneSettings>) {
    this.settings = { ...this.settings, ...settings };
    this.node.sink = this.settings.gateway && this.online;
    this.changed();
  }

  // A phone is a gateway only while it has internet and its owner agreed to upload for others.
  setOnline(online: boolean) {
    this.online = online;
    this.node.sink = this.settings.gateway && online;
  }

  // Something about this phone changed: redraw, and save shortly after.
  changed() {
    this.revision += 1;
    for (const listener of this.listeners) listener();
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.save(), 500);
  }

  private save() {
    try {
      this.storage?.setItem(STORAGE_KEY, JSON.stringify({ node: this.node.snapshot(), ...this.settings }));
    } catch {
      // Storage full or blocked: the phone still works for this session.
    }
  }
}

let store: PhoneStore | null = null;

// One store per browser tab. Server renders get a throwaway, so nothing is shared between visitors.
export function phoneStore() {
  if (typeof window === "undefined") return new PhoneStore();
  store ??= new PhoneStore();
  return store;
}
