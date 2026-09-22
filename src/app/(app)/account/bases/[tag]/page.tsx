// T11.12 — one of your own villages, and its record.
//
// The same report [clanTag]/player/[tag] shows a leader, reached from the other
// direction: a member looking at their own base. Every number is identical because
// both render components/player-report-sections.tsx over
// repositories/player-report.ts — that shared pair is T11.11 and it is the only
// thing that stops the two pages drifting apart.
//
// ─────────────────────────────────────────────────────────────────────────────
// AUTHORISATION IS NOT requireClanByTag(), AND THAT IS THE WHOLE POINT
//
// Every other page under (app) resolves its subject through requireClanByTag(),
// which answers "is this one of the clans you hold a role in". That question is
// the wrong one here. A member may own a village sitting in a clan they were
// never approved into — Architecture.md §7.1 says the model has supported that
// from the start — and requireClanByTag() would 404 exactly the base this page
// exists to show.
//
// So the gate is ownership: basesForUser() lists what the caller owns (031's
// policy, filtered by user_id), and a tag that is not in that list is notFound().
//
// 404 RATHER THAN 403, matching requireClanByTag()'s recorded reasoning: the
// candidate list is already restricted to the caller, so a distinguishable
// "forbidden" would confirm which tags are real to somebody probing.
// ─────────────────────────────────────────────────────────────────────────────
//
// R1 — every read is PostgreSQL. R3 — the report itself is clan-filtered, which
// is what produces the degraded branch below rather than a page of empty panels.

import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Castle } from "lucide-react";
import { PlayerReportSections, dayLabel } from "@/components/player-report-sections";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { clanRoles, currentUserId } from "@/lib/auth";
import { visibleClans } from "@/lib/clans";
import { baseLabel } from "@/lib/nickname";
import { createClient } from "@/lib/supabase/server";
import { decodeTag, encodeTag, InvalidTagError } from "@/lib/tags";
import { basesForUser } from "@/repositories/account-bases";
import { playerReport } from "@/repositories/player-report";

export const dynamic = "force-dynamic";

export default async function OwnBaseReportPage({
  params,
}: {
  params: Promise<{ tag: string }>;
}) {
  const { tag: rawTag } = await params;
  const supabase = await createClient();

  const userId = await currentUserId(supabase);
  if (!userId) notFound();

  let playerTag: string;
  try {
    playerTag = decodeTag(rawTag);
  } catch (error) {
    if (error instanceof InvalidTagError) notFound();
    throw error;
  }

  const [bases, roles] = await Promise.all([
    basesForUser(supabase, userId),
    clanRoles(supabase, userId),
  ]);

  // The gate. Not a clan check — see the header.
  const base = bases.find((b) => b.tag === playerTag);
  if (!base) notFound();

  const label = baseLabel(base.nickname, base.name);
  const named = label !== base.name;

  // Can a report be built at all? Everything it reads — member_snapshots, wars,
  // cwl_*, raid_*, clan_games — is still filtered by clan_id in auth_clan_ids(),
  // which 031 deliberately did NOT widen. So for a village outside the clans this
  // member holds a role in, there is genuinely nothing to read, and the honest
  // page says so instead of rendering six panels that each say "no data".
  const reportable = Boolean(base.clanId && roles.has(base.clanId));

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-4 sm:p-8">
      <div className="space-y-3">
        <Button asChild variant="ghost" size="xs" className="-ml-2">
          <Link href="/account">
            <ArrowLeft aria-hidden className="size-4" />
            Your bases
          </Link>
        </Button>

        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="cb-title text-3xl">{label}</h1>
            {base.clanRole && <Badge variant="secondary">{base.clanRole}</Badge>}
            {base.verified && <Badge variant="outline">verified</Badge>}
            {base.leftAt && <Badge variant="destructive">left the clan</Badge>}
            {/* T11B.10 — outside the reportable branch on purpose: details are
                readable by ownership, so a base with no report still has them. */}
            <Button asChild size="sm" className="ml-auto">
              <Link href={`/account/bases/${encodeTag(base.tag)}/details`}>
                <Castle aria-hidden />
                Base details
              </Link>
            </Button>
          </div>
          <p className="text-muted-foreground text-sm">
            {/* The in-game name stays visible whenever a label overrides it, so a
                member who called this "alt" can still tell which village it is. */}
            {named && <>{base.name} · </>}
            <span className="font-mono text-xs">{base.tag}</span>
            {base.thLevel ? ` · Town Hall ${base.thLevel}` : ""}
          </p>
        </div>
      </div>

      {reportable ? (
        <ReportableBase
          clanId={base.clanId!}
          playerId={base.playerId}
          userId={userId}
        />
      ) : (
        // ONE panel, not six empty ones. Six sections each saying "nothing here"
        // is the shape that made a leader scroll past a dashed "Not built yet" box
        // for a whole phase — an absence has to be stated once, with the reason.
        <section className="cb-panel space-y-3 rounded-lg border p-6">
          <h2 className="font-medium">There is no report for this base yet</h2>
          {base.clanId ? (
            <>
              <p className="text-muted-foreground text-sm">
                This village is in a clan you hold no role in here, so none of its
                history is visible to you — not its wars, not its donations, and
                not even the clan&apos;s name. That is the same rule that stops
                anyone else reading your clan&apos;s data.
              </p>
              <p className="text-muted-foreground text-sm">
                A leader of that clan has to add you before this fills in. The
                village itself stays on your account either way.
              </p>
            </>
          ) : (
            <p className="text-muted-foreground text-sm">
              This village is in none of the clans on this platform, so there is
              nothing recorded about it. If you have joined one of them in game, it
              will appear here after the next sync. It stays on your account
              because it is yours.
            </p>
          )}
          <Button asChild variant="outline" size="sm">
            <Link href="/account">Back to your bases</Link>
          </Button>
        </section>
      )}
    </main>
  );
}

/**
 * The report itself, for a village whose clan the member belongs to.
 *
 * Its own component so the reads it needs are not issued at all on the degraded
 * path. Seven queries for a page that is going to render one paragraph is seven
 * queries wasted, and putting them behind a `reportable` ternary in the parent
 * would still have awaited them.
 */
async function ReportableBase({
  clanId,
  playerId,
  userId,
}: {
  clanId: string;
  playerId: string;
  userId: string;
}) {
  const supabase = await createClient();

  const [report, clans] = await Promise.all([
    playerReport(supabase, clanId, playerId),
    visibleClans(supabase, userId),
  ]);

  const clan = clans.find((c) => c.id === clanId);
  // `reportable` was computed from clan_roles and visibleClans() is built from the
  // same table, so this cannot miss in practice. notFound() rather than a
  // non-null assertion: if the two ever disagree, a 404 is a better outcome than a
  // crash on a page a member opened about their own village.
  if (!clan) notFound();

  const clanNames = new Map(clans.map((c) => [c.id, c.name]));

  return (
    <>
      <p className="text-muted-foreground text-sm">
        Playing in{" "}
        <Link className="underline" href={`/${encodeURIComponent(clan.tag)}`}>
          {clan.name}
        </Link>
        {report.lastSeen && ` · last activity seen ${dayLabel(report.lastSeen)}`}
      </p>

      <PlayerReportSections
        report={report}
        clanTag={encodeURIComponent(clan.tag)}
        clanName={clan.name}
        clanNames={clanNames}
      />
    </>
  );
}
