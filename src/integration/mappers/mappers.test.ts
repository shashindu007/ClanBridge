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
import { normaliseTag } from "@/lib/tags";
import {
  mapClan,
  mapClanMembers,
  mapCwlGroup,
  mapDonationCounters,
  mapPlayer,
  mapPlayerProgress,
  mapRaidSeasons,
  mapRole,
  mapSnapshot,
  mapWar,
  normaliseCwlSeason,
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
    // Derived from the fixture, not a literal. These files are RE-CAPTURED from
    // the live API (T2.1), so a hardcoded league name asserts which clan was
    // captured rather than what the mapper does — and breaks every time the
    // fixtures are refreshed. The behaviour under test is the flattening.
    expect(clan.warLeague).toBe(api.warLeague?.name);
    expect(clan.warLeague).not.toBeInstanceOf(Object);
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
    expect(clan.isWarLogPublic).toBe(api.isWarLogPublic);

    // Both directions asserted explicitly, because "carries it through" is only
    // useful if `false` survives. A mapper that dropped the field would still
    // satisfy the line above when the captured clan happens to be public.
    const priv = mapClan(clanSchema.parse({ ...api, isWarLogPublic: false }));
    expect(priv.isWarLogPublic).toBe(false);

    const pub = mapClan(clanSchema.parse({ ...api, isWarLogPublic: true }));
    expect(pub.isWarLogPublic).toBe(true);
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
    // Position-by-position against the source, rather than a fixed list: a real
    // clan is 30-50 members in whatever order the API returns them, and the
    // mapping under test is per member, not the shape of one captured roster.
    expect(members.map((m) => m.role)).toEqual(
      api.memberList.map((m) => mapRole(m.role)),
    );

    // The two wire names that are not ours. Asserted on mapRole directly: the
    // mapped member type already excludes them, so `m.role !== "admin"` is a
    // comparison TypeScript rejects as impossible — and it would have been a
    // test that could never fail.
    expect(mapRole("admin")).toBe("elder");
    expect(mapRole("coLeader")).toBe("co-leader");

    // Every mapped role is one players.clan_role's CHECK constraint accepts.
    for (const member of members) {
      expect(["leader", "co-leader", "elder", "member"]).toContain(member.role);
    }
  });

  it("renames townHallLevel to thLevel", () => {
    expect(members[0]!.thLevel).toBe(api.memberList[0]!.townHallLevel);
    expect(members[0]).not.toHaveProperty("townHallLevel");
  });
});

