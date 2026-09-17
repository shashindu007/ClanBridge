// T4B.10 — the published roster, as a member sees it.
//
// Read-only, and it replaces the WhatsApp message that gets buried. That is the
// whole feature: the lineup exists in one place that is still there next week.
//
// A DRAFT IS NEVER SHOWN HERE, and not because this page hides it — the policy
// in migration 011 does. A draft is the leader thinking out loud, with people on
// it who will be cut, and showing that causes exactly the arguments publishing
// exists to prevent. If a roster is a draft, this page cannot see it at all and
// says so honestly.

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { requireClanByTag } from "@/lib/clans";
import { createClient } from "@/lib/supabase/server";
import { membersOfRoster, rosterFor, rosterSeasons } from "@/repositories/rosters";
import { DISPLAY_ZONE } from "@/lib/display-time";

export const dynamic = "force-dynamic";

function isLeadership(role: string): boolean {
  return role === "leader" || role === "co-leader";
}

function when(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: DISPLAY_ZONE,
  });
}

export default async function PublishedRosterPage({
  params,
  searchParams,
}: {
  params: Promise<{ clanTag: string }>;
  searchParams: Promise<{ season?: string }>;
}) {
  const { clanTag } = await params;
  const { season: requested } = await searchParams;
  const supabase = await createClient();

  const clan = await requireClanByTag(supabase, clanTag);

  const seasons = await rosterSeasons(supabase);
  const season = requested ?? seasons[0] ?? new Date().toISOString().slice(0, 7);
  const roster = await rosterFor(supabase, clan.id, season);
  const members = roster ? await membersOfRoster(supabase, roster.id) : [];

  const base = `/${encodeURIComponent(clan.tag)}/cwl/roster`;

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-4 sm:p-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">CWL lineup</h1>
        <p className="text-muted-foreground text-sm">
          {clan.name} — season {season} ·{" "}
          <Link className="underline" href={`/${encodeURIComponent(clan.tag)}/cwl`}>
            CWL results
          </Link>
        </p>
      </div>

      {seasons.length > 1 && (
        <nav className="flex flex-wrap gap-2">
          {seasons.map((s) => (
            <Button key={s} asChild size="sm" variant={s === season ? "default" : "outline"}>
              <Link href={`${base}?season=${encodeURIComponent(s)}`}>{s}</Link>
            </Button>
          ))}
        </nav>
      )}

      {!roster ? (
        <section className="cb-panel space-y-3 rounded-lg border p-6">
          <h2 className="font-medium">Nothing published for {season}</h2>
          <p className="text-muted-foreground text-sm">
            The lineup appears here once your leader publishes it. If they are still
            deciding, it is deliberately not visible yet.
          </p>
          {isLeadership(clan.role) && (
            <Button asChild size="sm">
              <Link href={`/roster/${encodeURIComponent(season)}`}>Build the roster</Link>
            </Button>
          )}
        </section>
      ) : (
        <section className="cb-panel space-y-4 rounded-lg border p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-medium">
              Selected{" "}
              <span className="text-muted-foreground font-normal tabular-nums">
                ({members.length} of {roster.slotCount})
              </span>
            </h2>
            {roster.publishedAt && (
              <Badge variant="secondary">published {when(roster.publishedAt)}</Badge>
            )}
          </div>

          {members.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              The roster was published with nobody on it. That is almost certainly a
              mistake — ask your leader.
            </p>
          ) : (
            <ul className="divide-y">
              {members.map((m, index) => (
                <li key={m.playerId} className="flex items-center gap-4 py-3">
                  <span className="text-muted-foreground w-6 text-sm tabular-nums">
                    {index + 1}
                  </span>
                  <Link
                    className="min-w-0 flex-1 underline-offset-2 hover:underline"
                    href={`/${encodeURIComponent(clan.tag)}/player/${encodeURIComponent(m.tag)}`}
                  >
                    {m.name}
                  </Link>
                  <span className="text-muted-foreground text-sm tabular-nums">
                    TH{m.thLevel ?? "—"}
                  </span>
                  <span className="text-muted-foreground font-mono text-xs">{m.tag}</span>
                </li>
              ))}
            </ul>
          )}

          <p className="text-muted-foreground text-xs">
            If you are on this list, you are expected to use all seven attacks. If you
            cannot, tell your leader now rather than on day four.
          </p>
        </section>
      )}
    </main>
  );
}
