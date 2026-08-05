// T3B.1 — clan dashboard. The page every member lands on after login.
//
// R1 — PostgreSQL only. Everything here arrives via scripts/sync/clans.ts.
//
// T9.10 — the empty states are the point, not decoration. On the day this ships
// the clan has no announcements (T5.1 has not been built), no war data (phase 6),
// and possibly no sync run at all. A dashboard that renders four blank cards in
// that situation looks broken. Each section below distinguishes "nothing has
// happened yet" from "this is not built yet", because a leader must act on the
// first and cannot act on the second.

import Link from "next/link";
import { DataFreshness } from "@/components/data-freshness";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { requireClanByTag } from "@/lib/clans";
import { createClient } from "@/lib/supabase/server";
import { clanDetail, currentMemberCount, latestAnnouncement } from "@/repositories/clans";
import { seasonsForClan } from "@/repositories/cwl";
import { latestRun } from "@/repositories/sync-log";
import { freshness } from "@/services/freshness";

export const dynamic = "force-dynamic";

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border p-4">
      <p className="text-muted-foreground text-xs tracking-wide uppercase">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {hint && <p className="text-muted-foreground mt-1 text-xs">{hint}</p>}
    </div>
  );
}

export default async function ClanDashboardPage({
  params,
}: {
  params: Promise<{ clanTag: string }>;
}) {
  const { clanTag } = await params;
  const supabase = await createClient();

  // Resolves the segment AND proves the caller may see this clan. A tag they do
  // not belong to is a 404 here, before any query runs (R3, T3.7).
  const clan = await requireClanByTag(supabase, clanTag);
  const href = `/${encodeURIComponent(clan.tag)}`;

  const [detail, held, announcement, seasons, clansRun] = await Promise.all([
    clanDetail(supabase, clan.id),
    currentMemberCount(supabase, clan.id),
    latestAnnouncement(supabase, clan.id),
    seasonsForClan(supabase, clan.id),
    latestRun(supabase, "clans", clan.id),
  ]);

  const fresh = freshness(clansRun);
  const neverSynced = fresh.level === "never";

  // Both numbers, when they disagree. See currentMemberCount's comment: the gap
  // is the interesting part, so showing only one of them would hide the signal.
  const reported = detail?.memberCount ?? null;
  const memberHint =
    reported !== null && reported !== held
      ? `${reported} reported by the game — we hold ${held}`
      : undefined;

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-8">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            {clan.badgeUrl && (
              // Plain img: next/image would need the Supercell asset host added
              // to next.config.ts, and this is one small badge on one page.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={clan.badgeUrl} alt="" className="h-10 w-10" />
            )}
            <h1 className="text-2xl font-semibold tracking-tight">{clan.name}</h1>
          </div>
          <DataFreshness freshness={fresh} />
        </div>
        <p className="text-muted-foreground text-sm">
          <span className="font-mono text-xs">{clan.tag}</span> · you are {clan.role}
        </p>
      </div>

      {neverSynced ? (
        <section className="space-y-3 rounded-lg border border-dashed p-6">
          <h2 className="font-medium">This clan has never been synced</h2>
          <p className="text-muted-foreground text-sm">
            The clan row exists, but no sync job has read it from the game yet, so
            there is nothing to show. Level, member count and war league fill in
            on the next run of <code className="text-xs">sync:clans</code>.
          </p>
          <p className="text-muted-foreground text-sm">
            If that job is scheduled and this message is still here tomorrow, it
            is not running — check{" "}
            <Link className="underline" href="/admin">
              /admin
            </Link>
            .
          </p>
        </section>
      ) : (
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Members" value={String(reported ?? held)} hint={memberHint} />
          <Stat label="Clan level" value={detail?.level ? String(detail.level) : "—"} />
          <Stat label="War league" value={detail?.warLeague ?? "—"} />
          <Stat
            label="CWL seasons"
            value={String(seasons.length)}
            hint={seasons.length ? `latest ${seasons[0]!.season}` : "none captured yet"}
          />
        </section>
      )}

      {/* T0.1, surfaced. Silent while true, because a public war log is the
          normal case and a permanent green banner is noise. */}
      {detail?.isWarLogPublic === false && (
        <section className="border-destructive/50 space-y-2 rounded-lg border p-6">
          <h2 className="text-destructive font-medium">
            This clan&rsquo;s war log is private
          </h2>
          <p className="text-muted-foreground text-sm">
            The game API returns 403 for a private war log, so no war or CWL data
            can be collected for {clan.name} at all — a hard blocker, not a
            degraded view. A leader can fix it in game: Clan Settings → War Log →
            Public. The next sync clears this message.
          </p>
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="space-y-3 rounded-lg border p-6">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-medium">Latest announcement</h2>
            {announcement?.pinned && <Badge variant="secondary">pinned</Badge>}
          </div>

          {announcement ? (
            <div className="space-y-1">
              <p className="font-medium">{announcement.title}</p>
              {/* Plain text. T5.2 decides what rendering is safe; until then
                  nothing here interprets markup. */}
              <p className="text-muted-foreground text-sm whitespace-pre-line">
                {announcement.body}
              </p>
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">
              No announcements yet. Posting them is T5.1 — until that ships this
              stays empty even for a clan that is otherwise fully synced.
            </p>
          )}
        </section>

        <section className="space-y-3 rounded-lg border p-6">
          <h2 className="font-medium">Go to</h2>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href={`${href}/members`}>Members</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href={`${href}/cwl`}>Clan War League</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href={`${href}/polls`}>Polls</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href={`${href}/cwl/roster`}>CWL lineup</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href={`${href}/notices`}>Announcements</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/search">Search all clans</Link>
            </Button>
          </div>
        </section>
      </div>

      {/* Named rather than omitted, so the page states what it does not yet know
          instead of implying this clan has no war on. */}
      <section className="space-y-2 rounded-lg border border-dashed p-6">
        <h2 className="text-muted-foreground font-medium">Not built yet</h2>
        <ul className="text-muted-foreground list-inside list-disc text-sm">
          <li>Current war state and war board (T6.1, T6.3)</li>
          <li>
            Next CWL start date — the API publishes none, so it has to be inferred
            from the season calendar (T4.4)
          </li>
          <li>Raid Weekend and Clan Games summaries (T7.3, T7.5)</li>
        </ul>
      </section>
    </main>
  );
}
