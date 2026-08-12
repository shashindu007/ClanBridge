// T7.3 — the raid derivations, as pure functions.
//
// One rule dominates this file, and it is the third time the project has met it:
//
//   A RAID WEEKEND DOES NOT GIVE EVERYONE THE SAME NUMBER OF ATTACKS.
//
// CWL uses a boolean `missed`, which is right there — one attack per war, so
// used-or-not is the whole story. T6.9 found that boolean wrong for a regular
// war, where two attacks mean fifteen members each leaving one unused is a
// roster's worth of attacks a boolean reports as fine. Raids are the general
// case: the limit varies BETWEEN MEMBERS of the same clan on the same weekend,
// because the bonus attack is awarded to some and not others.
//
// So the cases below are mostly about the denominator, and about the one thing
// worse than not knowing it — pretending to.

import { describe, expect, it } from "vitest";
import type { RaidParticipantRow, RaidSeasonRow } from "@/repositories/raids";
import {
  attacksOffered,
  attacksOwed,
  historyTotals,
  isOngoing,
  outstandingRaidAttacks,
  playerRaidSummary,
  raidRecord,
  seasonTotals,
} from "@/services/raids";

function season(over: Partial<RaidSeasonRow> = {}): RaidSeasonRow {
  return {
    id: "s1",
    startTime: "2026-07-25T07:00:00Z",
    endTime: "2026-07-28T07:00:00Z",
    totalLoot: 100_000,
    state: "ended",
    raidsCompleted: 4,
    totalAttacks: 42,
    offensiveReward: 180,
    defensiveReward: 95,
    ...over,
  };
}

function member(
  id: string,
  over: Partial<RaidParticipantRow> = {},
): RaidParticipantRow {
  return {
    playerId: id,
    tag: `#${id.toUpperCase()}`,
    name: `Player ${id}`,
    attacksUsed: 6,
    attackLimit: 5,
    bonusAttackLimit: 1,
    loot: 24_000,
    ...over,
  };
}

