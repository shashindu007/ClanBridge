// The CWL rating from database rows to marks, through the real repositories
// and loaders.
//
// Every other rating test hands the service a board it built by hand, which
// proves the sums and nothing about where the numbers come from — and both
// times the rating has been wrong, the sums were right. The API's mapPosition
// was read as a base number ("#19" of 15), and a member swapped out in
// preparation was left in the lineup ("#16 of 16"). Each lived in the step
// before the service: the rows, and the code that reads them.
//
// So this seeds ONE war day the way the sync stores it, with every trap in it,
// and asks the same functions the pages call:
//
//   - API map positions with gaps, on both sides       (the #19 bug)
//   - an enemy swapped out in preparation, still a row (the #16 bug)
//   - an enemy base hit twice, read by attack order    (062, "new stars only")
//   - a missed attack, a base nobody attacked, a 3-star from below
//
// The audit (services/cwl-audit.ts) must then find nothing wrong with the day —
// and must find the swapped-out row when it is NOT taken out, or it is not an
// audit.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createHarness, type Harness } from "./pg-harness";
import { createPgliteSupabase } from "./pglite-supabase";
import { CWL_LEAGUES } from "@/data/cwl-medals";
import { loadSeasonBoards, loadSeasonView, ratingFor } from "@/lib/cwl-season";
import { seasonByName } from "@/repositories/cwl";
import { lineupsForWars } from "@/repositories/cwl-scouting";
import { auditDay } from "@/services/cwl-audit";
import { dayRating } from "@/services/cwl-rating";
import { fieldedOnly, teamSizes } from "@/services/cwl-scouting";

const CLAN = "aaaaaaaa-0000-4000-8000-000000000001";
const SEASON = "11111111-0000-4000-8000-0000000000a1";
const WAR = "22222222-0000-4000-8000-0000000000a1";
const US = "#2PP0JCCL";
const FOE = "#2QQ";
const MONTH = "2026-10";
const WAR_TAG = "#8RJQV2Q9C";

/** Our four, in the game's tag alphabet. API positions 2, 5, 9 and 30. */
const U = { one: "#PY2", two: "#PY8", three: "#PY9", four: "#PYP" };
const PLAYER = {
  one: "33333333-0000-4000-8000-000000000001",
  two: "33333333-0000-4000-8000-000000000002",
  three: "33333333-0000-4000-8000-000000000003",
  four: "33333333-0000-4000-8000-000000000004",
};

const EARLY = "2026-10-04 23:15:00+00";
const LATER = "2026-10-06 08:07:00+00";

