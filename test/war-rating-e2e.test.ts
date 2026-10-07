// The war rating from database rows to marks, through the real repositories
// and the month loader — the regular-war twin of cwl-rating-e2e.test.ts, and
// for the same reason: the unit tests hand the service a board, and what has
// gone wrong before was never the sums, it was the rows and the code that reads
// them.
//
// One month, as the sync stores it:
//
//   - a war with the enemy's attacks and the order of every attack (after 063):
//     two attacks a player, a base hit by three of ours in a known order, an
//     attack that added nothing, one attack not used, a triple from below
//   - a war from BEFORE 063 in the same month: no enemy attacks and no order,
//     only the time the sync first saw each attack
//   - a war in the next month, which must not be counted in this one

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createHarness, type Harness } from "./pg-harness";
import { createPgliteSupabase } from "./pglite-supabase";
import { loadWarMonth } from "@/lib/war-rating-data";
import { warMonthsForClan } from "@/repositories/war";

const CLAN = "aaaaaaaa-0000-4000-8000-000000000001";
const OLD_WAR = "22222222-0000-4000-8000-0000000000a1";
const WAR = "22222222-0000-4000-8000-0000000000a2";
const NEXT_MONTH_WAR = "22222222-0000-4000-8000-0000000000a3";

/** Our three, in the game's tag alphabet: Town Halls 18, 18 and 17. */
const U = { one: "#PY2", two: "#PY8", three: "#PY9" };
const PLAYER = {
  one: "33333333-0000-4000-8000-000000000001",
  two: "33333333-0000-4000-8000-000000000002",
  three: "33333333-0000-4000-8000-000000000003",
};

