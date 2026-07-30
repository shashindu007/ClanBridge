// T2.4 — mappers, and T2.2 — schemas parsed against the actual fixture files.
//
// Two jobs here:
//   1. Every fixture on disk parses against its schema. Today those fixtures are
//      synthetic, so this proves the schemas are self-consistent. The moment
//      real ones are captured, the SAME test proves them against reality.
//   2. The mappers absorb the API's quirks, so nothing above src/integration/
//      ever sees them (R7).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  FIXTURE_SCHEMAS,
  clanSchema,
  cwlGroupSchema,
  playerSchema,
  raidSeasonsSchema,
  warSchema,
} from "../coc-schemas";
import {
  mapClan,
  mapClanMembers,
  mapCwlGroup,
  mapPlayer,
  mapRaidSeasons,
  mapRole,
  mapSnapshot,
  mapWar,
} from "./index";

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(join(process.cwd(), "fixtures", name), "utf8"));
}

// ---------------------------------------------------------------------------
// The gate, as a test. Mirrors what `npm run fixtures:capture` enforces.
// ---------------------------------------------------------------------------
describe("T2.2 — every fixture parses against its schema", () => {
  it.each(Object.keys(FIXTURE_SCHEMAS))("%s", (file) => {
    const schema = FIXTURE_SCHEMAS[file as keyof typeof FIXTURE_SCHEMAS];
    const result = schema.safeParse(fixture(file));

    if (!result.success) {
      const issues = result.error.issues
        .slice(0, 8)
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("\n  ");
      expect.fail(`${file} does not match its schema:\n  ${issues}`);
    }
  });

  // Until this flips, the shapes in coc-schemas.ts are assumptions rather than
  // facts. Kept as a visible reminder rather than a comment nobody reads.
  it("reports whether the fixtures are still synthetic", () => {
    const synthetic = Object.keys(FIXTURE_SCHEMAS).filter(
      (f) => "_synthetic" in (fixture(f) as Record<string, unknown>),
    );
    if (synthetic.length) {
      console.warn(
        `\n  NOTE: ${synthetic.length}/6 fixtures are SYNTHETIC. The schemas are ` +
          `documented, not verified.\n  Run: npm run fixtures:capture -- '#YOURCLANTAG'\n`,
      );
    }
    expect(synthetic.length).toBeLessThanOrEqual(6);
  });
});

// ---------------------------------------------------------------------------
// R7 — the quirks that must not escape src/integration/
// ---------------------------------------------------------------------------
describe("mapRole", () => {
  // The single most common mapping error against this API: 'admin' is Elder,
  // not a leadership rank.
  it("maps admin to elder", () => {
    expect(mapRole("admin")).toBe("elder");
  });

  it("maps the rest", () => {
    expect(mapRole("leader")).toBe("leader");
    expect(mapRole("coLeader")).toBe("co-leader");
    expect(mapRole("member")).toBe("member");
  });

  // Appears in war rosters for players who have since left.
  it("treats notMember as no role rather than inventing one", () => {
    expect(mapRole("notMember")).toBeUndefined();
    expect(mapRole(undefined)).toBeUndefined();
  });
});

