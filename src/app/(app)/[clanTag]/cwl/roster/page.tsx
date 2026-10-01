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
import { ClipboardList } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { EmptyState, Panel, SectionHeader } from "@/components/kit";
import { LineupCard } from "@/components/cwl-lineup";
import { playerDetails } from "@/lib/cwl-lineup-data";
import { requireClanByTag } from "@/lib/clans";
import { isLeadership } from "@/lib/visibility";
import { createClient } from "@/lib/supabase/server";
import { membersOfRoster, rosterFor, rosterSeasonsForClan } from "@/repositories/rosters";
import { lineupFocusSeason, seasonLabel } from "@/lib/roster-view";
import { DISPLAY_ZONE } from "@/lib/display-time";

export const dynamic = "force-dynamic";

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

  // THIS clan's seasons, and the upcoming one first. It used to take the newest
  // season with a roster in ANY clan, which — since members only see published
  // rosters — was last month's for as long as next month's was a draft.
  const focus = lineupFocusSeason(new Date());
  const clanSeasons = await rosterSeasonsForClan(supabase, clan.id);
  const requestedOk = requested && /^\d{4}-\d{2}$/.test(requested) ? requested : null;
  const season = requestedOk ?? focus;
  const seasons = [...new Set([focus, ...clanSeasons])].sort().reverse();
  const roster = await rosterFor(supabase, clan.id, season);
  const members = roster ? await membersOfRoster(supabase, roster.id) : [];
  // The same cards the leader picked from: Town Hall, heroes, progress, last CWLs.
  const details = await playerDetails(supabase, members.map((m) => m.playerId), { before: season });

  const base = `/${encodeURIComponent(clan.tag)}/cwl/roster`;

  return (
    <main className="mx-auto max-w-narrow space-y-6 p-4 sm:p-6">
      {/* "CWL results" used to sit here as a link: it is the Seasons tab one
          row up. */}
      <PageHeader
        eyebrow={clan.name}
        title="CWL lineup"
        description={`Who your leader picked for ${seasonLabel(season)}. Read-only; it appears once it is published.`}
      />

      {seasons.length > 1 && (
        <nav aria-label="Choose a season" className="cb-scroll-x flex gap-2">
          {seasons.map((s) => (
            <Button key={s} asChild size="xs" variant={s === season ? "default" : "outline"}>
              <Link
                href={`${base}?season=${encodeURIComponent(s)}`}
                aria-current={s === season ? "page" : undefined}
              >
                {s}
              </Link>
            </Button>
          ))}
        </nav>
      )}

      {!roster ? (
        <Panel>
          <EmptyState
            icon={ClipboardList}
            title={`Nothing published for ${seasonLabel(season)} yet`}
            body="The lineup appears here once your leader publishes it. If they are still deciding, it is deliberately not visible yet."
            action={
              isLeadership(clan.role) ? (
                <Button asChild variant="gold">
                  <Link href={`/roster/${encodeURIComponent(season)}`}>Build the lineup</Link>
                </Button>
              ) : undefined
            }
          />
        </Panel>
      ) : (
        <Panel className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <SectionHeader title={`Selected · ${members.length} of ${roster.slotCount}`} />
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
            <ol className="grid gap-3 sm:grid-cols-2">
              {members.map((m, index) => {
                const d = details.get(m.playerId);
                return (
                  <LineupCard
                    key={m.playerId}
                    index={index + 1}
                    player={{
                      playerId: m.playerId,
                      tag: m.tag,
                      name: m.name,
                      clanName: null,
                      thLevel: d?.thLevel ?? m.thLevel,
                      heroes: d?.heroes ?? [],
                      maxPct: d?.maxPct ?? null,
                      heroPct: d?.heroPct ?? null,
                      offencePct: d?.offencePct ?? null,
                      history: d?.history ?? [],
                    }}
                  />
                );
              })}
            </ol>
          )}

          <p className="text-muted-foreground text-xs">
            If you are on this list, you are expected to use all seven attacks. If you
            cannot, tell your leader now rather than on day four.
          </p>
        </Panel>
      )}
    </main>
  );
}
