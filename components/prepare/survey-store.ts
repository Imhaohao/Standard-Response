import { LatLng } from "@/lib/geo";
import { cryptoRandom, randomId } from "@/lib/mesh/random";
import { SurveyPhone, SurveySnapshot } from "@/lib/prepare/node";

// The household's phone as an external store, read by React through useSyncExternalStore, saved in
// the browser so it survives reloads and works offline. As with the mesh phone
// (components/mesh/phone-store.ts), one tab owns the saved phone through a Web Lock and any other
// tab is a separate phone in its own session storage, so a phone's mass is never restored twice.
// The home pin is saved here too and nowhere else.

const STORAGE_KEY = "rollcall-prepare-phone";
const LOCK_NAME = "rollcall-prepare-phone";

export type SurveySettings = { gateway: boolean; home?: LatLng };
type Saved = { phone?: Partial<SurveySnapshot> } & Partial<SurveySettings>;

function load(storage: Storage): Saved {
  try {
    return JSON.parse(storage.getItem(STORAGE_KEY) ?? "{}") as Saved;
  } catch {
    return {};
  }
}

type Locks = { request: (name: string, options: { ifAvailable: boolean }, callback: (lock: unknown) => Promise<unknown> | null) => Promise<unknown> };

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

const isLatLng = (value: unknown): value is LatLng =>
  typeof value === "object" && value !== null && Number.isFinite((value as LatLng).lat) && Number.isFinite((value as LatLng).lng);

export class SurveyStore {
  readonly phone = new SurveyPhone({ newId: randomId, random: cryptoRandom, now: Date.now });
  settings: SurveySettings = { gateway: false };
  private revision = 0;
  private restored = false;
  private online = false;
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
      if (saved.phone) this.phone.restore(saved.phone);
      this.settings = { gateway: Boolean(saved.gateway), home: isLatLng(saved.home) ? saved.home : undefined };
      this.phone.sink = this.settings.gateway && this.online;
      this.changed();
    });
  }

  update(settings: Partial<SurveySettings>) {
    this.settings = { ...this.settings, ...settings };
    this.phone.sink = this.settings.gateway && this.online;
    this.changed();
  }

  // A phone is a gateway only while it has internet and its owner agreed to upload for others.
  setOnline(online: boolean) {
    this.online = online;
    this.phone.sink = this.settings.gateway && online;
  }

  changed() {
    this.revision += 1;
    for (const listener of this.listeners) listener();
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.save(), 500);
  }

  private save() {
    try {
      this.storage?.setItem(STORAGE_KEY, JSON.stringify({ phone: this.phone.snapshot(), ...this.settings }));
    } catch {
      // Storage full or blocked: the phone still works for this session.
    }
  }
}

let store: SurveyStore | null = null;

// One store per browser tab. Server renders get a throwaway, so nothing is shared between visitors.
export function surveyStore() {
  if (typeof window === "undefined") return new SurveyStore();
  store ??= new SurveyStore();
  return store;
}