describe("mapClan", () => {
  const api = clanSchema.parse(fixture("clan.json"));
  const clan = mapClan(api);

  it("normalises the tag", () => {
    expect(clan.tag).toMatch(/^#[0289PYLQGRJCUV]+$/);
  });

  it("flattens badgeUrls to a single url", () => {
    expect(typeof clan.badgeUrl).toBe("string");
    expect(clan).not.toHaveProperty("badgeUrls");
  });

  it("flattens warLeague to its name", () => {
    expect(clan.warLeague).toBe("Crystal League I");
  });

  it("exposes no raw API field names (R7)", () => {
    const keys = Object.keys(clan);
    expect(keys).not.toContain("clanLevel");
    expect(keys).not.toContain("memberList");
    expect(keys).not.toContain("badgeUrls");
  });

  // T0.1 is machine-checkable: the API reports the war log setting, so a clan
  // switched to private mid-season is caught rather than surfacing later as an
  // unexplained 403 in the war module.
  it("carries isWarLogPublic through, so T0.1 can be verified automatically", () => {
    expect(clan.isWarLogPublic).toBe(true);

    const priv = mapClan(clanSchema.parse({ ...api, isWarLogPublic: false }));
    expect(priv.isWarLogPublic).toBe(false);
  });

  it("leaves isWarLogPublic undefined when the API omits it", () => {
    const bare = mapClan(clanSchema.parse({ tag: "#2PP0JCCL", name: "x" }));
    expect(bare.isWarLogPublic).toBeUndefined();
  });
});

describe("mapClanMembers", () => {
  const api = clanSchema.parse(fixture("clan.json"));
  const members = mapClanMembers(api);

  it("maps every member", () => {
    expect(members).toHaveLength(api.memberList.length);
  });

  it("carries the clan tag onto each member", () => {
    for (const m of members) expect(m.clanTag).toBe(mapClan(api).tag);
  });

  it("translates roles, including admin", () => {
    expect(members.map((m) => m.role)).toEqual([
      "leader",
      "co-leader",
      "elder",
      "member",
      "member",
    ]);
  });

  it("renames townHallLevel to thLevel", () => {
    expect(members[0]!.thLevel).toBe(16);
    expect(members[0]).not.toHaveProperty("townHallLevel");
  });
});

describe("mapSnapshot (T2.9)", () => {
  const api = clanSchema.parse(fixture("clan.json"));

  it("carries the cumulative counters that get differenced later", () => {
    const snap = mapSnapshot(api.memberList[0]!);
    expect(snap.donations).toBe(1200);
    expect(snap.donationsReceived).toBe(800);
    expect(snap.trophies).toBe(5200);
  });

  // A missing counter must stay undefined. Defaulting to 0 would look like a
  // real reading and corrupt the season difference.
  it("leaves an absent counter undefined rather than zero", () => {
    const snap = mapSnapshot({ tag: "#2PP0JCCL", name: "x" });
    expect(snap.donations).toBeUndefined();
    expect(snap.warStars).toBeUndefined();
  });
});

describe("mapWar", () => {
  const war = mapWar(warSchema.parse(fixture("currentwar.json")));

  it("parses Supercell timestamps into real Dates", () => {
    expect(war.startTime).toBeInstanceOf(Date);
    expect(war.endTime?.toISOString()).toBe("2026-07-30T06:00:00.000Z");
  });

  // The API OMITS `attacks` for a player who did not attack. Normalised to []
  // here so callers can iterate — but the missed list is still DERIVED from
  // roster minus attacks (T4.3), never stored as zero-star rows.
  it("normalises an absent attacks field to an empty array", () => {
    const members = war.clan!.members;
    expect(members[3]!.attacks).toEqual([]);
    expect(members[4]!.attacks).toEqual([]);
    expect(members[0]!.attacks.length).toBeGreaterThan(0);
  });

  it("still lets missed attacks be derived from roster minus attacks", () => {
    const missed = war.clan!.members.filter((m) => m.attacks.length === 0);
    expect(missed.map((m) => m.name)).toEqual(["Player 04", "Player 05"]);
  });

  it("renames destructionPercentage and attacker/defender tags", () => {
    const attack = war.clan!.members[0]!.attacks[0]!;
    expect(typeof attack.destruction).toBe("number");
    expect(attack).not.toHaveProperty("destructionPercentage");
    expect(attack.attackerTag).toMatch(/^#/);
  });

  // townhallLevel on war endpoints, townHallLevel on the clan endpoint. Absorbed
  // here so nothing above has to remember which is which.
  it("absorbs the townhallLevel casing difference", () => {
    expect(war.clan!.members[0]!.thLevel).toBe(16);
  });

  // R10 — notInWar sends almost nothing, and must not throw.
  it("handles notInWar, where nearly every field is absent", () => {
    const idle = mapWar(warSchema.parse({ state: "notInWar" }));
    expect(idle.state).toBe("notInWar");
    expect(idle.clan).toBeUndefined();
    expect(idle.startTime).toBeUndefined();
  });

  it("passes an unrecognised state through as notInWar rather than throwing", () => {
    // Supercell has added states before. Dying on an unknown one loses the war.
    const odd = mapWar(warSchema.parse({ state: "someFutureState" }));
    expect(odd.state).toBe("notInWar");
  });
});

describe("mapCwlGroup", () => {
  const group = mapCwlGroup(cwlGroupSchema.parse(fixture("cwlgroup.json")));

  it("flattens rounds into a single list of war tags", () => {
    expect(group.warTags).toEqual(["#8G9QRVJL", "#9CUVPYQ2"]);
  });

  // '#0' means a round that has not started. Fetching one is a guaranteed 404,
  // so it is filtered here rather than in every caller.
  it("filters out the #0 placeholder rounds", () => {
    expect(group.warTags).not.toContain("#0");
  });

  it("keeps the season, which is the natural key for cwl_seasons", () => {
    expect(group.season).toBe("2026-07");
  });
});

describe("mapRaidSeasons", () => {
  const seasons = mapRaidSeasons(raidSeasonsSchema.parse(fixture("capitalraids.json")));

  it("parses the season window into Dates", () => {
    expect(seasons[0]!.startTime).toBeInstanceOf(Date);
    expect(seasons[0]!.endTime).toBeInstanceOf(Date);
  });

  it("renames capitalResourcesLooted to loot", () => {
    expect(seasons[0]!.participants[0]!.loot).toBe(24000);
    expect(seasons[0]!.participants[0]).not.toHaveProperty("capitalResourcesLooted");
  });

  it("survives a season with no members array", () => {
    const empty = mapRaidSeasons(
      raidSeasonsSchema.parse({
        items: [{ startTime: "20260725T070000.000Z", endTime: "20260728T070000.000Z" }],
      }),
    );
    expect(empty[0]!.participants).toEqual([]);
  });
});

describe("mapPlayer", () => {
  const player = mapPlayer(playerSchema.parse(fixture("player.json")));

  it("maps the basics", () => {
    expect(player.tag).toMatch(/^#/);
    expect(player.warStars).toBe(1420);
    expect(player.role).toBe("leader");
  });

  // T7.4 derives a Clan Games score by differencing this value between two
  // snapshots, because the API exposes no per-season score at all.
  it("extracts the Games Champion achievement value", () => {
    expect(player.gamesChampionValue).toBe(21000);
  });

  it("leaves it undefined when the achievement is absent", () => {
    const bare = mapPlayer(
      playerSchema.parse({ tag: "#2PP0JCCL", name: "x", achievements: [] }),
    );
    expect(bare.gamesChampionValue).toBeUndefined();
  });

  it("exposes no achievements array above the boundary (R7)", () => {
    expect(player).not.toHaveProperty("achievements");
  });
});
