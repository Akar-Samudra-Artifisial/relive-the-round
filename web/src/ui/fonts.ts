/** Font stacks matching theme.css (self-hosted via @fontsource, imported there). */
export const DISPLAY_FONT = '"Chakra Petch", system-ui, sans-serif';
export const MONO_FONT = '"JetBrains Mono", ui-monospace, monospace';

let ready: Promise<void> | null = null;

/**
 * Resolves once the display/mono faces are loaded, so canvas text (Pixi Text, the score card)
 * never rasterises with a fallback font. Never rejects: on failure the fallback stack is used.
 */
export function ensureFonts(): Promise<void> {
  if (typeof document === "undefined" || !("fonts" in document)) return Promise.resolve();
  ready ??= Promise.all([
    document.fonts.load('700 48px "Chakra Petch"'),
    document.fonts.load('600 48px "Chakra Petch"'),
    document.fonts.load('400 24px "JetBrains Mono"'),
    document.fonts.load('700 24px "JetBrains Mono"'),
  ]).then(
    () => undefined,
    () => undefined,
  );
  return ready;
}

/** True when the user asked the OS for reduced motion (checked live; cheap). */
export function prefersReducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}
