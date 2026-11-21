// Minimal local leaderboard (per device, per level) in localStorage.

export type Entry = { readonly initials: string; readonly points: number; readonly levelId: string };

/** The slice of the Web Storage API used here (injectable for tests). */
export type KeyValueStore = Pick<Storage, "getItem" | "setItem">;

const KEY = "rtr.leaderboard.v1";
/** Entries kept per level. */
export const MAX_PER_LEVEL = 10;
const INITIALS = /^[A-Z]{3}$/;

/** Upper-cases and keeps at most three letters A–Z (for live input filtering). */
export function normalizeInitials(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3);
}

/** A saved entry needs exactly three letters A–Z. */
export function validInitials(raw: string): boolean {
  return INITIALS.test(normalizeInitials(raw));
}

function defaultStore(): KeyValueStore | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    // Access itself can throw (privacy mode / sandboxed iframe).
    return null;
  }
}

function read(store: KeyValueStore | null): Entry[] {
  if (!store) return [];
  try {
    const raw: unknown = JSON.parse(store.getItem(KEY) ?? "[]");
    if (!Array.isArray(raw)) return [];
    return raw.filter(
      (e: unknown): e is Entry =>
        typeof e === "object" &&
        e !== null &&
        typeof (e as Entry).initials === "string" &&
        INITIALS.test((e as Entry).initials) &&
        typeof (e as Entry).points === "number" &&
        Number.isFinite((e as Entry).points) &&
        typeof (e as Entry).levelId === "string",
    );
  } catch {
    // Unreadable or corrupt storage: start over rather than break the kiosk.
    return [];
  }
}

export function topEntries(levelId?: string, store: KeyValueStore | null = defaultStore()): Entry[] {
  return read(store)
    .filter((e) => levelId === undefined || e.levelId === levelId)
    .sort((a, b) => b.points - a.points)
    .slice(0, MAX_PER_LEVEL);
}

/** Removes every entry (operator reset). Returns false when storage is unavailable or the write fails. */
export function clearEntries(store: KeyValueStore | null = defaultStore()): boolean {
  if (!store) return false;
  try {
    store.setItem(KEY, "[]");
    return true;
  } catch {
    return false;
  }
}

/** Adds an entry; keeps the best MAX_PER_LEVEL per level. Returns false when not saved (bad initials or storage failure). */
export function addEntry(entry: Entry, store: KeyValueStore | null = defaultStore()): boolean {
  if (!store || !validInitials(entry.initials) || !Number.isFinite(entry.points)) return false;
  const all = [...read(store), { ...entry, initials: normalizeInitials(entry.initials) }].sort((a, b) => b.points - a.points);
  const perLevel = new Map<string, number>();
  const kept = all.filter((e) => {
    const n = perLevel.get(e.levelId) ?? 0;
    perLevel.set(e.levelId, n + 1);
    return n < MAX_PER_LEVEL;
  });
  try {
    store.setItem(KEY, JSON.stringify(kept));
    return true;
  } catch {
    // Quota exceeded / storage disabled: the round still ends normally, the score is just not kept.
    return false;
  }
}
