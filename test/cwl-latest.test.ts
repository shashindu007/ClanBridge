// lib/cwl-latest.ts — the month CWL rating and the results image both show.
//
// The newest month any of the clans has is the one, and only the clans that
// played it come back, in the order given, each with its group table: a clan
// whose last CWL was the month before must not drag its old season into the
// image beside this month's.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createHarness, type Harness } from "./pg-harness";
import { createPgliteSupabase } from "./pglite-supabase";
import type { VisibleClan } from "@/lib/clans";
import { latestCwlMonth } from "@/lib/cwl-latest";

const A = { id: "aaaaaaaa-0000-4000-8000-0000000000c1", tag: "#2PP0JCCL", name: "Clan A" };
const B = { id: "aaaaaaaa-0000-4000-8000-0000000000c2", tag: "#2PP0JCCQ", name: "Clan B" };
const C = { id: "aaaaaaaa-0000-4000-8000-0000000000c3", tag: "#2PP0JCCG", name: "Clan C" };
const D = { id: "aaaaaaaa-0000-4000-8000-0000000000c4", tag: "#2PP0JCCR", name: "Clan D" };

const SEASON = {
  aOld: "11111111-0000-4000-8000-0000000000c1",
  aNow: "11111111-0000-4000-8000-0000000000c2",
  bNow: "11111111-0000-4000-8000-0000000000c3",
  cOld: "11111111-0000-4000-8000-0000000000c4",
};

const visible = (clan: typeof A): VisibleClan => ({ ...clan, badgeUrl: null, role: "leader" });

describe("latestCwlMonth", () => {
  let h: Harness;
  let client: SupabaseClient;

  beforeAll(async () => {
    h = await createHarness();
    client = createPgliteSupabase(h.db);
    await h.asSuperuser();
    await h.db.exec(`
      insert into clans (id, tag, name) values
        ('${A.id}', '${A.tag}', '${A.name}'),
        ('${B.id}', '${B.tag}', '${B.name}'),
        ('${C.id}', '${C.tag}', '${C.name}'),
        ('${D.id}', '${D.tag}', '${D.name}');

      insert into cwl_seasons (id, clan_id, season) values
        ('${SEASON.aOld}', '${A.id}', '2026-09'),
        ('${SEASON.aNow}', '${A.id}', '2026-10'),
        ('${SEASON.bNow}', '${B.id}', '2026-10'),
        ('${SEASON.cOld}', '${C.id}', '2026-09');

      -- Clan A's group this month: two clans, one finished war that A won.
      insert into cwl_group_clans (season_id, clan_tag, name) values
        ('${SEASON.aNow}', '${A.tag}', '${A.name}'),
        ('${SEASON.aNow}', '#2QQ', 'Rival');
      insert into cwl_group_wars (season_id, war_tag, day_number, state, team_size, clan_tag, opponent_tag,
                                  clan_stars, opponent_stars, clan_destruction, opponent_destruction)
      values ('${SEASON.aNow}', '#8RJQV2Q9C', 1, 'warEnded', 15, '#2QQ', '${A.tag}', 30, 40, 70, 90);
    `);
  });
  afterAll(async () => {
    await h?.close();
  });

  it("picks the newest month and only the clans that played it, in the order given", async () => {
    const latest = await latestCwlMonth(client, [B, C, A].map(visible));
    expect(latest?.month).toBe("2026-10");
    expect(latest?.entries.map((e) => e.clan.name)).toEqual(["Clan B", "Clan A"]);
    for (const entry of latest!.entries) expect(entry.view.season.season).toBe("2026-10");
  });

  it("hands each clan its own group table", async () => {
    const latest = await latestCwlMonth(client, [A, B].map(visible));
    const a = latest!.entries.find((e) => e.clan.id === A.id)!;
    expect(a.view.standings.map((s) => [s.rank, s.name, s.stars, s.isUs])).toEqual([
      [1, "Clan A", 50, true],
      [2, "Rival", 30, false],
    ]);
    expect(a.view.us?.rank).toBe(1);

    const b = latest!.entries.find((e) => e.clan.id === B.id)!;
    expect(b.view.standings).toEqual([]);
    expect(b.view.us).toBeNull();
    expect(b.rating.started).toBe(false);
  });

  it("is null when none of the clans has a season", async () => {
    expect(await latestCwlMonth(client, [visible(D)])).toBeNull();
    expect(await latestCwlMonth(client, [])).toBeNull();
  });
});
