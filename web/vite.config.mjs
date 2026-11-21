// Minimal config: `vite preview` serves the security headers from vercel.json (single source), so the
// CSP can be tested locally before a deploy. `vite dev` is left without them (HMR needs inline/eval).
import { readFileSync } from "node:fs";
import { defineConfig } from "vite";

const vercel = JSON.parse(readFileSync(new URL("./vercel.json", import.meta.url), "utf8"));
const previewHeaders = Object.fromEntries(
  vercel.headers.filter((h) => h.source === "/(.*)").flatMap((h) => h.headers.map((x) => [x.key, x.value])),
);

export default defineConfig({
  preview: { headers: previewHeaders },
});
