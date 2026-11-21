// Check the public build: dist/levels/ holds exactly the featured levels, and dist/ carries no
// calibration data, raw GRID formats, local absolute paths, raw GRID ids (UUIDs), e-mail
// addresses, or dev-only code (the __rtr automation probe, the debug page).
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const web = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(web, "dist");
const problems = [];

if (!existsSync(dist)) {
  console.error(`verify-dist: FAILED\n  ${dist} does not exist; run \`pnpm build:public\` (or \`pnpm build\`) first`);
  process.exit(1);
}
if (!existsSync(join(dist, "index.html"))) problems.push("dist/index.html is missing");

const featured = JSON.parse(readFileSync(join(web, "src", "game", "featured.json"), "utf8"));
const expected = featured.map((f) => f.file).sort();
let actual = [];
try {
  actual = readdirSync(join(dist, "levels")).sort();
} catch {
  problems.push("dist/levels/ is missing");
}
if (JSON.stringify(actual) !== JSON.stringify(expected)) {
  problems.push(`dist/levels/ has [${actual.join(", ")}], featured.json expects [${expected.join(", ")}]`);
}

const FORBIDDEN_EXT = [".parquet", ".zst", ".jsonl"];
const TEXT_EXT = /\.(html|js|mjs|css|json|map|txt|svg|webmanifest)$/;
const FORBIDDEN_TEXT = [
  { re: /\/Users\//, what: "a local path '/Users/'" },
  { re: /[0-9a-f]{8}-[0-9a-f]{4}-/i, what: "a UUID (raw GRID id?)" },
  { re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/, what: "an e-mail address" },
  { re: /__rtr/, what: "the dev-only '__rtr' probe" },
  { re: /debugPage|startDebugPage|-density\.json/, what: "debug-page code" },
];
function walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    const rel = relative(dist, p);
    if (e.isDirectory()) {
      if (e.name === "calib") problems.push(`${rel}/ must not be published`);
      walk(p);
      continue;
    }
    if (FORBIDDEN_EXT.some((x) => e.name.endsWith(x))) problems.push(`${rel}: forbidden file type`);
    if (!TEXT_EXT.test(e.name)) continue;
    const text = readFileSync(p, "utf8");
    for (const { re, what } of FORBIDDEN_TEXT) {
      const m = re.exec(text);
      if (m) problems.push(`${rel}: contains ${what} ('${m[0].slice(0, 40)}')`);
    }
  }
}
walk(dist);

if (problems.length > 0) {
  console.error(`verify-dist: FAILED\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
console.log(`verify-dist: OK (${actual.length} level(s); no calib/raw data/local paths/UUIDs/e-mails/debug code)`);
