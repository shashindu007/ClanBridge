// T3B.1 — clan dashboard. The page every member lands on after login.
//
// R1 — PostgreSQL only. Everything here arrives via scripts/sync/clans.ts and
// scripts/sync/war.ts.
//
// T9.10 — the empty states are the point, not decoration. Each section below
// distinguishes "nothing has happened yet" from "this is not built yet",
// because a leader must act on the first and cannot act on the second. Three
// weeks in four there is no war on and no poll open; that is this page's NORMAL
// state, and it has to look deliberate rather than broken.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHAT THE COLOUR IS FOR
//
// Every status colour on this page comes from the reserved set in globals.css
// and means exactly what it means everywhere else: green fine, amber look at
// this, red broken, blue here is something you can do. Nothing is coloured
// because a grey page looked drab. The four stat tiles carry a hue each and
// those are IDENTITY, not status — they say "this tile is the war one", the
// same job the icon does, which is why the tile's number stays in ink and never
// takes the tile's colour.
//
// The one thing that must survive any future restyle: an amber pill on this
// page means something is wrong. If amber ever becomes a decoration here, the
// sync-failure indicator stops working on every other page too.
// ─────────────────────────────────────────────────────────────────────────────

import Link from "next/link";
import {
  BellRing,
  CalendarDays,
  Castle,
  ClipboardList,
  Flame,
  Gamepad2,
  Layers,
  LayoutGrid,
  Megaphone,
  Search,
  Shield,
  Swords,
  Target,
  TrendingUp,
  Trophy,
  TriangleAlert,
  Users,
  Vote,
} from "lucide-react";
import { DataFreshness } from "@/components/data-freshness";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { clanAccent } from "@/lib/clan-accent";
import { requireClanByTag } from "@/lib/clans";
import { createClient } from "@/lib/supabase/server";
import { clanDetail, currentMemberCount, latestAnnouncement } from "@/repositories/clans";
import { seasonsForClan } from "@/repositories/cwl";
import { countsForPoll, pollsForClan } from "@/repositories/polls";
import { latestRun } from "@/repositories/sync-log";
import {
  attacksForWar,
  currentWar,
  membersOfWar,
  targetsForWar,
  type WarRow,
} from "@/repositories/war";
import { freshness } from "@/services/freshness";
import { openWarAvailabilityPoll } from "@/services/polls";
import { outstandingAttacks, warRecord } from "@/services/war";
import { DISPLAY_ZONE } from "@/lib/display-time";

export const dynamic = "force-dynamic";

/**
 * A stat tile.
 *
 * `tone` picks the icon's hue and is IDENTITY — which of the four this is —
 * not a judgement about the number. The value itself stays in ink: a figure
 * rendered in the tile's colour reads as a status the moment one tile is red,
 * and none of these four is ever a status.
 */
function Stat({
  label,
  value,
  hint,
  tone,
  Icon,
}: {
  label: string;
  value: string;
  hint?: string;
  tone: string;
  Icon: typeof Users;
}) {
  return (
    <div
      // `isolate` is load-bearing: the wash below is an absolutely positioned
      // child, and a positioned child paints ABOVE the in-flow text beside it.
      // Pushing it to -z-10 fixes that, but a negative z-index escapes upward
      // unless something here makes a stacking context.
      className="cb-panel isolate overflow-hidden rounded-xl border p-4"
      style={{ "--emblem": tone } as React.CSSProperties}
    >
      {/* The wash. A solid fill of the tile’s own hue at 8% opacity, and NOT a
          `color-mix` — see the block in globals.css about what Lightning CSS
          does to those. An inline style would escape that particular hazard,
          since the build never sees it, but it would fail the same way on the
          same old browsers and for less obvious reasons.

          This is what makes four tiles read as four different things at a
          glance instead of one grey strip you have to read the labels of. 8%
          and no more: past about 12% the tint starts competing with the status
          tints, and a stat tile that looks like a status badge is precisely
          what the comment at the top of this file forbids. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 opacity-[0.08]"
        style={{ background: `linear-gradient(180deg, ${tone} 0%, transparent 62%)` }}
      />
      {/* Fading down rather than a flat bar: a solid full-strength rail down
          the side of a tile with a soft wash inside it reads as two unrelated
          decisions that happened to land on the same box. */}
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-1.5"
        style={{ background: `linear-gradient(180deg, ${tone} 0%, transparent 190%)` }}
      />
      <div className="flex items-start justify-between gap-2 pl-2.5">
        <div className="min-w-0">
          <p className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
            {label}
          </p>
          {/* Still ink, never the tile's colour. A figure rendered in the
              tile's hue reads as a status the moment one tile is red, and none
              of these four is ever a status. */}
          <p className="mt-1.5 text-3xl leading-none font-semibold tabular-nums">
            {value}
          </p>
        </div>
        <span className="cb-emblem size-8 shrink-0 rounded-lg">
          <Icon aria-hidden className="size-4" />
        </span>
      </div>
      {hint && <p className="text-muted-foreground mt-2 pl-2.5 text-xs">{hint}</p>}
    </div>
  );
}

