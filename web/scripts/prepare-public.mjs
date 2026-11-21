// Fill web/public/levels/ with exactly the levels in src/game/featured.json, copied from
// data/levels/<map>/. Fails (exit 1) on a missing file, more than 6 entries, or a public/calib/
// folder (calibration rasters are dev-only and must not ship).
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const MAX_FEATURED = 6;
const MAPS = new Set(["kiln", "cistern"]);
const web = join(dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = join(web, "..", "data", "levels");
const outDir = join(web, "public", "levels");

function die(msg) {
  console.error(`prepare-public: ${msg}`);
  process.exit(1);
}

const featured = JSON.parse(readFileSync(join(web, "src", "game", "featured.json"), "utf8"));
if (!Array.isArray(featured) || featured.length === 0) die("featured.json must be a non-empty array");
if (featured.length > MAX_FEATURED) die(`featured.json lists ${featured.length} levels, max is ${MAX_FEATURED}`);
for (const [i, f] of featured.entries()) {
  if (!MAPS.has(f?.map)) die(`featured[${i}].map '${f?.map}' is not one of ${[...MAPS].join("|")}`);
  if (typeof f.id !== "string" || !/^[0-9a-f]{6,64}$/.test(f.id) || f.file !== `${f.id}.json`) {
    die(`featured[${i}] needs a hex id and file '<id>.json', got id '${f.id}' file '${f.file}'`);
  }
}
if (existsSync(join(web, "public", "calib"))) {
  die("web/public/calib/ exists; it is dev-only and would be published. Move it out before a public build.");
}

const missing = featured.map((f) => join(dataDir, f.map, f.file)).filter((p) => !existsSync(p));
if (missing.length > 0) die(`missing level file(s) (run the ETL export first):\n  ${missing.join("\n  ")}`);

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
for (const f of featured) copyFileSync(join(dataDir, f.map, f.file), join(outDir, f.file));
console.log(`prepare-public: copied ${featured.length} level(s) to public/levels/`);
