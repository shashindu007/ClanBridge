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
//   2. How to start a season — a choice of this month or next, never a typed code,
//      naming the clans it will create lineups for.
//   3. What happened before — past seasons in plain month names, with every
//      clan's status written out rather than implied by colour.
// ─────────────────────────────────────────────────────────────────────────────

import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { ArrowRight, CalendarPlus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/submit-button";
import { LineupStatus, SlotMeter } from "@/components/roster-parts";
import { currentUserId } from "@/lib/auth";
import { visibleClans, type VisibleClan } from "@/lib/clans";
import { publishedSummary, seasonLabel, seasonOf, startableSeasons } from "@/lib/roster-view";
import { createClient } from "@/lib/supabase/server";
import {
  createRoster,
  membersOfRoster,
  rosterSeasons,
  rostersForSeason,
  type Roster,
} from "@/repositories/rosters";

export const dynamic = "force-dynamic";

function isLeadership(role: string): boolean {
  return role === "leader" || role === "co-leader";
}

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
  const thisMonth = seasonOf(now);
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

  // "Open" is this month and anything after it; "past" is everything before.
  // Only open seasons pay for member counts, because only they have a lineup
  // still being filled — history needs its statuses, not its headcounts.
  const open = perSeason.filter((s) => s.season >= thisMonth).sort((a, b) => a.season.localeCompare(b.season));
  const past = perSeason.filter((s) => s.season < thisMonth);

  const filled = new Map<string, number>();
  await Promise.all(
    open.flatMap((s) =>
      s.rosters.map(async (r) => filled.set(r.id, (await membersOfRoster(supabase, r.id)).length)),
    ),
  );

  const started = new Set(seasons);
  const canStart = leads.length > 0 ? startableSeasons(now).filter((s) => !started.has(s)) : [];

  return (
    <main className="mx-auto max-w-4xl space-y-8 p-4 sm:p-8">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">CWL lineups</h1>
        <p className="text-muted-foreground text-sm">
          Choose who plays Clan War League for each clan, then publish the lineup so
          that clan&apos;s members can see it. Every season is kept.
        </p>
      </div>

      {leads.length === 0 && (
        <section className="cb-panel space-y-3 rounded-lg border p-6">
          <h2 className="font-medium">Lineups are picked by leaders</h2>
          <p className="text-muted-foreground text-sm">
            Once your leader publishes a lineup, you can see it on your clan&apos;s CWL
            page.
          </p>
          <div className="flex flex-wrap gap-2">
            {clans.map((clan) => (
              <Button key={clan.id} asChild variant="outline" size="sm">
                <Link href={`/${encodeURIComponent(clan.tag)}/cwl/roster`}>{clan.name} lineup</Link>
              </Button>
            ))}
          </div>
        </section>
      )}

      {open.map(({ season, rosters }) => {
        const published = rosters.filter((r) => r.status === "published").length;
        return (
          <section key={season} className="cb-panel space-y-5 rounded-lg border p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-xl font-semibold">{seasonLabel(season)}</h2>
                  <Badge variant={season === thisMonth ? "info" : "secondary"}>
                    {season === thisMonth ? "This month" : "Upcoming"}
                  </Badge>
                </div>
                <p className="text-muted-foreground text-sm">{publishedSummary(published, rosters.length)}</p>
              </div>
              {leads.length > 0 && (
                <Button asChild>
                  <Link href={`/roster/${season}`}>
                    Continue picking
                    <ArrowRight aria-hidden />
                  </Link>
                </Button>
              )}
            </div>

            <ul className="grid gap-3 sm:grid-cols-2">
              {rosters.map((r) => (
                <li key={r.id} className="bg-card space-y-3 rounded-md border p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{clanById.get(r.clanId)?.name}</span>
                    <LineupStatus status={r.status} />
                  </div>
                  <SlotMeter filled={filled.get(r.id) ?? 0} slots={r.slotCount} />
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      {canStart.length > 0 && (
        <form action={startSeason} className="cb-panel space-y-4 rounded-lg border border-dashed p-6">
          <div className="space-y-1">
            <h2 className="flex items-center gap-2 font-medium">
              <CalendarPlus aria-hidden className="size-5" />
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
                className="border-input bg-background h-10 rounded-md border px-3 text-sm"
              >
                {canStart.map((s) => (
                  <option key={s} value={s}>
                    {seasonLabel(s)}
                    {s === thisMonth ? " (this month)" : " (next month)"}
                  </option>
                ))}
              </select>
            </label>
            <SubmitButton pendingLabel="Creating lineups">Create draft lineups</SubmitButton>
          </div>
        </form>
      )}

      <section className="space-y-3">
        <h2 className="font-medium">Past seasons</h2>
        {past.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            {seasons.length === 0
              ? leads.length > 0
                ? "No seasons yet. Start one above and it will be kept here."
                : "No lineups have been published yet."
              : "Nothing before this month yet."}
          </p>
        ) : (
          <ul className="cb-panel divide-y rounded-lg border">
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