/** One destination in the nav grid. */
function Go({
  href,
  label,
  hint,
  Icon,
}: {
  href: string;
  label: string;
  hint: string;
  Icon: typeof Users;
}) {
  return (
    <Link
      href={href}
      className="cb-panel cb-panel-interactive hover:border-primary/35 group flex items-start gap-3 rounded-xl border p-3.5"
    >
      {/* The disc is why this grid stopped looking like a list of links. A bare
          16px glyph on a textured surface is a smudge; the same glyph on a
          tinted disc is a destination. Ironwork blue, not --info, and the
          difference matters: --info means "here is something you might want"
          and thirteen permanent nav tiles are not thirteen notifications. */}
      <span
        className="cb-emblem mt-0.5 size-9 shrink-0 rounded-lg transition-colors"
        style={{ "--emblem": "var(--primary)" } as React.CSSProperties}
      >
        <Icon aria-hidden className="size-4.5" />
      </span>
      <span className="min-w-0 pt-0.5">
        <span className="group-hover:text-primary block text-sm font-medium transition-colors">
          {label}
        </span>
        <span className="text-muted-foreground block text-xs">{hint}</span>
      </span>
    </Link>
  );
}

/**
 * The war's state, in the reserved palette.
 *
 * Battle day is amber deliberately: it is the one state that is a call to
 * action rather than a report, and it is the state during which a missed attack
 * is still recoverable. A loss is red, but a loss is also over — which is why
 * preparation and ended both sit in neutral grey and only the live war shouts.
 */
function warStateBadge(war: WarRow) {
  if (war.state === "preparation")
    return (
      <Badge variant="info">
        <CalendarDays aria-hidden />
        Preparation
      </Badge>
    );
  if (war.state === "inWar")
    return (
      <Badge variant="warning">
        <Flame aria-hidden />
        Battle day
      </Badge>
    );
  if (war.result === "win")
    return (
      <Badge variant="success">
        <Trophy aria-hidden />
        Won
      </Badge>
    );
  if (war.result === "lose")
    return (
      <Badge variant="destructive">
        <Shield aria-hidden />
        Lost
      </Badge>
    );
  if (war.result === "tie") return <Badge variant="secondary">Tie</Badge>;
  return <Badge variant="outline">Ended</Badge>;
}

