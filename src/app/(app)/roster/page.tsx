// T4B.14 — Roster history.
//
// Every season's roster, permanently. This is what the logbook was trying to be:
// the handwritten records exist for exactly one reason — so that next season
// somebody can look up what happened last season — and they lose that the moment
// a page is lost or a book is left at someone's house.
//
// Cross-clan by design, and so it lives outside [clanTag]: a CWL season is picked
// across all the clans a leader runs, and splitting the history three ways would
// recreate the merging-by-hand this replaces.
//
// ─────────────────────────────────────────────────────────────────────────────
// REDESIGNED FOR A LEADER OPENING IT FOR THE FIRST TIME
//
// It used to be a free-text box that wanted "2026-09" typed exactly, and a list of
// season codes with clan names coloured by a status nobody had been told about.
// Now it answers, in order, the three things a leader arrives wanting to know:
//
//   1. What is happening THIS month — each clan's lineup, how full it is, whether
//      members can see it, and one button to carry on picking.
//   2. How to start a season — a choice of the next two, never a typed code,
//      naming the clans it will create lineups for.
//   3. What happened before — past seasons in plain month names, with every
//      clan's status written out rather than implied by colour.
// ─────────────────────────────────────────────────────────────────────────────

import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { ArrowRight, CalendarPlus, ClipboardList, FileDown, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { EmptyState, Panel, SectionHeader, Tile } from "@/components/kit";
import { Ribbon } from "@/components/game/ribbon";
import { clanAccent } from "@/lib/clan-accent";
import { SubmitButton } from "@/components/submit-button";
import { LineupStatus, SlotMeter } from "@/components/lineup-parts";
import { currentUserId } from "@/lib/auth";
import { visibleClans, type VisibleClan } from "@/lib/clans";
import { isLeadership } from "@/lib/visibility";
import { cwlWindow } from "@/lib/coc-time";
import { lineupFocusSeason, publishedSummary, seasonLabel, startableSeasons } from "@/lib/roster-view";
import { createClient } from "@/lib/supabase/server";
import {
  createRoster,
  membersOfRoster,
  rosterSeasons,
  rostersForSeason,
  type Roster,
} from "@/repositories/rosters";

export const dynamic = "force-dynamic";

async function startSeason(formData: FormData) {
  "use server";

  const supabase = await createClient();
  const userId = await currentUserId(supabase);
  if (!userId) redirect("/login");

  // Only a season the page offered. The select makes a typo impossible from the
  // page; this makes it impossible from a hand-built request too.
  const season = String(formData.get("season") ?? "").trim();
  if (!startableSeasons(new Date()).includes(season)) redirect("/roster?error=bad-season");

  const clans = (await visibleClans(supabase, userId)).filter((c) => isLeadership(c.role));
  if (clans.length === 0) redirect("/roster?error=not-leadership");

  const existing = await rostersForSeason(supabase, season);
  const have = new Set(existing.map((r) => r.clanId));

  // One draft per clan the caller leads. Started together because the decision
  // is made across all of them at once — a leader who has to create three
  // rosters separately will forget the third.
  for (const clan of clans) {
    if (have.has(clan.id)) continue;
    const result = await createRoster(supabase, clan.id, season, 15, userId);
    if ("error" in result) redirect(`/roster?error=${encodeURIComponent(result.error)}`);
  }

  revalidatePath("/roster");
  redirect(`/roster/${season}?ok=roster-started`);
}

export default async function RosterSeasonsPage() {
  const supabase = await createClient();

  const userId = await currentUserId(supabase);
  if (!userId) redirect("/login");

  const clans = await visibleClans(supabase, userId);
  const clanById = new Map<string, VisibleClan>(clans.map((c) => [c.id, c]));
  const leads = clans.filter((c) => isLeadership(c.role));
  const seasons = await rosterSeasons(supabase);

  const now = new Date();
  // The season being worked on: this month's until its CWL is over, then next
  // month's (lineupFocusSeason). It was the calendar month, so on 27 September
  // the finished September CWL led the page with the gold button.
  const focus = lineupFocusSeason(now);
  const running = cwlWindow(now).season === focus && now >= cwlWindow(now).signupOpens;
  const byName = (a: Roster, b: Roster) =>
    (clanById.get(a.clanId)?.name ?? "").localeCompare(clanById.get(b.clanId)?.name ?? "");

  const perSeason = await Promise.all(
    seasons.map(async (season) => ({
      season,
      rosters: (await rostersForSeason(supabase, season))
        .filter((r) => clanById.has(r.clanId))
        .sort(byName),
    })),
  );

  // "Open" is the focus season and anything after it; "past" is everything before.
  // Only open seasons pay for member counts, because only they have a lineup
  // still being filled — history needs its statuses, not its headcounts.
  const open = perSeason.filter((s) => s.season >= focus).sort((a, b) => a.season.localeCompare(b.season));
  const past = perSeason.filter((s) => s.season < focus);

  const filled = new Map<string, number>();
  await Promise.all(
    open.flatMap((s) =>
      s.rosters.map(async (r) => filled.set(r.id, (await membersOfRoster(supabase, r.id)).length)),
    ),
  );

  const started = new Set(seasons);
  const canStart = leads.length > 0 ? startableSeasons(now).filter((s) => !started.has(s)) : [];

  return (
    <main className="mx-auto max-w-page space-y-6 p-4 sm:p-6">
      <PageHeader
        title="CWL lineups"
        description="Choose who plays Clan War League for each clan, then publish the lineup so that clan's members can see it. Every season is kept."
      />

      {leads.length === 0 && (
        <Panel>
          <EmptyState
            icon={ClipboardList}
            title="Lineups are picked by leaders"
            body="Once your leader publishes a lineup, you can see it on your clan's CWL page."
            action={
              <div className="flex flex-wrap justify-center gap-2">
                {clans.map((clan) => (
                  <Button key={clan.id} asChild variant="outline" size="sm">
                    <Link href={`/${encodeURIComponent(clan.tag)}/cwl/roster`}>{clan.name} lineup</Link>
                  </Button>
                ))}
              </div>
            }
          />
        </Panel>
      )}

      {open.map(({ season, rosters }, i) => {
        const published = rosters.filter((r) => r.status === "published").length;
        return (
          <Tile
            as="section"
            key={season}
            accent="var(--ribbon-cwl)"
            ribbon={
              <Ribbon tone={season === focus ? "cwl" : "neutral"} icon={Trophy}>
                {season === focus ? (running ? "Running now" : "Up next") : "Later"}
              </Ribbon>
            }
            className="space-y-5"
          >
            <div className="flex flex-wrap items-end justify-between gap-3 pr-24">
              <div className="space-y-1">
                <h2 className="cb-title text-2xl">{seasonLabel(season)}</h2>
                <p className="text-muted-foreground text-sm">{publishedSummary(published, rosters.length)}</p>
              </div>
            </div>

            <ul className="grid gap-3 sm:grid-cols-2">
              {rosters.map((r) => (
                <li key={r.id} className="cb-sunken space-y-3 rounded-panel p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="flex items-center gap-2 font-medium">
                      <span
                        aria-hidden
                        className="size-2.5 rounded-full"
                        style={{ background: clanAccent(r.clanId).color }}
                      />
                      {clanById.get(r.clanId)?.name}
                    </span>
                    <LineupStatus status={r.status} />
                  </div>
                  <SlotMeter filled={filled.get(r.id) ?? 0} slots={r.slotCount} />
                </li>
              ))}
            </ul>

            {leads.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <Button asChild variant={i === 0 ? "gold" : "outline"} size={i === 0 ? "cta" : "default"}>
                  <Link href={`/roster/${season}`}>
                    Continue picking
                    <ArrowRight aria-hidden />
                  </Link>
                </Button>
                {/* The finished lineups as a PDF, or an image per clan. */}
                <Button asChild variant="outline">
                  <Link href={`/roster/${season}/print`}>
                    <FileDown aria-hidden />
                    Export
                  </Link>
                </Button>
              </div>
            )}
          </Tile>
        );
      })}

      {canStart.length > 0 && (
        <form action={startSeason} className="cb-panel space-y-4 rounded-panel border border-dashed p-5">
          <div className="space-y-1">
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <CalendarPlus aria-hidden className="text-muted-foreground size-5" />
              {open.length === 0 ? "Start this season's lineups" : "Start another season"}
            </h2>
            <p className="text-muted-foreground text-sm">
              Creates an empty draft lineup for each clan you lead:{" "}
              <span className="text-foreground">{leads.map((c) => c.name).join(", ")}</span>.
              Drafts are private until you publish them.
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <label className="space-y-1.5">
              <span className="block text-sm font-medium">Season</span>
              <select
                name="season"
                defaultValue={canStart[0]}
                className="border-input bg-background h-10 rounded-control border px-3 text-sm"
              >
                {canStart.map((s) => (
                  <option key={s} value={s}>
                    {seasonLabel(s)}
                    {s === focus ? " (up next)" : " (the month after)"}
                  </option>
                ))}
              </select>
            </label>
            <SubmitButton pendingLabel="Creating lineups">Create draft lineups</SubmitButton>
          </div>
        </form>
      )}

      <section className="space-y-3" aria-labelledby="past-title">
        <SectionHeader id="past-title" title="Past seasons" count={past.length} />
        {past.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            {seasons.length === 0
              ? leads.length > 0
                ? "No seasons yet. Start one above and it will be kept here."
                : "No lineups have been published yet."
              : "No earlier seasons yet."}
          </p>
        ) : (
          <ul className="cb-panel divide-y rounded-panel border">
            {past.map(({ season, rosters }) => {
              const published = rosters.filter((r) => r.status === "published").length;
              return (
                <li key={season} className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div className="min-w-0 space-y-2">
                    <div>
                      <p className="font-medium">{seasonLabel(season)}</p>
                      <p className="text-muted-foreground text-xs">{publishedSummary(published, rosters.length)}</p>
                    </div>
                    <ul className="flex flex-wrap gap-x-4 gap-y-1">
                      {rosters.map((r) => (
                        <li key={r.id} className="flex items-center gap-1.5 text-sm">
                          {clanById.get(r.clanId)?.name}
                          <LineupStatus status={r.status} />
                        </li>
                      ))}
                    </ul>
                  </div>
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/roster/${season}`}>View</Link>
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}
