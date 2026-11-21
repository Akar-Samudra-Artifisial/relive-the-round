import Ajv2020 from "ajv/dist/2020";
import { describe, expect, it } from "vitest";
import schema from "../../docs/level.schema.json";
import { SYNTHETIC_1V3 } from "../src/level/fixtures/synthetic-1v3";
import { checkLevelSemantics, parseLevel } from "../src/level/loader";
import type { Level } from "../src/level/types";

// Contract with the ETL: docs/level.schema.json (structure) + docs/level-schema.md "Semantic checks".
const validate = new Ajv2020({ allErrors: true, strict: false }).compile(schema);

const FIXTURES: readonly Level[] = [SYNTHETIC_1V3];

function mutate(fn: (l: Level) => void): unknown {
  const copy = structuredClone(SYNTHETIC_1V3);
  fn(copy);
  return copy;
}

describe("level contract", () => {
  for (const fx of FIXTURES) {
    it(`${fx.id} validates against docs/level.schema.json`, () => {
      const ok = validate(JSON.parse(JSON.stringify(fx)));
      expect(validate.errors ?? [], JSON.stringify(validate.errors)).toEqual([]);
      expect(ok).toBe(true);
    });

    it(`${fx.id} passes the semantic checks`, () => {
      expect(() => checkLevelSemantics(fx)).not.toThrow();
    });
  }

  it("schema rejects outcome.t as a string (sanity: validator is live)", () => {
    expect(validate(mutate((l) => Object.assign(l.outcome, { t: "28" })))).toBe(false);
  });

  const bad: readonly [string, (l: Level) => void, RegExp][] = [
    ["outcome.t != durationS", (l) => (l.outcome.t = l.durationS - 1), /outcome\.t/],
    ["winner contradicts clutcherWon", (l) => (l.clutcherWon = false), /outcome\.winner/],
    ["enemies.length != clutchSize", (l) => (l.clutchSize = 4), /clutchSize/],
    ["enemy ids out of order", (l) => (l.enemies[0]!.id = "E2"), /enemies\[0\]\.id/],
    ["hp <= 0", (l) => (l.enemies[1]!.hp = 0), /enemies\[1\]\.hp/],
    ["u out of [0,1]", (l) => (l.clutcher.samples[2]!.u = 1.2), /clutcher\.samples\[2\]\.u/],
    ["kill uv out of [0,1]", (l) => (l.kills[0]!.victimUV = [0.2, -0.1]), /kills\[0\]\.victimUV\[1\]/],
    ["kill references missing actor", (l) => (l.kills[0]!.victim = "E5"), /kills\[0\]\.victim/],
    ["first sample not at t=0", (l) => (l.enemies[2]!.samples[0]!.t = 1), /enemies\[2\]\.samples\[0\]\.t/],
    ["samples after diedT", (l) => (l.enemies[0]!.diedT = 10), /enemies\[0\]\.samples/],
    ["kill after durationS", (l) => (l.kills[2]!.t = 99), /kills\[2\]\.t/],
  ];
  for (const [name, fn, re] of bad) {
    it(`loader rejects: ${name}`, () => {
      expect(() => parseLevel(mutate(fn))).toThrow(re);
    });
  }
});