/** Stored UTC, shown in clan-local time (T9.9). See lib/display-time.ts. */
function when(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: DISPLAY_ZONE,
  });
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
  const accent = clanAccent(clan.id);

  const [detail, held, announcement, seasons, clansRun, war, polls] = await Promise.all([
    clanDetail(supabase, clan.id),
    currentMemberCount(supabase, clan.id),
    latestAnnouncement(supabase, clan.id),
    seasonsForClan(supabase, clan.id),
    latestRun(supabase, "clans", clan.id),
    currentWar(supabase, clan.id),
    pollsForClan(supabase, clan.id),
  ]);

  const fresh = freshness(clansRun);
  const neverSynced = fresh.level === "never";

  // The war's roster, attacks and assignments — only when there is a war. Most
  // of any given week there is not, and three queries returning nothing on
  // every dashboard render is three queries nobody asked for.
  const [warMembers, warAttacks, warTargets] = war
    ? await Promise.all([
        membersOfWar(supabase, war.id),
        attacksForWar(supabase, war.id),
        targetsForWar(supabase, war.id),
      ])
    : [[], [], []];

  const record = warRecord(warMembers, warAttacks, warTargets);
  const attacksLeft = outstandingAttacks(record).reduce(
    (total, m) => total + m.attacksRemaining,
    0,
  );

  // OPEN polls only — see openWarAvailabilityPoll. Last war's closed poll is
  // not something to chase members about.
  const poll = openWarAvailabilityPoll(polls);
  const pollCounts = poll ? await countsForPoll(supabase, poll.id) : [];
  const answered = pollCounts.reduce((total, c) => total + c.votes, 0);

  // Both numbers, when they disagree. See currentMemberCount's comment: the gap
  // is the interesting part, so showing only one of them would hide the signal.
  const reported = detail?.memberCount ?? null;
  const memberHint =
    reported !== null && reported !== held
      ? `${reported} reported by the game — we hold ${held}`
      : undefined;

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-8">
      {/* ── The banner, wearing this clan's own colour ────────────────────────
          --hero-accent is set here and read by .cb-hero and .cb-hero-stripe in
          globals.css, so the three clans get three visibly different banners
          without this file — or that stylesheet — ever naming a clan. The value
          comes from clanAccent(clan.id); see lib/clan-accent.ts on why it is
          derived from the id rather than looked up.

          This replaces the flat full-width bar that used to sit above the
          title. A solid rounded bar spanning the content width is the shape of
          a progress meter, and it sat directly above a heading with nothing to
          be the progress OF — so the clan’s colour is now carried by the
          banner itself and the stripe tapers away rather than terminating. */}
      <section
        className="cb-hero rounded-xl border"
        style={{ "--hero-accent": accent.color } as React.CSSProperties}
      >
        {/* No rounding needed: .cb-hero clips it. */}
        <div aria-hidden className="cb-hero-stripe" />
        <div className="space-y-3 p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3.5">
              {clan.badgeUrl && (
                // Plain img: next/image would need the Supercell asset host
                // added to next.config.ts, and this is one small badge on one
                // page. It IS the clan's own badge, which the game API serves
                // for exactly this — not artwork lifted out of the game.
                //
                // The ring and the drop shadow are here because the badge now
                // sits on a tinted banner rather than on flat white, and a
                // transparent PNG on a gradient reads as a sticker unless
                // something under it says it is an object.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={clan.badgeUrl}
                  alt=""
                  className="size-14 shrink-0 drop-shadow-[0_2px_4px_oklch(0_0_0/0.25)]"
                />
              )}
              <div className="min-w-0">
                <h1 className="text-3xl font-semibold tracking-tight">{clan.name}</h1>
                <p className="text-muted-foreground mt-1 text-sm">
                  <span className="font-mono text-xs">{clan.tag}</span> · you are{" "}
                  {clan.role}
                </p>
              </div>
            </div>
            <DataFreshness freshness={fresh} />
          </div>
        </div>
      </section>

      {neverSynced ? (
        <section className="space-y-3 rounded-xl border border-dashed p-6">
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
          <Stat
            label="Members"
            value={String(reported ?? held)}
            hint={memberHint}
            tone="var(--info)"
            Icon={Users}
          />
          <Stat
            label="Clan level"
            value={detail?.level ? String(detail.level) : "—"}
            tone="var(--clan-2)"
            Icon={TrendingUp}
          />
          <Stat
            label="War league"
            value={detail?.warLeague ?? "—"}
            tone="var(--success)"
            Icon={Swords}
          />
          <Stat
            label="CWL seasons"
            value={String(seasons.length)}
            hint={seasons.length ? `latest ${seasons[0]!.season}` : "none captured yet"}
            tone="var(--clan-3)"
            Icon={Trophy}
          />
        </section>
      )}

      {/* T0.1, surfaced. Silent while true, because a public war log is the
          normal case and a permanent green banner is noise. */}
      {detail?.isWarLogPublic === false && (
        <Alert variant="destructive">
          <TriangleAlert aria-hidden />
          <AlertTitle>This clan&rsquo;s war log is private</AlertTitle>
          <AlertDescription>
            <p>
              The game API returns 403 for a private war log, so no war or CWL data
              can be collected for {clan.name} at all — a hard blocker, not a
              degraded view. A leader can fix it in game: Clan Settings → War Log →
              Public. The next sync clears this message.
            </p>
          </AlertDescription>
        </Alert>
      )}

      {/* ── The open poll, if there is one (T6.7) ──────────────────────────── */}
      {poll && (
        <Alert variant="info">
          <Vote aria-hidden />
          <AlertTitle>{poll.title} is open</AlertTitle>
          <AlertDescription>
            <p>
              {answered === 0
                ? "Nobody has answered yet."
                : `${answered} ${answered === 1 ? "person has" : "people have"} answered.`}{" "}
              Your leader picks the war size from these answers, so an early
              answer is worth more than an accurate one.
            </p>
            <Button asChild size="sm" variant="outline" className="mt-1">
              <Link href={`${href}/polls/${encodeURIComponent(poll.id)}`}>
                Answer it
              </Link>
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* ── War, live ──────────────────────────────────────────────────────── */}
      <section className="cb-panel space-y-4 rounded-xl border p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2.5 text-lg font-semibold tracking-tight">
            <span
              className="cb-emblem size-8 rounded-lg"
              style={{ "--emblem": "var(--primary)" } as React.CSSProperties}
            >
              <Swords aria-hidden className="size-4" />
            </span>
            War
          </h2>
          {war && warStateBadge(war)}
        </div>

        {!war ? (
          // T9.10 — not being at war is the ordinary state for most of a week,
          // so this says what to do rather than apologising for an empty card.
          <div className="space-y-3">
            <p className="text-muted-foreground text-sm">
              No war on right now. The board fills in automatically within the hour
              of a war being declared in game.
            </p>
            <Button asChild size="sm" variant="outline">
              <Link href={`${href}/war/lineup`}>Plan the next lineup</Link>
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-baseline gap-x-8 gap-y-3">
              <div>
                <p className="text-muted-foreground text-xs tracking-wide uppercase">
                  Stars
                </p>
                <p className="text-2xl font-semibold tabular-nums">
                  {war.ourStars ?? 0}
                  <span className="text-muted-foreground mx-1.5 font-normal">–</span>
                  {war.theirStars ?? 0}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs tracking-wide uppercase">
                  Destruction
                </p>
                <p className="text-lg font-semibold tabular-nums">
                  {(war.ourDestruction ?? 0).toFixed(1)}%
                  <span className="text-muted-foreground mx-1.5 font-normal">vs</span>
                  {(war.theirDestruction ?? 0).toFixed(1)}%
                </p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs tracking-wide uppercase">
                  Against
                </p>
                <p className="text-lg font-medium">{war.opponentName ?? "—"}</p>
              </div>
            </div>

            {/* THE NUMBER THIS CARD EXISTS FOR. Attacks, not people — a war
                gives two each, so fifteen members who used one apiece is a
                whole roster's worth unspent, and a count of "people who did
                nothing" reports that clan as fine. services/war.ts argues it
                in full; this is the same unit the war board uses. */}
            <div className="flex flex-wrap items-center gap-3 border-t pt-3">
              {war.state === "warEnded" ? (
                <p className="text-muted-foreground text-sm">
                  Ended {when(war.endTime)}.
                </p>
              ) : attacksLeft > 0 ? (
                <Badge variant={war.state === "inWar" ? "warning" : "info"}>
                  <Target aria-hidden />
                  {attacksLeft} {attacksLeft === 1 ? "attack" : "attacks"} still unused
                </Badge>
              ) : record.length > 0 ? (
                <Badge variant="success">
                  <Trophy aria-hidden />
                  Every attack used
                </Badge>
              ) : (
                <p className="text-muted-foreground text-sm">
                  The roster has not been synced yet.
                </p>
              )}
              {war.endTime && war.state !== "warEnded" && (
                <p className="text-muted-foreground text-sm">
                  Ends {when(war.endTime)}
                </p>
              )}
            </div>

            <Button asChild size="sm">
              <Link href={`${href}/war`}>Open the war board</Link>
            </Button>
          </div>
        )}
      </section>

      {/* ── Announcement ───────────────────────────────────────────────────── */}
      <section className="cb-panel space-y-3 rounded-xl border p-6">
        <div className="flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2.5 text-lg font-semibold tracking-tight">
            <span
              className="cb-emblem size-8 rounded-lg"
              style={{ "--emblem": "var(--primary)" } as React.CSSProperties}
            >
              <Megaphone aria-hidden className="size-4" />
            </span>
            Latest announcement
          </h2>
          {announcement?.pinned && (
            <Badge variant="info">
              <BellRing aria-hidden />
              pinned
            </Badge>
          )}
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
            Nothing posted yet.{" "}
            <Link className="underline underline-offset-2" href={`${href}/notices`}>
              Announcements
            </Link>{" "}
            is where they go.
          </p>
        )}
      </section>

      {/* ── Where to go ────────────────────────────────────────────────────── */}
      <section className="space-y-3">
        <h2 className="text-muted-foreground text-xs tracking-wide uppercase">
          Go to
        </h2>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <Go
            href={`${href}/members`}
            label="Members"
            hint="Donations, ratios, who has gone quiet"
            Icon={Users}
          />
          <Go
            href={`${href}/war`}
            label="War board"
            hint="Targets, the chase list, both rosters"
            Icon={Swords}
          />
          <Go
            href={`${href}/war/lineup`}
            label="War lineup"
            hint="Pick who is in before declaring"
            Icon={ClipboardList}
          />
          <Go
            href={`${href}/war/history`}
            label="War history"
            hint="Every past war and its result"
            Icon={Layers}
          />
          {/* T6.9 / T6.10. Was reachable only from the war sub-headers and a
              player profile, which made the one report answering "did they do
              what they were told" the hardest page in the app to find. */}
          <Go
            href={`${href}/war/report`}
            label="War report"
            hint="Contribution, and plan versus reality"
            Icon={Target}
          />
          <Go
            href={`${href}/cwl`}
            label="Clan War League"
            hint="Seasons, stars and bonuses"
            Icon={Trophy}
          />
          <Go
            href={`${href}/cwl/roster`}
            label="CWL lineup"
            hint="The roster for this season"
            Icon={ClipboardList}
          />
          <Go
            href={`${href}/raids`}
            label="Raid weekends"
            hint="Medals, loot, and who still has attacks"
            Icon={Castle}
          />
          <Go
            href={`${href}/games`}
            label="Clan Games"
            hint="Points per member, month by month"
            Icon={Gamepad2}
          />
          <Go
            href={`${href}/polls`}
            label="Polls"
            hint="Ask, answer, and chase the quiet ones"
            Icon={Vote}
          />
          <Go
            href={`${href}/notices`}
            label="Announcements"
            hint="What leadership has posted"
            Icon={Megaphone}
          />
          {/* T8.4 — the library needs a way in, and the dashboard is the only
              page every member already opens. */}
          <Go
            href={`${href}/layouts`}
            label="Base layouts"
            hint="Shared bases, ranked by votes"
            Icon={LayoutGrid}
          />
          <Go
            href="/search"
            label="Search all clans"
            hint="Find a player across the three"
            Icon={Search}
          />
        </div>
      </section>

      {/* Named rather than omitted, so the page states what it does not yet know
          instead of implying nothing is missing. Deliberately the only
          uncoloured block on the page — it must not compete with the sections
          above it, which are about things that actually happened.

          Raids and Clan Games left this list when Phase 7 landed; both are in
          the nav grid above now. */}
      <section className="space-y-2 rounded-xl border border-dashed p-6">
        <h2 className="text-muted-foreground font-medium">Not built yet</h2>
        <ul className="text-muted-foreground list-inside list-disc text-sm">
          <li>
            Next CWL start date — the API publishes none, so it has to be inferred
            from the season calendar (T4.4)
          </li>
          <li>Base layout library (Phase 8)</li>
        </ul>
      </section>
    </main>
  );
}
