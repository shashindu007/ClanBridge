// QA the CWL rating against the real database. Read-only.
//
//   npm run cwl:audit              the current month
//   npm run cwl:audit -- 2026-10   a month by name
//
// For every clan's season of that month it loads the days exactly as the pages
// do (loadSeasonView → loadSeasonBoards → the rating) and runs
// services/cwl-audit.ts over each: lineups the right size, every attack
// agreeing with its lineup row, every target found, the stars adding up to the
// war's own score, the shares adding up to 100.
//
// Prints a line per day and every issue it finds, and exits 1 if there is any —
// so it can be run by hand during CWL week, or wired into a check.
//
// It reads with the service key because it has no session to read as; it runs
// nothing but selects, through the same repositories the app uses.

import { createClient } from "@supabase/supabase-js";
import { loadSeasonBoards, loadSeasonView } from "@/lib/cwl-season";
import { seasonByName } from "@/repositories/cwl";
import { lineupsForWars } from "@/repositories/cwl-scouting";
import { auditDay } from "@/services/cwl-audit";
import { dayRating, signed } from "@/services/cwl-rating";
import { fieldedOnly, teamSizes } from "@/services/cwl-scouting";

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_KEY;

async function main(): Promise<number> {
  if (!url || !key) {
    console.error("SUPABASE_URL and SUPABASE_SERVICE_KEY are needed (.env.local).");
    return 2;
  }
  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const month = process.argv[2] ?? new Date().toISOString().slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(month)) {
    console.error(`"${month}" is not a month — use YYYY-MM.`);
    return 2;
  }

  const { data: clans, error } = await supabase.from("clans").select("id, tag, name").order("tag");
  if (error) {
    console.error(`clans could not be read: ${error.message}`);
    return 2;
  }

  let days = 0;
  let seasons = 0;
  const issues: string[] = [];

  for (const clan of (clans ?? []) as Array<{ id: string; tag: string; name: string }>) {
    const season = await seasonByName(supabase, clan.id, month);
    if (!season) continue;
    seasons += 1;

    const view = await loadSeasonView(supabase, clan, season, { withPlayers: true });
    const boards = await loadSeasonBoards(supabase, clan, view);
    const recorded = await lineupsForWars(supabase, season.id, view.wars.map((w) => w.warTag));
    const lineups = fieldedOnly(recorded, teamSizes(view.wars));
    const swappedOut = recorded.length - lineups.length;

    console.log(`\n${clan.name} · CWL ${month}${swappedOut ? ` · ${swappedOut} swapped-out lineup rows set aside` : ""}`);

    view.wars.forEach((war, index) => {
      const board = boards[index]!;
      const rated = dayRating(board, war.state, !view.running);
      const found = auditDay({
        war,
        roster: view.warData[index]?.apiRoster ?? [],
        attacks: view.warData[index]?.attacks ?? [],
        lineup: lineups.filter((m) => m.warTag === war.warTag),
        ourTag: clan.tag,
        board,
        rated,
      });
      days += 1;
      const summary =
        rated.status === "counted" || rated.status === "provisional"
          ? `${board.ours.used}/${board.ours.of} attacks, ${board.theirs.used ?? "?"}/${board.theirs.of ?? "?"} against, plus marks ${signed(rated.total)}`
          : rated.status === "notRated"
            ? "not rated — no enemy lineup recorded"
            : "not started";
      console.log(`  day ${war.dayNumber ?? "?"}  ${(war.state ?? "no state").padEnd(11)}  ${found.length ? "ISSUES" : "ok    "}  ${summary}`);
      for (const issue of found) {
        console.log(`      - ${issue}`);
        issues.push(`${clan.name} day ${war.dayNumber ?? "?"}: ${issue}`);
      }
    });
  }

  if (seasons === 0) {
    console.log(`No CWL season recorded for ${month}.`);
    return 0;
  }
  console.log(`\n${days} war days checked, ${issues.length} issue${issues.length === 1 ? "" : "s"}.`);
  return issues.length ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error);
    process.exit(2);
  },
);
