// The fixture scrubber is a privacy control, so it is tested like one.
//
// Two properties matter and they pull against each other:
//   1. no real member identity survives  — otherwise clan-mates' names and tags
//      sit in git history permanently, because fixtures/ is committed
//   2. everything else survives untouched — otherwise the schemas and mappers
//      are written against a shape that is no longer the API's

import { describe, expect, it } from "vitest";
import { createScrubber } from "../scripts/scrub-fixtures";
import { isValidTag, normaliseTag } from "../src/lib/tags";

/** Shaped like a real /clans/{tag} response, with identifiable values. */
const clanResponse = {
  tag: "#2PP0JCCL",
  name: "Real Clan Name",
  clanLevel: 18,
  warLeague: { id: 48000012, name: "Crystal League I" },
  badgeUrls: { small: "https://api-assets.clashofclans.com/badges/70/x.png" },
  members: 2,
  memberList: [
    {
      tag: "#PY0LQGRJ",
      name: "SomeRealPerson",
      role: "admin",
      townHallLevel: 15,
      trophies: 5210,
      donations: 1240,
      donationsReceived: 980,
    },
    {
      tag: "#C2V89UGL",
      name: "AnotherRealName",
      role: "member",
      townHallLevel: 14,
      trophies: 4102,
      donations: 88,
      donationsReceived: 1500,
    },
  ],
};

describe("identity is removed", () => {
  it("replaces every player name", () => {
    const out = createScrubber().scrub(clanResponse);
    const json = JSON.stringify(out);
    expect(json).not.toContain("SomeRealPerson");
    expect(json).not.toContain("AnotherRealName");
    expect(json).toContain("Player 01");
    expect(json).toContain("Player 02");
  });

  it("replaces every player tag", () => {
    const json = JSON.stringify(createScrubber().scrub(clanResponse));
    expect(json).not.toContain("PY0LQGRJ");
    expect(json).not.toContain("C2V89UGL");
  });

  it("replaces the clan tag too", () => {
    const out = createScrubber().scrub(clanResponse) as typeof clanResponse;
    expect(out.tag).not.toBe("#2PP0JCCL");
  });

  it("replaces attacker and defender tags in war data", () => {
    const war = {
      clan: {
        members: [
          {
            tag: "#PY0LQGRJ",
            name: "RealAttacker",
            townHallLevel: 15,
            attacks: [
              { attackerTag: "#PY0LQGRJ", defenderTag: "#C2V89UGL", stars: 3 },
            ],
          },
        ],
      },
    };
    const json = JSON.stringify(createScrubber().scrub(war));
    expect(json).not.toContain("PY0LQGRJ");
    expect(json).not.toContain("C2V89UGL");
    expect(json).not.toContain("RealAttacker");
  });
});

describe("everything the schemas depend on survives", () => {
  const out = createScrubber().scrub(clanResponse) as typeof clanResponse;

  it("keeps the clan name — a clan is not a person", () => {
    // Fixtures are far easier to reason about when the clan is still named.
    expect(out.name).toBe("Real Clan Name");
  });

  it("keeps league names", () => {
    expect(out.warLeague.name).toBe("Crystal League I");
  });

  it("keeps every number exactly", () => {
    expect(out.clanLevel).toBe(18);
    expect(out.memberList[0]!.townHallLevel).toBe(15);
    expect(out.memberList[0]!.trophies).toBe(5210);
    expect(out.memberList[0]!.donations).toBe(1240);
    expect(out.memberList[1]!.donationsReceived).toBe(1500);
  });

  it("keeps roles, which drive clan_roles", () => {
    expect(out.memberList[0]!.role).toBe("admin");
    expect(out.memberList[1]!.role).toBe("member");
  });

  it("keeps array lengths", () => {
    expect(out.memberList).toHaveLength(2);
  });

  it("keeps the exact set of keys at every level", () => {
    expect(Object.keys(out).sort()).toEqual(Object.keys(clanResponse).sort());
    expect(Object.keys(out.memberList[0]!).sort()).toEqual(
      Object.keys(clanResponse.memberList[0]!).sort(),
    );
  });

  it("keeps URLs", () => {
    expect(out.badgeUrls.small).toBe(clanResponse.badgeUrls.small);
  });
});

describe("replacement tags are usable", () => {
  const out = createScrubber().scrub(clanResponse) as typeof clanResponse;

  // A scrubbed tag that lib/tags.ts rejects would make every mapper throw the
  // moment it touched a fixture, which defeats the whole offline story.
  it("passes lib/tags.ts validation", () => {
    for (const member of out.memberList) {
      expect(isValidTag(member.tag), member.tag).toBe(true);
      expect(normaliseTag(member.tag)).toBe(member.tag);
    }
    expect(isValidTag(out.tag)).toBe(true);
  });

  it("satisfies the database check constraint pattern", () => {
    const pattern = /^#[0289PYLQGRJCUV]{3,12}$/;
    expect(out.tag).toMatch(pattern);
    for (const member of out.memberList) expect(member.tag).toMatch(pattern);
  });

  it("gives different players different tags", () => {
    expect(out.memberList[0]!.tag).not.toBe(out.memberList[1]!.tag);
  });
});

describe("aliases are consistent", () => {
  // clan.json and player.json are captured separately but must agree, or the
  // cross-reference between them is broken and no test can join the two.
  it("maps the same real tag to the same fake tag across files", () => {
    const scrubber = createScrubber();
    const fromClan = scrubber.scrub(clanResponse) as typeof clanResponse;
    const fromPlayer = scrubber.scrub({
      tag: "#PY0LQGRJ",
      name: "SomeRealPerson",
      townHallLevel: 15,
      donations: 1240,
    }) as { tag: string; name: string };

    expect(fromPlayer.tag).toBe(fromClan.memberList[0]!.tag);
    expect(fromPlayer.name).toBe(fromClan.memberList[0]!.name);
  });

  it("is deterministic across runs, so re-capturing gives a stable diff", () => {
    const a = JSON.stringify(createScrubber().scrub(clanResponse));
    const b = JSON.stringify(createScrubber().scrub(clanResponse));
    expect(a).toBe(b);
  });

  it("counts what it replaced", () => {
    const scrubber = createScrubber();
    scrubber.scrub(clanResponse);
    expect(scrubber.names).toBe(2);
    expect(scrubber.tags).toBe(3); // two members plus the clan
  });
});
