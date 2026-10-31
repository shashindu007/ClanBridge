// A failed read is not an empty result.
//
// Each of these used to hand back null or [], and the page then said something
// false about the member: "Finish your account", "You are not in a clan yet",
// "No raid weekends recorded", every attack unused.

import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { accountProfile, clanRoles } from "@/lib/auth";
import { assertRead } from "@/lib/errors";
import { gamesBySeason } from "@/repositories/clan-games";
import { groupForSeason } from "@/repositories/cwl";
import { lineupsForWars } from "@/repositories/cwl-scouting";
import { familyRatings, ratingMonths } from "@/repositories/player-ratings";
import { donationSegments } from "@/repositories/season-donations";
import { attacksForWar, warRostersFor } from "@/repositories/war";

/** A client on which every query resolves the same way, however it is chained. */
function clientAnswering(result: { data: unknown; error: unknown }): SupabaseClient {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "in", "is", "order", "limit", "range"]) {
    chain[method] = () => chain;
  }
  chain.then = (resolve: (value: unknown) => void) => resolve(result);
  return { from: () => chain, rpc: () => chain } as unknown as SupabaseClient;
}

const failing = clientAnswering({ data: null, error: { message: "connection refused" } });
const empty = clientAnswering({ data: [], error: null });

describe("assertRead", () => {
  it("throws on a failure and names what was being read", () => {
    expect(() => assertRead({ message: "connection refused" }, "wars")).toThrow(
      /wars could not be read: connection refused/,
    );
  });

  it("lets a successful read through", () => {
    expect(() => assertRead(null, "wars")).not.toThrow();
  });
});

describe("identity reads", () => {
  it("do not turn a database failure into a missing account", async () => {
    await expect(accountProfile(failing, "user-1")).rejects.toThrow(/could not be read/);
  });

  it("still report an account that really has no row", async () => {
    await expect(accountProfile(empty, "user-2")).resolves.toBeNull();
  });

  it("do not turn a database failure into having no clans", async () => {
    await expect(clanRoles(failing, "user-3")).rejects.toThrow(/could not be read/);
  });
});

describe("war reads", () => {
  it("do not turn a database failure into nobody having attacked", async () => {
    await expect(attacksForWar(failing, "war-1")).rejects.toThrow(/could not be read/);
    await expect(warRostersFor(failing, ["war-1"])).rejects.toThrow(/could not be read/);
  });

  it("still report a war with no attacks yet", async () => {
    await expect(attacksForWar(empty, "war-2")).resolves.toEqual([]);
  });
});

// The Player rating stores what these return, so a blip here would not go away
// on the next page load: it would be a wrong number for up to six hours, and for
// good on a month's last run.
describe("the reads behind the Player rating", () => {
  it("do not turn a database failure into nobody having donated", async () => {
    await expect(donationSegments(failing, ["clan-1"], new Date())).rejects.toThrow(/could not be read/);
  });

  it("do not turn a database failure into no Clan Games", async () => {
    await expect(gamesBySeason(failing, "clan-1", "2026-10")).rejects.toThrow(/could not be read/);
  });

  it("do not turn a database failure into an enemy who never attacked", async () => {
    await expect(lineupsForWars(failing, "season-1", ["#WAR"])).rejects.toThrow(/could not be read/);
  });

  it("do not turn a database failure into an empty CWL group", async () => {
    await expect(groupForSeason(failing, "season-1")).rejects.toThrow(/could not be read/);
  });

  it("do not turn a database failure into an empty ranking", async () => {
    await expect(ratingMonths(failing)).rejects.toThrow(/could not be read/);
    await expect(familyRatings(failing, "2026-10")).rejects.toThrow(/could not be read/);
  });

  it("still report a clan with nothing recorded", async () => {
    await expect(donationSegments(empty, ["clan-2"], new Date())).resolves.toEqual([]);
    await expect(gamesBySeason(empty, "clan-2", "2026-10")).resolves.toBeNull();
    await expect(ratingMonths(empty)).resolves.toEqual([]);
  });
});
