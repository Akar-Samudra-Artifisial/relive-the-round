/** Keyboard mute shortcut (pure; takes plain fields so it can be tested without a DOM). */

/** `<input>` types that take no typed text, so a key press there is still a game shortcut. */
const NON_TEXT_INPUTS: ReadonlySet<string> = new Set(["range", "checkbox", "radio", "button", "submit", "reset", "color", "file", "image"]);

export type KeyLike = {
  readonly code: string;
  readonly repeat: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
};

export type TargetLike = {
  readonly tagName?: string;
  readonly type?: string;
  readonly isContentEditable?: boolean;
} | null;

/** True when the target receives typed text (text-like inputs, textarea, contentEditable). */
export function isTextEntry(target: TargetLike): boolean {
  if (!target) return false;
  if (target.isContentEditable === true) return true;
  const tag = target.tagName?.toUpperCase();
  if (tag === "TEXTAREA") return true;
  return tag === "INPUT" && !NON_TEXT_INPUTS.has((target.type ?? "text").toLowerCase());
}

/** Plain M (no repeat, no modifiers) outside text entry toggles mute. */
export function isMuteKey(e: KeyLike, target: TargetLike): boolean {
  return e.code === "KeyM" && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && !isTextEntry(target);
}
