import { describe, expect, it } from "vitest";
import { isMuteKey, isTextEntry, type KeyLike } from "../src/audio/keys";

const m: KeyLike = { code: "KeyM", repeat: false, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false };

describe("mute shortcut", () => {
  it("toggles on plain M outside text entry, including the replay slider", () => {
    expect(isMuteKey(m, null)).toBe(true);
    expect(isMuteKey(m, { tagName: "BUTTON", type: "button" })).toBe(true);
    expect(isMuteKey(m, { tagName: "INPUT", type: "range" })).toBe(true);
    expect(isMuteKey(m, { tagName: "INPUT", type: "checkbox" })).toBe(true);
  });

  it("is ignored while typing (initials field has no type attribute, so it reports 'text')", () => {
    expect(isMuteKey(m, { tagName: "INPUT", type: "text" })).toBe(false);
    expect(isMuteKey(m, { tagName: "INPUT" })).toBe(false);
    expect(isMuteKey(m, { tagName: "INPUT", type: "search" })).toBe(false);
    expect(isMuteKey(m, { tagName: "TEXTAREA" })).toBe(false);
    expect(isMuteKey(m, { tagName: "DIV", isContentEditable: true })).toBe(false);
  });

  it("is ignored on key repeat, modifiers and other keys", () => {
    expect(isMuteKey({ ...m, repeat: true }, null)).toBe(false);
    for (const mod of ["ctrlKey", "metaKey", "altKey", "shiftKey"] as const) expect(isMuteKey({ ...m, [mod]: true }, null)).toBe(false);
    expect(isMuteKey({ ...m, code: "KeyN" }, null)).toBe(false);
  });

  it("classifies text entry", () => {
    expect(isTextEntry(null)).toBe(false);
    expect(isTextEntry({ tagName: "input", type: "EMAIL" })).toBe(true);
    expect(isTextEntry({ tagName: "INPUT", type: "radio" })).toBe(false);
  });
});