describe("services/raids", () => {
  describe("attacksOffered — base plus bonus", () => {
    it("adds the bonus attack to the base limit", () => {
      expect(attacksOffered(member("a"))).toBe(6);
    });

    it("handles a member who was offered no bonus", () => {
      expect(attacksOffered(member("a", { bonusAttackLimit: 0 }))).toBe(5);
      expect(attacksOffered(member("a", { bonusAttackLimit: null }))).toBe(5);
    });

    // THE CASE THIS FUNCTION EXISTS FOR. Rows written before migration 027 have
    // no limit at all. Defaulting to 6 — or to attacksUsed, which would make
    // everyone look complete — invents a denominator, and every number derived
    // from it then reads as fact. A dash is honest; a wrong "5 of 6" is not.
    it("returns null rather than guessing when the limit is unknown", () => {
      expect(attacksOffered(member("a", { attackLimit: null }))).toBeNull();
    });
  });

  describe("attacksOwed", () => {
    it("counts what was left unspent", () => {
      expect(attacksOwed(member("a", { attacksUsed: 4 }))).toBe(2);
    });

    it("is zero for a member who used everything", () => {
      expect(attacksOwed(member("a", { attacksUsed: 6 }))).toBe(0);
    });

    // 5 of 5 and 5 of 6 are different answers to "did they do what was asked",
    // and a report that shows both as "5" says they are the same person.
    it("distinguishes 5-of-5 from 5-of-6", () => {
      const complete = member("a", { attacksUsed: 5, attackLimit: 5, bonusAttackLimit: 0 });
      const short = member("b", { attacksUsed: 5, attackLimit: 5, bonusAttackLimit: 1 });

      expect(attacksOwed(complete)).toBe(0);
      expect(attacksOwed(short)).toBe(1);
    });

    it("is null when the offer is unknown, never zero", () => {
      // Zero would read as "they used everything", which is an acquittal the
      // data does not support — the same reason followedTarget is null and
      // never false when it cannot be determined (T6.5).
      expect(attacksOwed(member("a", { attackLimit: null }))).toBeNull();
    });

    it("is null when the attacks used are unknown", () => {
      expect(attacksOwed(member("a", { attacksUsed: null }))).toBeNull();
    });

    // Clamped, like warRecord's. A negative debt is a data problem, and
    // "-1 owed" sends the reader looking for a bug in the wrong place.
    it("clamps at zero rather than reporting a negative debt", () => {
      expect(attacksOwed(member("a", { attacksUsed: 9 }))).toBe(0);
    });
  });

  describe("raidRecord", () => {
    it("puts the people who owe most first", () => {
      const record = raidRecord([
        member("a", { attacksUsed: 6 }),
        member("b", { attacksUsed: 0 }),
        member("c", { attacksUsed: 4 }),
      ]);
      expect(record.map((r) => r.playerId)).toEqual(["b", "c", "a"]);
    });

    // Unknown is not an accusation and must not lead a list that reads as one.
    it("sorts unknown denominators last, not first", () => {
      const record = raidRecord([
        member("unknown", { attackLimit: null }),
        member("owes", { attacksUsed: 3 }),
        member("done", { attacksUsed: 6 }),
      ]);
      expect(record[0]!.playerId).toBe("owes");
      expect(record.at(-1)!.playerId).toBe("unknown");
    });

    it("flags a member who took no attack at all", () => {
      const record = raidRecord([member("a", { attacksUsed: 0 })]);
      expect(record[0]!.satOut).toBe(true);
    });

    it("does not flag someone as sitting out when the offer is unknown", () => {
      const record = raidRecord([member("a", { attacksUsed: 0, attackLimit: null })]);
      expect(record[0]!.satOut).toBe(false);
    });

    it("breaks ties on loot, then on name", () => {
      const record = raidRecord([
        member("b", { attacksUsed: 6, loot: 100, name: "Bea" }),
        member("a", { attacksUsed: 6, loot: 900, name: "Ann" }),
      ]);
      expect(record.map((r) => r.playerId)).toEqual(["a", "b"]);
    });
  });

  describe("outstandingRaidAttacks — the chase list", () => {
    it("lists only the people with attacks left", () => {
      const record = raidRecord([
        member("a", { attacksUsed: 6 }),
        member("b", { attacksUsed: 2 }),
      ]);
      expect(outstandingRaidAttacks(record).map((r) => r.playerId)).toEqual(["b"]);
    });

    // An unknown denominator is not evidence of anything, and putting someone
    // on a chase list on that basis is an accusation the data cannot support.
    it("leaves out members whose limit is unknown", () => {
      const record = raidRecord([member("a", { attacksUsed: 0, attackLimit: null })]);
      expect(outstandingRaidAttacks(record)).toHaveLength(0);
    });
  });

  describe("seasonTotals", () => {
    it("sums attacks used and offered across the weekend", () => {
      const totals = seasonTotals(season(), [
        member("a", { attacksUsed: 6 }),
        member("b", { attacksUsed: 4 }),
      ]);
      expect(totals.attacksUsed).toBe(10);
      expect(totals.attacksOffered).toBe(12);
      expect(totals.unknownLimits).toBe(0);
    });

    // A denominator that silently omits rows reads as a complete total and is
    // not one. The page has to be able to say "10 of 12, and 1 we cannot judge"
    // rather than implying 10 of 12 was everybody.
    it("reports how many members it could not judge, and leaves them out", () => {
      const totals = seasonTotals(season(), [
        member("a", { attacksUsed: 6 }),
        member("b", { attacksUsed: 3, attackLimit: null }),
      ]);
      expect(totals.attacksUsed).toBe(9); // their attacks still count
      expect(totals.attacksOffered).toBe(6); // but not toward the denominator
      expect(totals.unknownLimits).toBe(1);
    });

    it("carries the medals and loot from the season row", () => {
      const totals = seasonTotals(season(), []);
      expect(totals.offensiveReward).toBe(180);
      expect(totals.totalLoot).toBe(100_000);
    });

    it("survives a season with every number missing", () => {
      const totals = seasonTotals(
        season({ totalLoot: null, offensiveReward: null }),
        [],
      );
      expect(totals).toMatchObject({ totalLoot: 0, offensiveReward: 0, attacksUsed: 0 });
    });
  });

  describe("historyTotals", () => {
    it("sums across weekends", () => {
      const totals = historyTotals([
        season({ id: "s1", offensiveReward: 180, totalLoot: 100, totalAttacks: 42 }),
        season({ id: "s2", offensiveReward: 120, totalLoot: 50, totalAttacks: 30 }),
      ]);
      expect(totals).toEqual({
        weekends: 2,
        offensiveReward: 300,
        totalLoot: 150,
        attacks: 72,
      });
    });

    it("is all zeroes for a clan with no history", () => {
      expect(historyTotals([])).toEqual({
        weekends: 0,
        totalLoot: 0,
        offensiveReward: 0,
        attacks: 0,
      });
    });
  });

  describe("playerRaidSummary", () => {
    // The gap is the entire point. Counting only the weekends a member appears
    // in makes someone who raided once in ten look identical to someone who
    // raided once and joined last week — the same distinction T4B.11 keeps
    // between selected-and-absent and never-selected.
    it("counts weekends they sat out, not just the ones they raided", () => {
      const summary = playerRaidSummary([
        { season: season({ id: "s1" }), participation: member("a", { attacksUsed: 6 }) },
        { season: season({ id: "s2" }), participation: null },
        { season: season({ id: "s3" }), participation: null },
      ]);

      expect(summary.weekendsAvailable).toBe(3);
      expect(summary.weekendsRaided).toBe(1);
    });

    // A row with zero attacks is not participation. The sync writes one for
    // anyone the API listed, and counting it would credit a member for a
    // weekend they were present at and did nothing in.
    it("does not count a weekend where they took no attack", () => {
      const summary = playerRaidSummary([
        { season: season({ id: "s1" }), participation: member("a", { attacksUsed: 0 }) },
      ]);

      expect(summary.weekendsAvailable).toBe(1);
      expect(summary.weekendsRaided).toBe(0);
    });

    it("sums attacks and loot", () => {
      const summary = playerRaidSummary([
        { season: season({ id: "s1" }), participation: member("a", { attacksUsed: 6, loot: 100 }) },
        { season: season({ id: "s2" }), participation: member("a", { attacksUsed: 4, loot: 50 }) },
      ]);

      expect(summary.attacksUsed).toBe(10);
      expect(summary.totalLoot).toBe(150);
    });

    it("is empty for a clan with no weekends at all", () => {
      expect(playerRaidSummary([])).toEqual({
        weekendsAvailable: 0,
        weekendsRaided: 0,
        attacksUsed: 0,
        totalLoot: 0,
      });
    });
  });

  describe("isOngoing", () => {
    it("is true only for the API's own word", () => {
      expect(isOngoing(season({ state: "ongoing" }))).toBe(true);
      expect(isOngoing(season({ state: "ended" }))).toBe(false);
      // Unlabelled reads as finished — the safe direction, since a wrongly
      // frozen row is corrected by the next run and a wrongly live one can be
      // overwritten forever. scripts/sync/raids.ts argues it in full.
      expect(isOngoing(season({ state: null }))).toBe(false);
    });
  });
});
