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

import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { Badge } from "@/components/ui/badge";
import { SubmitButton } from "@/components/submit-button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { currentUserId } from "@/lib/auth";
import { visibleClans } from "@/lib/clans";
import { createClient } from "@/lib/supabase/server";
import { createRoster, rosterSeasons, rostersForSeason } from "@/repositories/rosters";

export const dynamic = "force-dynamic";

function isLeadership(role: string): boolean {
  return role === "leader" || role === "co-leader";
}

async function startSeason(formData: FormData) {
  "use server";

  const supabase = await createClient();
  const userId = await currentUserId(supabase);
  if (!userId) redirect("/login");

  const season = String(formData.get("season") ?? "").trim();
  if (!/^\d{4}-\d{2}$/.test(season)) redirect("/roster?error=bad-season");

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

export default async function RosterSeasonsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const supabase = await createClient();

  const userId = await currentUserId(supabase);
  if (!userId) redirect("/login");

  const clans = await visibleClans(supabase, userId);
  const leads = clans.filter((c) => isLeadership(c.role));
  const seasons = await rosterSeasons(supabase);

  const perSeason = await Promise.all(
    seasons.map(async (season) => ({
      season,
      rosters: await rostersForSeason(supabase, season),
    })),
  );

  const thisMonth = new Date().toISOString().slice(0, 7);
  const started = new Set(seasons);

  const message: Record<string, string> = {
    "bad-season": "A season looks like 2026-08.",
    "not-leadership": "Only a leader or co-leader can start a roster.",
  };

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-8">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">CWL rosters</h1>
        <p className="text-muted-foreground text-sm">
          Every season, kept permanently — who was picked, and what happened.
        </p>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertTitle>That did not work</AlertTitle>
          <AlertDescription>{message[error] ?? error}</AlertDescription>
        </Alert>
      )}

      {leads.length > 0 && !started.has(thisMonth) && (
        <form action={startSeason} className="space-y-4 rounded-lg border p-6">
          <h2 className="font-medium">Start a season</h2>
          <p className="text-muted-foreground text-sm">
            Creates one draft roster for each of the {leads.length} clan
            {leads.length === 1 ? "" : "s"} you lead. Drafts stay private until you
            publish them.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-2">
              <Label htmlFor="season">Season</Label>
              <Input
                id="season"
                name="season"
                defaultValue={thisMonth}
                pattern="\d{4}-\d{2}"
                className="w-40"
              />
            </div>
            <SubmitButton>Start</SubmitButton>
          </div>
        </form>
      )}

      {perSeason.length === 0 ? (
        <section className="space-y-3 rounded-lg border p-6">
          <h2 className="font-medium">No rosters yet</h2>
          <p className="text-muted-foreground text-sm">
            {leads.length > 0
              ? "Start a season above, then pick your players from the availability pool."
              : "Your leader has not published a roster yet. Published lineups appear on each clan's CWL page."}
          </p>
        </section>
      ) : (
        <ul className="space-y-3">
          {perSeason.map(({ season, rosters }) => {
            const published = rosters.filter((r) => r.status === "published").length;
            const picked = rosters.length;
            return (
              <li key={season} className="rounded-lg border p-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="space-y-1">
                    <Link
                      className="text-lg font-medium underline-offset-2 hover:underline"
                      href={`/roster/${season}`}
                    >
                      {season}
                    </Link>
                    <p className="text-muted-foreground text-sm">
                      {picked} roster{picked === 1 ? "" : "s"} ·{" "}
                      {published === 0
                        ? "none published"
                        : published === picked
                          ? "all published"
                          : `${published} published`}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {rosters.map((r) => {
                      const clan = clans.find((c) => c.id === r.clanId);
                      if (!clan) return null;
                      return (
                        <Badge
                          key={r.id}
                          variant={r.status === "published" ? "default" : "outline"}
                        >
                          {clan.name}
                        </Badge>
                      );
                    })}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