describe("mapSnapshot (T2.9)", () => {
  const api = clanSchema.parse(fixture("clan.json"));

  it("carries the cumulative counters that get differenced later", () => {
    const source = api.memberList[0]!;
    const snap = mapSnapshot(source);
    expect(snap.donations).toBe(source.donations);
    expect(snap.donationsReceived).toBe(source.donationsReceived);
    expect(snap.trophies).toBe(source.trophies);

    // The point of the snapshot is that these are NUMBERS to difference later
    // (T3B.3). Deriving the expectation from the source would also pass if every
    // one of them were undefined on both sides, which is the failure that would
    // make a season total silently zero.
    expect(typeof snap.donations).toBe("number");
    expect(typeof snap.trophies).toBe("number");
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
  // cwlwar.json, NOT currentwar.json. Both are real captures (T2.1), and the
  // live currentwar came back `notInWar` — which is the honest, ordinary state
  // for most of the month (R10) and therefore carries no roster, no attacks and
  // no timestamps to map. cwlwar is a finished 15-member war with one member who
  // never attacked, so it exercises every branch this mapper has.
  //
  // The distinction is the point: notInWar is asserted below as its own case,
  // rather than being the accidental subject of every case.
  const api = warSchema.parse(fixture("cwlwar.json"));
  const war = mapWar(api);

  // 045 — the opponent's badge, which the board draws beside its name. Medium
  // first, the size the board uses; the API also sends small and large.
  it("keeps each side's badge, medium size first", () => {
    expect(war.opponent!.badgeUrl).toBe(api.opponent!.badgeUrls!.medium);
    expect(war.clan!.badgeUrl).toBe(api.clan!.badgeUrls!.medium);
  });

  it("falls back to the small badge, and to nothing", () => {
    const small = mapWar(
      warSchema.parse({
        state: "inWar",
        clan: { tag: "#2PP", badgeUrls: { small: "s.png" }, members: [] },
        opponent: { tag: "#8QU", members: [] },
      }),
    );
    expect(small.clan!.badgeUrl).toBe("s.png");
    expect(small.opponent!.badgeUrl).toBeUndefined();
  });

  it("parses Supercell timestamps into real Dates", () => {
    expect(war.startTime).toBeInstanceOf(Date);
    expect(war.endTime).toBeInstanceOf(Date);
    // 20260805T040314.000Z is not a format new Date() understands — it returns
    // Invalid Date silently. That is what lib/coc-time.ts exists to prevent.
    expect(Number.isNaN(war.endTime!.getTime())).toBe(false);
    expect(war.endTime!.getTime()).toBeGreaterThan(war.startTime!.getTime());
  });

  // The API OMITS `attacks` for a player who did not attack. Normalised to []
  // here so callers can iterate — but the missed list is still DERIVED from
  // roster minus attacks (T4.3), never stored as zero-star rows.
  it("normalises an absent attacks field to an empty array", () => {
    const members = war.clan!.members;

    // Positions are not hardcoded: which member skipped their attack is a fact
    // about the captured war, not about the mapper.
    const absentInApi = api.clan!.members!.filter((m) => m.attacks === undefined);
    expect(absentInApi.length).toBeGreaterThan(0);

    for (const source of absentInApi) {
      const mapped = members.find((m) => m.tag === normaliseTag(source.tag))!;
      expect(mapped.attacks).toEqual([]);
    }
    expect(members.some((m) => m.attacks.length > 0)).toBe(true);
  });

  it("still lets missed attacks be derived from roster minus attacks", () => {
    const missed = war.clan!.members.filter((m) => m.attacks.length === 0);
    const expected = api
      .clan!.members!.filter((m) => m.attacks === undefined)
      .map((m) => normaliseTag(m.tag));

    expect(missed.map((m) => m.tag).sort()).toEqual(expected.sort());
  });

  it("renames destructionPercentage and attacker/defender tags", () => {
    const attacker = war.clan!.members.find((m) => m.attacks.length > 0)!;
    const attack = attacker.attacks[0]!;
    expect(typeof attack.destruction).toBe("number");
    expect(attack).not.toHaveProperty("destructionPercentage");
    expect(attack.attackerTag).toMatch(/^#/);
  });

  // townhallLevel on war endpoints, townHallLevel on the clan endpoint. Absorbed
  // here so nothing above has to remember which is which.
  it("absorbs the townhallLevel casing difference", () => {
    const source = api.clan!.members![0]!;
    expect(war.clan!.members[0]!.thLevel).toBe(source.townhallLevel);
    expect(war.clan!.members[0]).not.toHaveProperty("townhallLevel");
  });

  // The captured currentwar.json. Three weeks of every month this is what the
  // endpoint returns, so it is worth asserting against the real one rather than
  // only against a hand-built `{ state: "notInWar" }`.
  it("handles the real captured currentwar, which came back notInWar", () => {
    const idle = mapWar(warSchema.parse(fixture("currentwar.json")));
    expect(idle.state).toBe("notInWar");
    expect(idle.startTime).toBeUndefined();
    expect(idle.endTime).toBeUndefined();
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
  const api = cwlGroupSchema.parse(fixture("cwlgroup.json"));
  const group = mapCwlGroup(api);

  it("flattens rounds into a single list of war tags", () => {
    expect(group.warTags).toEqual(
      api.rounds
        .flatMap((r) => r.warTags)
        .filter((t) => t && t !== "#0")
        .map((t) => normaliseTag(t)),
    );
    expect(group.warTags.length).toBeGreaterThan(0);
  });

  // '#0' means a round that has not started. Fetching one is a guaranteed 404,
  // so it is filtered here rather than in every caller.
  it("filters out the #0 placeholder rounds", () => {
    expect(group.warTags).not.toContain("#0");
  });

  // 057 — the registered rosters and their Town Halls, which the sync used to
  // parse and then drop.
  it("keeps every clan's roster with its Town Hall levels", () => {
    expect(group.rosters.map((r) => r.clanTag)).toEqual(group.clanTags);
    const first = api.clans[0]!.members[0]!;
    expect(group.rosters[0]!.members[0]).toEqual({
      tag: normaliseTag(first.tag),
      name: first.name,
      thLevel: first.townHallLevel,
    });
    expect(group.rosters.every((r) => r.members.every((m) => typeof m.thLevel === "number"))).toBe(true);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // THE BUG T2.1 CAUGHT. Worth stating in full, because the whole reason this
  // project captures real fixtures is to find exactly this class of defect.
  //
  // The synthetic fixture said "2026-07". The live API returned "2026-08-03" —
  // a full date. `season` is the natural key of cwl_seasons AND of the leader's
  // cwl_rosters, so the two would have stopped matching: T4B.6's "one roster per
  // season across all three clans" constraint would have silently matched
  // nothing, and every season lookup would have returned null.
  //
  // Nothing would have thrown. The schema is a bare z.string(), so the capture's
  // validation gate passed it, and the wrong shape reached the database intact.
  // ───────────────────────────────────────────────────────────────────────────
  it("reduces the season to the 'YYYY-MM' key the rest of the project uses", () => {
    expect(group.season).toMatch(/^\d{4}-\d{2}$/);
    expect(group.season).toBe(api.season.slice(0, 7));
  });

  it("truncates a full date, which is what the live API actually sends", () => {
    expect(normaliseCwlSeason("2026-08-03")).toBe("2026-08");
  });

  it("leaves an already-correct 'YYYY-MM' untouched", () => {
    expect(normaliseCwlSeason("2026-07")).toBe("2026-07");
  });

  // Mangling an unrecognised shape into a plausible-looking month is worse than
  // passing it through: a visibly odd season key can be found, a silently wrong
  // one cannot.
  it("passes an unrecognised shape through rather than guessing", () => {
    expect(normaliseCwlSeason("whatever")).toBe("whatever");
    expect(normaliseCwlSeason("")).toBe("");
  });
});

describe("mapRaidSeasons", () => {
  const api = raidSeasonsSchema.parse(fixture("capitalraids.json"));
  const seasons = mapRaidSeasons(api);

  it("parses the season window into Dates", () => {
    expect(seasons[0]!.startTime).toBeInstanceOf(Date);
    expect(seasons[0]!.endTime).toBeInstanceOf(Date);
  });

  it("renames capitalResourcesLooted to loot", () => {
    expect(seasons[0]!.participants[0]!.loot).toBe(
      api.items[0]!.members![0]!.capitalResourcesLooted,
    );
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

  // 027. Each of these was on the response and was being dropped — the same
  // shape of loss 019, 020 and 026 each had to add a table to correct.
  it("carries the season detail 027 added columns for", () => {
    const source = api.items[0]!;
    expect(seasons[0]!.state).toBe(source.state);
    expect(seasons[0]!.raidsCompleted).toBe(source.raidsCompleted);
    expect(seasons[0]!.totalAttacks).toBe(source.totalAttacks);
    expect(seasons[0]!.offensiveReward).toBe(source.offensiveReward);
    expect(seasons[0]!.defensiveReward).toBe(source.defensiveReward);

    // Deriving from the source would also pass if the mapper dropped all five
    // and both sides read undefined — which is the exact bug 019, 020, 026 and
    // 027 each were. Assert they actually arrived.
    for (const value of [
      seasons[0]!.state,
      seasons[0]!.raidsCompleted,
      seasons[0]!.totalAttacks,
    ]) {
      expect(value).toBeDefined();
    }
  });

  // The denominator. attacksUsed alone cannot answer "did they do what was
  // asked", and the limit varies per member so it cannot be a constant.
  it("carries each member's attack limit, not just their attacks used", () => {
    const source = api.items[0]!.members![0]!;
    const first = seasons[0]!.participants[0]!;
    expect(first.attacksUsed).toBe(source.attacks);
    expect(first.attackLimit).toBe(source.attackLimit);
    expect(first.bonusAttackLimit).toBe(source.bonusAttackLimit);

    // The denominator has to be a number for "did they do what was asked" to
    // mean anything (T7.3).
    expect(typeof first.attackLimit).toBe("number");
  });

  it("leaves the new fields undefined when the API omits them", () => {
    const bare = mapRaidSeasons(
      raidSeasonsSchema.parse({
        items: [
          {
            startTime: "20260725T070000.000Z",
            endTime: "20260728T070000.000Z",
            members: [{ tag: "#2PP0JCCL", name: "x" }],
          },
        ],
      }),
    );
    expect(bare[0]!.offensiveReward).toBeUndefined();
    expect(bare[0]!.participants[0]!.attackLimit).toBeUndefined();
  });
});

describe("mapPlayer", () => {
  const api = playerSchema.parse(fixture("player.json"));
  const player = mapPlayer(api);

  it("maps the basics", () => {
    expect(player.tag).toMatch(/^#/);
    expect(player.warStars).toBe(api.warStars);
    expect(player.role).toBe(mapRole(api.role));
  });

  // T7.4 derives a Clan Games score by differencing this value between two
  // snapshots, because the API exposes no per-season score at all.
  it("extracts the Games Champion achievement value", () => {
    // Found by NAME in a long unordered achievements array, so the index is not
    // stable across captures and the value certainly is not.
    const achievement = api.achievements?.find((a) => a.name === "Games Champion");
    expect(achievement).toBeDefined();
    expect(player.gamesChampionValue).toBe(achievement!.value);
    expect(typeof player.gamesChampionValue).toBe("number");
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

describe("mapDonationCounters (052)", () => {
  const api = playerSchema.parse(fixture("player.json"));

  it("reads the three donation achievements and the clan counters together", () => {
    // Values from the real capture: see "completionInfo" in fixtures/player.json.
    expect(mapDonationCounters(api)).toEqual({
      tag: "#Q9LPUUYR",
      clanTag: "#LP8PYCP9",
      troopsDonated: 145220,
      spellsDonated: 3715,
      siegesDonated: 607,
      clanDonations: 0,
      clanDonationsReceived: 0,
    });
  });

  it("leaves a missing achievement undefined rather than zero", () => {
    const bare = mapDonationCounters(
      playerSchema.parse({ tag: "#2PP0JCCL", name: "x", achievements: [] }),
    );
    expect(bare.troopsDonated).toBeUndefined();
    expect(bare.spellsDonated).toBeUndefined();
    expect(bare.siegesDonated).toBeUndefined();
    expect(bare.clanTag).toBeUndefined();
  });
});

describe("playerSchema — base progress (T11B.1)", () => {
  const api = playerSchema.parse(fixture("player.json"));

  it("reads every unit list the fixture carries", () => {
    expect(api.heroes.length).toBeGreaterThan(0);
    expect(api.heroEquipment.length).toBeGreaterThan(0);
    expect(api.troops.length).toBeGreaterThan(0);
    expect(api.spells.length).toBeGreaterThan(0);
    expect(api.builderHallLevel).toBeTypeOf("number");
  });

  // The fact T11B's original plan got wrong, pinned so it cannot be re-assumed.
  // A TH17 account is not maxed at 110, so maxLevel is the game's ceiling rather
  // than this Town Hall's cap.
  it("maxLevel is the game maximum, not the Town Hall cap", () => {
    const king = api.heroes.find((h) => h.name === "Barbarian King")!;
    expect(api.townHallLevel).toBe(17);
    expect(king.maxLevel).toBeGreaterThan(king.level);
  });

  it("defaults every unit list to [] for an account that has none", () => {
    const bare = playerSchema.parse({ tag: "#2PP0JCCL", name: "x" });
    expect(bare.troops).toEqual([]);
    expect(bare.heroes).toEqual([]);
    expect(bare.heroEquipment).toEqual([]);
    expect(bare.spells).toEqual([]);
  });
});

describe("mapPlayerProgress (T11B.2)", () => {
  const api = playerSchema.parse(fixture("player.json"));
  const progress = mapPlayerProgress(api);

  it("carries the hall levels under their internal names", () => {
    expect(progress.thLevel).toBe(api.townHallLevel);
    expect(progress.thWeaponLevel).toBe(api.townHallWeaponLevel);
    expect(progress.bhLevel).toBe(api.builderHallLevel);
    expect(progress.tag).toMatch(/^#/);
  });

  it("keeps every unit, one for one", () => {
    expect(progress.heroes).toHaveLength(api.heroes.length);
    expect(progress.equipment).toHaveLength(api.heroEquipment.length);
    expect(progress.troops).toHaveLength(api.troops.length);
    expect(progress.spells).toHaveLength(api.spells.length);
  });

  it("maps builderBase to builder and everything else to home", () => {
    const machine = progress.heroes.find((h) => h.name === "Battle Machine")!;
    const king = progress.heroes.find((h) => h.name === "Barbarian King")!;
    expect(machine.village).toBe("builder");
    expect(king.village).toBe("home");
  });

  // Baby Dragon exists in both villages. Anything keyed by name alone would
  // merge two different units.
  it("keeps same-named units in different villages apart", () => {
    const babies = progress.troops.filter((t) => t.name === "Baby Dragon");
    expect(babies.map((b) => b.village).sort()).toEqual(["builder", "home"]);
  });

  it("exposes no raw field names above the boundary (R7)", () => {
    expect(progress.heroes[0]).not.toHaveProperty("maxLevel");
    expect(progress).not.toHaveProperty("heroEquipment");
    expect(progress).not.toHaveProperty("builderHallLevel");
  });
});
