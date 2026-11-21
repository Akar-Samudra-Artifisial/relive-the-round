import { SYNTHETIC_1V3 } from "../level/fixtures/synthetic-1v3";
import { loadLevel } from "../level/loader";
import type { Level, MapName } from "../level/types";
import featuredJson from "./featured.json";

export type Featured = { readonly map: MapName; readonly file: string; readonly id: string; readonly title: string };

/** Upper bound of the public playlist (also enforced by scripts/prepare-public.mjs). */
export const MAX_FEATURED = 6;
const MAPS: readonly MapName[] = ["kiln", "cistern"];

/** Validate featured.json: ≤ MAX_FEATURED entries, `file` = `<id>.json` with a plain hex id, unique ids. */
export function parseFeatured(raw: unknown): Featured[] {
  if (!Array.isArray(raw)) throw new Error("featured: must be an array");
  if (raw.length === 0 || raw.length > MAX_FEATURED) throw new Error(`featured: need 1..${MAX_FEATURED} entries, got ${raw.length}`);
  const out = raw.map((v: unknown, i): Featured => {
    const o = (typeof v === "object" && v !== null ? v : {}) as Record<string, unknown>;
    const { map, file, id, title } = o;
    if (!MAPS.includes(map as MapName)) throw new Error(`featured[${i}].map: must be one of ${MAPS.join("|")}`);
    if (typeof id !== "string" || !/^[0-9a-f]{6,64}$/.test(id)) throw new Error(`featured[${i}].id: must be a hex id`);
    if (file !== `${id}.json`) throw new Error(`featured[${i}].file: must be '${id}.json'`);
    if (typeof title !== "string" || title === "") throw new Error(`featured[${i}].title: must be a non-empty string`);
    return { map: map as MapName, file, id, title };
  });
  if (new Set(out.map((f) => f.id)).size !== out.length) throw new Error("featured: duplicate id");
  return out;
}

/**
 * Event playlist (src/game/featured.json, shared with scripts/prepare-public.mjs) on Kiln and
 * Cistern. Files are served from public/levels/ (git-ignored, copied
 * from data/levels/<map>/); the synthetic fixture stands in when absent, except in public builds.
 */
export const FEATURED: readonly Featured[] = parseFeatured(featuredJson);

/** Public builds set VITE_REQUIRE_LEVELS=1 so a missing level fails loudly instead of shipping the fixture. */
function levelsRequired(): boolean {
  return import.meta.env.VITE_REQUIRE_LEVELS === "1";
}

export type LoadedLevel = {
  readonly featured: Featured;
  readonly level: Level;
  readonly synthetic: boolean;
  /** One-line summary derived from the level data. */
  readonly blurb: string;
};

const PRO_RESULT: Record<Level["outcome"]["reason"], string> = {
  elimination: "won the fight",
  defuse: "defused",
  detonate: "waited out the spike",
  time: "ran the clock down",
  unknown: "won",
};

/** e.g. "1v3 · attack · spike down on A · pro waited out the spike in 23.6 s". */
export function blurbFor(level: Level): string {
  const spike = level.spike.planted ? `spike down on ${level.spike.site ?? "?"}` : "spike not planted";
  const pro = level.clutcherWon ? `pro ${PRO_RESULT[level.outcome.reason]}` : "pro lost";
  return `1v${level.clutchSize} · ${level.clutcherSide} · ${spike} · ${pro} in ${level.outcome.t.toFixed(1)} s`;
}

export async function loadFeatured(f: Featured): Promise<LoadedLevel> {
  try {
    const level = await loadLevel(f.file);
    if (level.map !== f.map || level.id !== f.id) {
      throw new Error(`level: ${f.file} is ${level.map}/${level.id}, featured.json expects ${f.map}/${f.id}`);
    }
    return { featured: f, level, synthetic: false, blurb: blurbFor(level) };
  } catch (err) {
    if (levelsRequired()) throw err;
    // Missing real data (fresh clone / no ETL run): keep the kiosk playable with the fixture.
    // Re-tagged per slot: the right map (e.g. Cistern) and a unique id so scores don't collide.
    const level: Level = { ...SYNTHETIC_1V3, id: `synthetic-${f.id.slice(0, 20)}`, map: f.map };
    return { featured: f, level, synthetic: true, blurb: blurbFor(level) };
  }
}
