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
  Flame,
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
import { LocalTime } from "@/components/local-time";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { clanAccent } from "@/lib/clan-accent";
import {
  cardLabelOf,
  cardsInGroup,
  CLAN_GROUPS,
  sectionHref,
  type ClanSection,
} from "@/lib/clan-nav";
import { requireClanByTag } from "@/lib/clans";
import { isLeader } from "@/lib/visibility";
import { cwlPhase, nextCwlWindow } from "@/lib/coc-time";
import { createClient } from "@/lib/supabase/server";
import { clanDetail, currentMemberCount, latestAnnouncement } from "@/repositories/clans";
import { seasonsForClan } from "@/repositories/cwl";
import { countsForPoll, pollsForClan } from "@/repositories/polls";
import { latestRun } from "@/repositories/sync-log";
import {
  attacksForWar,
  currentWar,
  membersOfWar,
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

/** A destination from lib/clan-nav.ts, as a card. */
function GoTo({ base, section }: { base: string; section: ClanSection }) {
  return (
    <Go
      href={sectionHref(base, section)}
      label={cardLabelOf(section)}
      hint={section.hint}
      Icon={section.icon}
    />
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

  // OPEN polls only — see openWarAvailabilityPoll. Last war's closed poll is
  // not something to chase members about.
  //
  // Resolved from `polls`, which is already in hand, so this costs nothing and
  // can be decided before the round trip below rather than after it.
  const poll = openWarAvailabilityPoll(polls);

  // ── The second round trip, and it used to be the third and fourth ─────────
  //
  // TWO QUERIES, NOT THREE, AND ONE ROUND TRIP, NOT TWO.
  //
  // What was here fetched the war's roster, attacks AND targets together, then
  // awaited the poll counts separately afterwards. Both were avoidable:
  //
  //   targetsForWar   fetched and thrown away. warRecord() only uses targets to
  //                   populate `record[].target`, and nothing on this page reads
  //                   it — the dashboard wants a COUNT of unused attacks, and
  //                   who was told to hit what is the war board's job. The
  //                   parameter defaults to [] precisely so a caller that does
  //                   not need the plan does not pay for it.
  //
  //   countsForPoll   sequential after the war block, for no reason. A poll's
  //                   tallies have nothing to do with a war's roster, so the two
  //                   were a waterfall made of independent work — the shape
  //                   T10.9 removed from the layout and left behind here.
  //
  // Both conditionals still hold. Most of any week there is no war and no open
  // poll, and this then issues nothing at all.
  const [warMembers, warAttacks, pollCounts] = await Promise.all([
    war ? membersOfWar(supabase, war.id) : [],
    war ? attacksForWar(supabase, war.id) : [],
    poll ? countsForPoll(supabase, poll.id) : [],
  ]);

  const record = warRecord(warMembers, warAttacks);
  const attacksLeft = outstandingAttacks(record).reduce(
    (total, m) => total + m.attacksRemaining,
    0,
  );

  const answered = pollCounts.reduce((total, c) => total + c.votes, 0);

  // ── T4.4 — when the next CWL is, which the API never says ─────────────────
  //
  // R12: the calendar is the PLAN and cwl_seasons is REALITY, and reality wins.
  // If a season row already exists for the month the window names, this clan is
  // in CWL and the sync has proved it — so the page links to the season instead
  // of telling a member it starts in four days. The inference only speaks where
  // there is nothing to check it against.
  //
  // Nothing here is persisted; see the header of cwlWindow() in lib/coc-time.ts.
  const now = new Date();
  const cwlNext = nextCwlWindow(now);
  const phase = cwlPhase(now);
  const cwlSeasonRow = seasons.find((s) => s.season === cwlNext.season) ?? null;

  // Both numbers, when they disagree. See currentMemberCount's comment: the gap
  // is the interesting part, so showing only one of them would hide the signal.
  const reported = detail?.memberCount ?? null;
  const memberHint =
    reported !== null && reported !== held
      ? `${reported} reported by the game — we hold ${held}`
      : undefined;

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-4 sm:p-8">
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
            <DataFreshness freshness={fresh} canAdmin={isLeader(clan.role)} />
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
          {/* Every tile now carries a line saying what its number IS. Three of
              the four had none, which left a first-time reader four large
              figures and four two-word labels — "CWL SEASONS 2" tells somebody
              who has never used this app nothing at all, and it happens to be
              the number that explains why the app exists. */}
          <Stat
            label="Members"
            value={String(reported ?? held)}
            hint={memberHint ?? "people in the clan right now"}
            tone="var(--info)"
            Icon={Users}
          />
          <Stat
            label="Clan level"
            value={detail?.level ? String(detail.level) : "—"}
            hint="rises as the clan finishes wars and games"
            tone="var(--clan-2)"
            Icon={TrendingUp}
          />
          <Stat
            label="War league"
            value={detail?.warLeague ?? "—"}
            hint="the tier this clan is placed in each CWL"
            tone="var(--success)"
            Icon={Swords}
          />
          <Stat
            label="CWL seasons"
            value={String(seasons.length)}
            // The one number on this page worth explaining twice. Clash deletes
            // a league season when it ends and it can never be fetched again —
            // this count is the whole reason the project exists, and it read as
            // a bare "2" next to three ordinary game statistics.
            hint={
              seasons.length
                ? `saved here for good — newest ${seasons[0]!.season}`
                : "none saved yet — the game deletes its own"
            }
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

      {/* ── Clan War League, next or now (T4.4) ──────────────────────────────
          This replaces the "Next CWL start date" line on the "Not built yet"
          list that used to close this page. That list also claimed the base
          layout library was unbuilt, three sections below a grid that linked
          to it — a panel describing the product to itself goes stale the first
          time nobody remembers to edit it, and this one had.

          CWL is the reason this project exists: the API deletes a season's data
          when it ends and it cannot be recovered from anywhere. Missing signup
          is therefore not a missed feature, it is a month that never happened. */}
      <section className="cb-panel space-y-3 rounded-xl border p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2.5 text-lg font-semibold tracking-tight">
            <span
              className="cb-emblem size-8 rounded-lg"
              style={{ "--emblem": "var(--primary)" } as React.CSSProperties}
            >
              <Trophy aria-hidden className="size-4" />
            </span>
            Clan War League
          </h2>
          {phase === "signup" && (
            <Badge variant="info">
              <CalendarDays aria-hidden />
              signup open
            </Badge>
          )}
          {phase === "wars" && (
            <Badge variant="warning">
              <Swords aria-hidden />
              war days
            </Badge>
          )}
        </div>

        {cwlSeasonRow ? (
          // Reality. The sync has found the league group, so there is nothing
          // left to infer and the calendar has no business being on screen.
          <div className="space-y-3">
            <p className="text-muted-foreground text-sm">
              {cwlNext.season} is running
              {cwlSeasonRow.league ? ` in ${cwlSeasonRow.league}` : ""}. Stars,
              attacks and who has missed a day are all on the season page.
            </p>
            <Button asChild size="sm">
              <Link href={`${href}/cwl/${encodeURIComponent(cwlSeasonRow.season)}`}>
                Open {cwlSeasonRow.season}
              </Link>
            </Button>
          </div>
        ) : phase === "signup" ? (
          <div className="space-y-3">
            <p className="text-muted-foreground text-sm">
              Signup is open until roughly{" "}
              <LocalTime iso={cwlNext.warsStart.toISOString()} style="date" />.
              Whoever is in the roster when it closes is in for all seven wars,
              so this is the one window where it can still be changed.
            </p>
            <Button asChild size="sm">
              <Link href={`${href}/cwl/roster`}>Pick the roster</Link>
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Deliberately vague. Supercell has moved the schedule by a day
                before, and nothing in the API confirms the date — a guess worded
                as a promise is worse than one worded as a guess, because the
                member stops trusting the rest of the page with it. */}
            <p className="text-muted-foreground text-sm">
              The next league usually opens for signup around{" "}
              <LocalTime iso={cwlNext.signupOpens.toISOString()} style="date" />,
              with the seven war days following two days later. The game does not
              publish the date, so this is the usual calendar rather than a
              promise.
            </p>
            <Button asChild size="sm" variant="outline">
              <Link href={`${href}/cwl`}>Past seasons</Link>
            </Button>
          </div>
        )}
      </section>

      {/* ── Where to go ──────────────────────────────────────────────────────
          Four labelled clusters, not one flat run of thirteen. The flat version
          put four separate war pages between Members and Clan Games in no
          order anyone could state, and a member looking for "where do I say I
          am available" had to read all thirteen to find out it was called
          "War lineup".

          Every card comes from lib/clan-nav.ts, which is also what the rail's
          tab strip and /guide read. Adding a destination in one place now puts
          it in all three; before, the tab strip did not exist and the hints
          lived only here. */}
      <section className="space-y-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-muted-foreground text-xs tracking-wide uppercase">
            Go to
          </h2>
          {/* The bridge for somebody on their first day. /guide now carries a
              map of what every one of these pages is for, built from the same
              lib/clan-nav.ts data as the cards below — but a member has no
              reason to guess that "Help" in the corner contains it. */}
          <Link
            href="/guide"
            className="text-muted-foreground hover:text-primary text-xs underline underline-offset-2 transition-colors"
          >
            New here? What each page is for
          </Link>
        </div>

        <div className="grid gap-x-6 gap-y-5 lg:grid-cols-2">
          {CLAN_GROUPS.map((group) => (
            <div key={group.id} className="space-y-2">
              <h3 className="text-muted-foreground flex items-center gap-2 text-xs font-medium tracking-wide uppercase">
                {group.label}
                {/* The rule finishes the heading across the column. Without it
                    a short heading over a two-card cluster reads as a card
                    label that lost its card. */}
                <span aria-hidden className="bg-border h-px flex-1" />
              </h3>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                {cardsInGroup(group.id).map((section) => (
                  <GoTo key={section.path} base={href} section={section} />
                ))}

                {/* Cross-clan, so it is not in the clan nav data — every path
                    there is relative to this clan's tag, and this one is not
                    under a tag at all. It sits in "Talk and share" because
                    finding somebody is what a member comes here to do.

                    "Find a player across the three" was hardcoded, while
                    /search itself renders "Across N of your clans". Two clans
                    exist today, not three; the number does not belong in copy
                    for the same reason lib/clan-accent.ts derives a hue rather
                    than listing the clans. */}
                {group.id === "share" && (
                  <Go
                    href="/search"
                    label="Search all clans"
                    hint="Find a player in any of your clans"
                    Icon={Search}
                  />
                )}
              </div>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