describe("the war rating, from database rows to marks", () => {
  let h: Harness;
  let client: SupabaseClient;

  beforeAll(async () => {
    h = await createHarness();
    client = createPgliteSupabase(h.db);
    await h.asSuperuser();

    const lineups = (war: string) => `
      insert into war_members (war_id, player_id, map_position, th_level, attacks_allowed) values
        ('${war}', '${PLAYER.one}', 1, 18, 2),
        ('${war}', '${PLAYER.two}', 2, 18, 2),
        ('${war}', '${PLAYER.three}', 3, 17, 2);
      insert into war_opponent_members (war_id, tag, name, map_position, th_level) values
        ('${war}', '#F1', 'Foe one', 1, 18),
        ('${war}', '#F2', 'Foe two', 2, 18),
        ('${war}', '#F3', 'Foe three', 3, 17);
    `;

    await h.db.exec(`
      insert into clans (id, tag, name) values ('${CLAN}', '#2PP0JCCL', 'Clan A');
      insert into players (id, clan_id, tag, name) values
        ('${PLAYER.one}', '${CLAN}', '${U.one}', 'One'),
        ('${PLAYER.two}', '${CLAN}', '${U.two}', 'Two'),
        ('${PLAYER.three}', '${CLAN}', '${U.three}', 'Three');

      insert into wars (id, clan_id, opponent_tag, opponent_name, team_size, state, our_stars, their_stars,
                        result, start_time, end_time, opponent_attacks_captured_at) values
        ('${OLD_WAR}', '${CLAN}', '#2QQ', 'Old rival', 3, 'warEnded', 3, 6, 'lose',
         '2026-09-05 18:30:00+00', '2026-09-06 18:30:00+00', null),
        ('${WAR}', '${CLAN}', '#2QQ', 'Rival', 3, 'warEnded', 9, 8, 'win',
         '2026-09-10 18:30:00+00', '2026-09-11 18:30:00+00', '2026-09-11 18:00:00+00'),
        ('${NEXT_MONTH_WAR}', '${CLAN}', '#2QQ', 'Later rival', 3, 'warEnded', 0, 0, 'tie',
         '2026-10-02 18:30:00+00', '2026-10-03 18:30:00+00', '2026-10-03 18:00:00+00');

      ${lineups(OLD_WAR)}
      ${lineups(WAR)}

      -- Before 063: two of ours triple their #1. No order from the game — but
      -- the sync saw One's attack two hours before Two's.
      insert into war_attacks (war_id, player_id, attack_order, stars, destruction, defender_tag, defender_position, created_at) values
        ('${OLD_WAR}', '${PLAYER.two}', 1, 3, 100, '#F1', 1, '2026-09-05 22:00:00+00'),
        ('${OLD_WAR}', '${PLAYER.one}', 1, 3, 100, '#F1', 1, '2026-09-05 20:00:00+00');

      -- After it. Their #1 is hit by all three of ours: One takes two stars,
      -- Two finishes it, Three arrives after it is done.
      insert into war_attacks (war_id, player_id, attack_order, stars, destruction, defender_tag, defender_position, war_order) values
        ('${WAR}', '${PLAYER.one}',   1, 2, 70,  '#F1', 1, 1),
        ('${WAR}', '${PLAYER.one}',   2, 3, 100, '#F3', 3, 6),
        ('${WAR}', '${PLAYER.two}',   1, 3, 100, '#F1', 1, 4),
        ('${WAR}', '${PLAYER.two}',   2, 3, 100, '#F2', 2, 8),
        ('${WAR}', '${PLAYER.three}', 1, 3, 100, '#F1', 1, 9);

      -- What they did to us.
      insert into war_opponent_attacks (war_id, attacker_tag, attack_order, defender_tag, stars, destruction, war_order) values
        ('${WAR}', '#F1', 1, '${U.three}', 3, 100, 2),
        ('${WAR}', '#F2', 1, '${U.one}',   1, 45,  3),
        ('${WAR}', '#F3', 1, '${U.two}',   3, 100, 5),
        ('${WAR}', '#F1', 2, '${U.one}',   2, 60,  7);
    `);
  });
  afterAll(async () => {
    await h?.close();
  });

  const load = () => loadWarMonth(client, { id: CLAN }, "2026-09");

  it("finds the months a clan has wars in, newest first", async () => {
    expect(await warMonthsForClan(client, CLAN)).toEqual(["2026-10", "2026-09"]);
  });

  it("takes the wars that started in the month, oldest first, and no other", async () => {
    const { rating } = await load();
    expect(rating.wars.map((w) => [w.opponentName, w.status, w.attackOnly, w.orderMissing])).toEqual([
      ["Old rival", "counted", true, false],
      ["Rival", "counted", false, false],
    ]);
  });

  it("builds the board: two attacks a player, the order on each base, and one best attack per base", async () => {
    const { boards } = await load();
    const board = boards[1]!;
    expect(board.enemyBases).toBe(3);
    expect(board.bases.map((b) => [b.name, b.base, b.attacks.length])).toEqual([
      ["One", 1, 2],
      ["Two", 2, 2],
      ["Three", 3, 1],
    ]);
    // Their #1, by the order of the war: nothing taken, then two stars, then three.
    expect(board.bases.map((b) => b.attacks[0]!.alreadyTaken)).toEqual([0, 2, 3]);
    // …and Two, the first to three stars, has the best attack on it. Their #3
    // and #2 were each attacked once.
    expect(board.bases.map((b) => b.attacks.map((a) => a.bestOnBase))).toEqual([
      [false, true],
      [true, true],
      [false],
    ]);
    // Our #1 was hit twice; the better hit leads.
    expect(board.bases[0]!.defences.map((d) => [d.stars, d.by.base])).toEqual([
      [2, 1],
      [1, 2],
    ]);
  });

  it("rates the war: every attack's lines, the best attack on each base, and every share", async () => {
    const { rating } = await load();
    const war = new Map(rating.players.map((p) => [p.name, p.wars[1]!]));

    expect(war.get("Two")).toMatchObject({
      attacks: [
        {
          // Finishing a base a clanmate opened keeps its full marks — and is
          // the best attack on it.
          lines: [
            { label: "3 stars", marks: 5 },
            { label: "1 base up", marks: 1 },
            { label: "Mirror or above", marks: 1 },
            { label: "Their #1 of 3", marks: 1.2 },
            { label: "Same TH", marks: 1 },
            { label: "Heroic attack", marks: 4 },
          ],
          marks: 13.2,
          best: true,
          bonus: { label: "Best attack on their #1 × 1.5", marks: 6.6 },
        },
        {
          lines: [
            { label: "3 stars", marks: 5 },
            { label: "Mirror", marks: 1 },
            { label: "Their #2 of 3", marks: 1.1 },
            { label: "Same TH", marks: 1 },
          ],
          marks: 8.1,
          best: true,
          bonus: { label: "Best attack on their #2 × 1.5", marks: 4.1 },
        },
      ],
      missed: null,
      defence: [
        { label: "3-starred", marks: 0 },
        { label: "By their #3, a lower base", marks: -0.5 },
      ],
      marks: 31.5,
    });

    expect(war.get("Three")).toMatchObject({
      attacks: [
        {
          // Three stars on a base already at three: nothing new for the clan,
          // and not the best attack on it.
          lines: [
            { label: "3 stars, none new", marks: 0 },
            { label: "2 bases up, no new star", marks: 0 },
            { label: "Mirror or above", marks: 1 },
            { label: "1 TH up, no new star", marks: 0 },
          ],
          marks: 1,
          best: false,
          bonus: null,
        },
      ],
      missed: { label: "1 attack not used", marks: -4 },
      defence: [
        { label: "3-starred", marks: 0 },
        { label: "By their #1, a higher base", marks: 0.5 },
      ],
      marks: -2.5,
    });

    expect(war.get("One")).toMatchObject({
      attacks: [
        // Two stars on their #1, which Two then cleared: not the best there.
        { marks: 3, best: false, bonus: null },
        { marks: 3, best: true, bonus: { label: "Best attack on their #3 × 1.5", marks: 1.5 } },
      ],
      defence: [
        { label: "Held to 2 stars", marks: 3 },
        { label: "Heroic defence", marks: 5 },
      ],
      marks: 15.5,
    });

    // Out of the plus marks: 15.5 + 31.5.
    expect(rating.wars[1]!.total).toBe(47);
    expect(war.get("Two")!.share).toBeCloseTo((31.5 / 47) * 100, 6);
    expect(war.get("Three")!.share).toBeCloseTo((-2.5 / 47) * 100, 6);
  });

  it("rates a war from before 063 on its attacks alone, ordered by when the sync saw them", async () => {
    const { rating } = await load();
    const old = new Map(rating.players.map((p) => [p.name, p.wars[0]!]));
    // One was seen first, so One's is the best attack on their #1 and Two's added nothing.
    expect(old.get("One")!.attacks[0]).toMatchObject({
      best: true,
      marks: 12.2,
      bonus: { label: "Best attack on their #1 × 1.5", marks: 6.1 },
    });
    expect(old.get("Two")!.attacks[0]).toMatchObject({ best: false, bonus: null });
    expect(old.get("Two")!.attacks[0]!.lines[0]).toEqual({ label: "3 stars, none new", marks: 0 });
    expect([...old.values()].every((p) => p.defence.length === 0 && !p.heroicDefence)).toBe(true);
    // One: 12.2 + 6.1 − 4. Two: 1 + 1 − 4. Three: both attacks unused.
    expect([old.get("One")!.marks, old.get("Two")!.marks, old.get("Three")!.marks]).toEqual([14.3, -2, -8]);
  });

  it("adds the two wars' shares up into the month", async () => {
    const { rating } = await load();
    const two = rating.players.find((p) => p.name === "Two")!;
    expect(two.warsCounted).toBe(2);
    expect(two.rating).toBeCloseTo((-2 / 14.3) * 100 + (31.5 / 47) * 100, 6);
    expect(two.perWar).toBeCloseTo(two.rating / 2, 6);
    expect(rating.players.map((p) => p.name)).toEqual(["One", "Two", "Three"]);
  });

  it("has nothing for a month with no war", async () => {
    const view = await loadWarMonth(client, { id: CLAN }, "2026-08");
    expect(view.wars).toEqual([]);
    expect(view.rating.players).toEqual([]);
    expect(view.rating.started).toBe(false);
  });
});
