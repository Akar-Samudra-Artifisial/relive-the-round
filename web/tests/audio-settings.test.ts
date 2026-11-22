import { describe, expect, it } from "vitest";
import { baseSettings, loadSettings, saveSettings, settingsContext, STORAGE_KEY, toggleMuted, type SettingsStore } from "../src/audio/settings";

function memory(initial: Record<string, string> = {}): SettingsStore & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => data[k] ?? null,
    setItem: (k, v) => {
      data[k] = v;
    },
  };
}

describe("audio settings", () => {
  it("defaults to sound and music on", () => {
    const ctx = settingsContext("", false);
    expect(loadSettings(ctx, memory())).toEqual({ muted: false, music: true });
  });

  it("persists the mute choice in normal mode", () => {
    const ctx = settingsContext("", false);
    const store = memory();
    expect(saveSettings(ctx, store, toggleMuted(loadSettings(ctx, store)))).toBe(true);
    expect(JSON.parse(store.data[STORAGE_KEY]!)).toEqual({ muted: true, music: true });
    expect(loadSettings(ctx, store).muted).toBe(true);
  });

  it("?mute and ?auto force silence and never persist", () => {
    for (const q of ["?mute", "?auto", "?auto&level=1"]) {
      const ctx = settingsContext(q, false);
      const store = memory({ [STORAGE_KEY]: JSON.stringify({ muted: false, music: true }) });
      expect(loadSettings(ctx, store).muted, q).toBe(true);
      expect(saveSettings(ctx, store, { muted: false, music: true })).toBe(false);
    }
  });

  it("?music=0 disables music even when storage says on", () => {
    const ctx = settingsContext("?music=0", false);
    const store = memory({ [STORAGE_KEY]: JSON.stringify({ muted: false, music: true }) });
    expect(loadSettings(ctx, store)).toEqual({ muted: false, music: false });
  });

  it("kiosk mode ignores storage and returns to unmuted defaults", () => {
    const ctx = settingsContext("?kiosk=1", true);
    const store = memory({ [STORAGE_KEY]: JSON.stringify({ muted: true, music: true }) });
    expect(loadSettings(ctx, store).muted).toBe(false);
    expect(saveSettings(ctx, store, { muted: true, music: true })).toBe(false);
    expect(baseSettings(ctx)).toEqual({ muted: false, music: true });
  });

  it("malformed or failing storage falls back to the defaults", () => {
    const ctx = settingsContext("", false);
    expect(loadSettings(ctx, memory({ [STORAGE_KEY]: "{oops" }))).toEqual({ muted: false, music: true });
    expect(loadSettings(ctx, memory({ [STORAGE_KEY]: "42" }))).toEqual({ muted: false, music: true });
    const broken: SettingsStore = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    expect(loadSettings(ctx, broken)).toEqual({ muted: false, music: true });
    expect(saveSettings(ctx, broken, { muted: true, music: true })).toBe(false);
    expect(loadSettings(ctx, null)).toEqual({ muted: false, music: true });
  });
});