describe("the CWL rating, from database rows to marks", () => {
  let h: Harness;
  let client: SupabaseClient;

  beforeAll(async () => {
    h = await createHarness();
    client = createPgliteSupabase(h.db);
    await h.asSuperuser();
    await h.db.exec(`
      insert into clans (id, tag, name) values ('${CLAN}', '${US}', 'Clan A');
      insert into players (id, clan_id, tag, name) values
        ('${PLAYER.one}', '${CLAN}', '${U.one}', 'One'),
        ('${PLAYER.two}', '${CLAN}', '${U.two}', 'Two'),
        ('${PLAYER.three}', '${CLAN}', '${U.three}', 'Three'),
        ('${PLAYER.four}', '${CLAN}', '${U.four}', 'Four');

      insert into cwl_seasons (id, clan_id, season, league) values
        ('${SEASON}', '${CLAN}', '${MONTH}', '${CWL_LEAGUES[0]}');
      insert into cwl_wars (id, season_id, war_tag, day_number, opponent_tag, opponent_name, team_size, state,
                            our_stars, their_stars, our_destruction, their_destruction, result, start_time, end_time)
      values ('${WAR}', '${SEASON}', '${WAR_TAG}', 1, '${FOE}', 'Rival', 4, 'warEnded',
              6, 7, 80, 85, 'lose', '2026-10-05 08:00:00+00', '2026-10-06 08:00:00+00');
      insert into cwl_group_wars (season_id, war_tag, day_number, state, team_size, clan_tag, opponent_tag,
                                  clan_stars, opponent_stars, clan_attacks, opponent_attacks)
      values ('${SEASON}', '${WAR_TAG}', 1, 'warEnded', 4, '${US}', '${FOE}', 6, 7, 3, 3);

      -- Our roster as the sync first wrote it: API positions, never base numbers.
      insert into cwl_war_members (war_id, player_id, map_position, th_level) values
        ('${WAR}', '${PLAYER.one}', 2, 18),
        ('${WAR}', '${PLAYER.two}', 5, 18),
        ('${WAR}', '${PLAYER.three}', 9, 17),
        ('${WAR}', '${PLAYER.four}', 30, 18);

      -- Our attacks. Four did not attack.
      insert into cwl_attacks (war_id, player_id, attack_order, stars, destruction, defender_tag, defender_position) values
        ('${WAR}', '${PLAYER.one}', 1, 2, 95, '#F1', 1),
        ('${WAR}', '${PLAYER.two}', 1, 3, 100, '#F1', 1),
        ('${WAR}', '${PLAYER.three}', 1, 3, 100, '#F4', 19);

      -- Both lineups, each attack inline with its order in the war.
      insert into cwl_group_war_members
        (season_id, war_tag, clan_tag, tag, name, th_level, map_position,
         attack_stars, attack_destruction, attack_defender_tag, attack_order, created_at, updated_at)
      values
        ('${SEASON}', '${WAR_TAG}', '${US}', '${U.one}',   'One',   18, 2,  2, 95,  '#F1', 1, '${EARLY}', '${LATER}'),
        ('${SEASON}', '${WAR_TAG}', '${US}', '${U.two}',   'Two',   18, 5,  3, 100, '#F1', 5, '${EARLY}', '${LATER}'),
        ('${SEASON}', '${WAR_TAG}', '${US}', '${U.three}', 'Three', 17, 9,  3, 100, '#F4', 3, '${EARLY}', '${LATER}'),
        ('${SEASON}', '${WAR_TAG}', '${US}', '${U.four}',  'Four',  18, 30, null, null, null, null, '${EARLY}', '${LATER}'),

        ('${SEASON}', '${WAR_TAG}', '${FOE}', '#F1', 'Foe one',   18, 1,  3, 100, '${U.four}', 2, '${EARLY}', '${LATER}'),
        ('${SEASON}', '${WAR_TAG}', '${FOE}', '#F2', 'Foe two',   18, 4,  null, null, null, null, '${EARLY}', '${LATER}'),
        -- Swapped out in preparation: written once, never again. Position 6
        -- puts him above their third and fourth base.
        ('${SEASON}', '${WAR_TAG}', '${FOE}', '#GHOST', 'Swapped out', 18, 6, null, null, null, null, '${EARLY}', null),
        ('${SEASON}', '${WAR_TAG}', '${FOE}', '#F3', 'Foe three', 17, 7,  1, 40,  '${U.one}', 4, '${EARLY}', '${LATER}'),
        ('${SEASON}', '${WAR_TAG}', '${FOE}', '#F4', 'Foe four',  18, 19, 3, 100, '${U.two}', 6, '${EARLY}', '${LATER}');
    `);
  });
  afterAll(async () => {
    await h?.close();
  });

  async function load() {
    const clan = { id: CLAN, tag: US };
    const season = (await seasonByName(client, CLAN, MONTH))!;
    const view = await loadSeasonView(client, clan, season, { withPlayers: true });
    const boards = await loadSeasonBoards(client, clan, view);
    return { clan, season, view, board: boards[0]!, rating: ratingFor(view, boards) };
  }

  it("numbers both sides as the war map does, without the member who was swapped out", async () => {
    const { board } = await load();
    expect(board.bases.map((b) => [b.name, b.base])).toEqual([
      ["One", 1],
      ["Two", 2],
      ["Three", 3],
      ["Four", 4],
    ]);
    // Four enemy bases, not five; their last is #4, where the ghost made it #5.
    expect(board.theirs).toEqual({ used: 3, of: 4 });
    expect(board.bases[2]!.attack?.target).toMatchObject({ tag: "#F4", base: 4, name: "Foe four", thLevel: 18 });
    expect(board.bases[1]!.attack?.target).toMatchObject({ tag: "#F1", base: 1 });
  });

  it("reads which of two attacks on one base came first from the order", async () => {
    const { board } = await load();
    // One hit their #1 first for two stars; Two's three stars found two taken.
    expect(board.bases.map((b) => b.attack?.alreadyTaken)).toEqual([0, 2, 0, undefined]);
  });

  it("attaches each enemy attack to the base it hit", async () => {
    const { board } = await load();
    expect(board.bases.map((b) => b.defences.map((d) => [d.stars, d.by.base]))).toEqual([
      [[1, 3]],
      [[3, 4]],
      [],
      [[3, 1]],
    ]);
  });

  it("rates the day: every line, every mark, every share", async () => {
    const { rating } = await load();
    expect(rating.days).toEqual([{ dayNumber: 1, status: "counted", total: 32.9, orderMissing: false }]);

    const day = new Map(rating.players.map((p) => [p.name, p.days[0]!]));
    expect(day.get("One")).toMatchObject({
      attack: [
        { label: "2 stars", marks: 1 },
        { label: "90% or more", marks: 1 },
        { label: "Mirror", marks: 1 },
        { label: "Same TH", marks: 1 },
      ],
      defence: [
        { label: "Held to 1 star", marks: 5 },
        { label: "Heroic defence", marks: 5 },
      ],
      marks: 14,
    });
    expect(day.get("Two")).toMatchObject({
      attack: [
        { label: "3 stars, 2 already taken", marks: 3 },
        { label: "1 base up", marks: 1 },
        { label: "Their #1 of 4", marks: 1.9 },
        { label: "Same TH", marks: 1 },
      ],
      defence: [
        { label: "3-starred", marks: 0 },
        { label: "By their #4, a lower base", marks: -2 },
      ],
      marks: 4.9,
    });
    expect(day.get("Three")).toMatchObject({
      attack: [
        { label: "3 stars", marks: 5 },
        { label: "1 base below", marks: -1 },
        { label: "Their #4 of 4", marks: 1 },
        { label: "1 TH up", marks: 3 },
        { label: "Heroic attack", marks: 4 },
      ],
      defence: [{ label: "Not attacked", marks: 2 }],
      marks: 14,
    });
    expect(day.get("Four")).toMatchObject({
      attack: [{ label: "Did not attack", marks: -10 }],
      defence: [{ label: "3-starred", marks: 0 }],
      marks: -10,
    });

    // Out of the plus marks: 14 + 4.9 + 14.
    expect(day.get("One")!.share).toBeCloseTo((14 / 32.9) * 100, 6);
    expect(day.get("Four")!.share).toBeCloseTo((-10 / 32.9) * 100, 6);
    // One and Three are level on marks; One's two stars at 95% lose to Three's three at 100%.
    expect(rating.players.map((p) => p.name)).toEqual(["Three", "One", "Two", "Four"]);
  });

  it("passes its own audit", async () => {
    const { clan, season, view, board } = await load();
    const war = view.wars[0]!;
    const lineup = fieldedOnly(await lineupsForWars(client, season.id, [war.warTag]), teamSizes(view.wars));
    expect(
      auditDay({
        war,
        roster: view.warData[0]!.apiRoster,
        attacks: view.warData[0]!.attacks,
        lineup,
        ourTag: clan.tag,
        board,
        rated: dayRating(board, war.state, !view.running),
      }),
    ).toEqual([]);
  });

  it("is caught by the audit when the swapped-out member is left in", async () => {
    const { clan, season, view, board } = await load();
    const war = view.wars[0]!;
    const recorded = await lineupsForWars(client, season.id, [war.warTag]);
    expect(recorded.filter((m) => m.clanTag === FOE)).toHaveLength(5);
    const issues = auditDay({
      war,
      roster: view.warData[0]!.apiRoster,
      attacks: view.warData[0]!.attacks,
      lineup: recorded,
      ourTag: clan.tag,
      board,
      rated: dayRating(board, war.state, !view.running),
    });
    expect(issues).toContain("the enemy lineup has 5 rows, not 4");
  });
});
