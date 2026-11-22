/**
 * Sound settings (pure: storage is injected, no DOM access). `muted` silences everything,
 * `music` turns the generated background music on or off.
 */
export type AudioSettings = { readonly muted: boolean; readonly music: boolean };

/** The subset of `Storage` the settings use (web storage in the browser, a stub in tests). */
export type SettingsStore = Pick<Storage, "getItem" | "setItem">;

/** How the URL and kiosk mode constrain the settings for this page load. */
export type SettingsContext = {
  /** `?mute` or `?auto`: start muted, never persist. */
  readonly forcedSilent: boolean;
  /** False with `?music=0`. */
  readonly musicAllowed: boolean;
  /** Normal mode persists to storage; a kiosk keeps the choice for the current visitor only. */
  readonly persist: boolean;
};

export const STORAGE_KEY = "rtr.audio.v1";
export const DEFAULT_SETTINGS: AudioSettings = { muted: false, music: true };

export function settingsContext(search: string, kiosk: boolean): SettingsContext {
  const params = new URLSearchParams(search);
  const forcedSilent = params.has("mute") || params.has("auto");
  return { forcedSilent, musicAllowed: params.get("music") !== "0", persist: !kiosk && !forcedSilent };
}

/** Defaults for this page load, ignoring storage (also what a kiosk returns to on its idle loop). */
export function baseSettings(ctx: SettingsContext): AudioSettings {
  return { muted: ctx.forcedSilent, music: ctx.musicAllowed };
}

/** Reads persisted settings; anything missing or malformed falls back to the defaults. */
export function loadSettings(ctx: SettingsContext, store: SettingsStore | null): AudioSettings {
  const base = baseSettings(ctx);
  if (!ctx.persist || !store) return base;
  let raw: string | null = null;
  try {
    raw = store.getItem(STORAGE_KEY);
  } catch {
    return base;
  }
  if (raw === null) return base;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return base;
    const o = parsed as Record<string, unknown>;
    return {
      muted: typeof o.muted === "boolean" ? o.muted : base.muted,
      music: ctx.musicAllowed && (typeof o.music === "boolean" ? o.music : true),
    };
  } catch {
    return base;
  }
}

/** Persists the settings when this page load may (returns false when skipped or storage fails). */
export function saveSettings(ctx: SettingsContext, store: SettingsStore | null, s: AudioSettings): boolean {
  if (!ctx.persist || !store) return false;
  try {
    store.setItem(STORAGE_KEY, JSON.stringify({ muted: s.muted, music: s.music }));
    return true;
  } catch {
    return false;
  }
}

export function toggleMuted(s: AudioSettings): AudioSettings {
  return { ...s, muted: !s.muted };
}
