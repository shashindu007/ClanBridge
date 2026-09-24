// T3B.1 — clan page. What a clan is doing, from the moment you open it.
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
// THE FIRST SCREEN IS THE WAR
//
// This page used to open with six framed tiles, a medallion each, for six
// numbers — members, level, league, two platform-wide counts and CWL seasons —
// and on a phone they filled the first two screens, so the war and the league
// were below the fold on the page members open to check the war. Now:
//
//   the banner    badge, name, tag, role, and the facts IN A LINE (kit FactRow)
//   war + CWL     side by side on a wide screen, war first on a phone, each a
//                 tile led by a ribbon saying its state in words
//   the notice    the latest announcement
//
// The two platform counts ("On ClanBridge", "Online now") are gone from here:
// they are not about this clan, and the rail already says "3 online". The "Go
// to" grid that closed the page is gone too — it repeated the section tabs
// directly above it, card for card.
//
// WHAT THE COLOUR IS FOR: the status colours are the reserved set in
// globals.css and mean exactly what they mean everywhere else. Ribbons are
// game state, in words; gold is the one thing to do next, at most once.
// ─────────────────────────────────────────────────────────────────────────────

import Link from "next/link";
import {
  BellRing,
  CalendarClock,
  Flag,
  Megaphone,
  Shield,
  Swords,
  Target,
  TriangleAlert,
  Trophy,
  Users,
  Vote,
  type LucideIcon,
} from "lucide-react";
import { DataFreshness } from "@/components/data-freshness";
import { WarScoreboard } from "@/components/war-scoreboard";
import { LocalTime } from "@/components/local-time";
import { EmptyState, FactRow, ListRow, Panel, SectionHeader, Tile } from "@/components/kit";
import { ClanBadge } from "@/components/game/clan-badge";
import { GameArt } from "@/components/game/game-art";
import { Ribbon, type RibbonTone } from "@/components/game/ribbon";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { clanAccent } from "@/lib/clan-accent";
import { artKeyForLeague } from "@/lib/game-art";
import { requireClanByTag } from "@/lib/clans";
import { isLeader } from "@/lib/visibility";
import { cwlPhase, nextCwlWindow } from "@/lib/coc-time";
import { createClient } from "@/lib/supabase/server";
import { clanDetail, currentMemberCount, latestAnnouncement } from "@/repositories/clans";
import { seasonsForClan, warsInSeason, type CwlWar } from "@/repositories/cwl";
import { countsForPoll, pollsForClan } from "@/repositories/polls";
import { latestRun } from "@/repositories/sync-log";
import {
  attacksForWar,
  currentWar,
  membersOfWar,
  type WarRow,
} from "@/repositories/war";
import { freshness } from "@/services/freshness";
import { timeUntil } from "@/services/home";
import { openWarAvailabilityPoll } from "@/services/polls";
import { outstandingAttacks, warRecord } from "@/services/war";
import { DISPLAY_ZONE } from "@/lib/display-time";

export const dynamic = "force-dynamic";

interface RibbonSpec {
  tone: RibbonTone;
  icon?: LucideIcon;
  label: string;
}

/** "12h" — timeUntil without the "in", for a ribbon. */
function shortly(iso: string | null, now: Date): string | null {
  return timeUntil(iso, now)?.replace(/^in /, "") ?? null;
}

/** The war's state, in words, as the ribbon on the war tile. */
function warRibbon(war: WarRow | null, now: Date): RibbonSpec {
  if (!war) return { tone: "neutral", label: "NO WAR" };
  if (war.state === "inWar") {
    const t = shortly(war.endTime, now);
    return { tone: "war", icon: Swords, label: t ? `BATTLE DAY · ${t}` : "BATTLE DAY" };
  }
  if (war.state === "preparation") {
    const t = shortly(war.startTime, now);
    return { tone: "prep", icon: CalendarClock, label: t ? `PREP · ${t}` : "PREP" };
  }
  const word = war.result === "win" ? "WON" : war.result === "lose" ? "LOST" : war.result === "tie" ? "DRAW" : "ENDED";
  return { tone: "neutral", icon: Flag, label: word };
}

/** CWL's state, in words, as the ribbon on the league tile. */
function cwlRibbon(
  phase: "signup" | "wars" | null,
  today: CwlWar | null,
  now: Date,
): RibbonSpec {
  const day = today?.dayNumber ? `DAY ${today.dayNumber}` : "WAR DAYS";
  if (phase === "wars" && today?.state === "inWar") {
    const t = shortly(today.endTime, now);
    return { tone: "cwl", icon: Trophy, label: t ? `${day} · ${t}` : day };
  }
  if (phase === "wars" && today?.state === "preparation") {
    return { tone: "cwl", icon: CalendarClock, label: `${day} PREP` };
  }
  if (phase === "wars") return { tone: "cwl", icon: Trophy, label: "WAR DAYS" };
  if (phase === "signup") return { tone: "cwl", icon: Trophy, label: "SIGN-UP OPEN" };
  return { tone: "neutral", label: "BETWEEN SEASONS" };
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

  const [detail, held, announcement, seasons, clansRun, war, polls] =
    await Promise.all([
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

  // ── The CURRENT war day, when there is a league on ────────────────────────
  //
  // The panel below could say a season was running and nothing about when
  // anything happened — while the war card directly above it counted down a
  // regular war to the minute. The times were in cwl_wars the whole time; no
  // query had ever asked for them.
  //
  // Conditional, so it costs nothing for the three weeks in four that there is
  // no league: outside CWL there is no season row and this never runs.
  const cwlWars = cwlSeasonRow ? await warsInSeason(supabase, cwlSeasonRow.id) : [];
  // The day being fought, or the last one recorded once the season is over.
  const cwlToday =
    cwlWars.find((w) => w.state === "inWar") ??
    cwlWars.find((w) => w.state === "preparation") ??
    cwlWars[cwlWars.length - 1] ??
    null;

  // Both numbers, when they disagree. See currentMemberCount's comment: the gap
  // is the interesting part, so showing only one of them would hide the signal.
  const reported = detail?.memberCount ?? null;
  const memberHint =
    reported !== null && reported !== held
      ? `${reported} reported by the game — we hold ${held}`
      : undefined;

  const warFlag = warRibbon(war, now);
  const cwlFlag = cwlRibbon(phase, cwlToday, now);
  const league = cwlSeasonRow?.league ?? detail?.warLeague ?? null;
  const leagueArt = (size: number) => (
    <GameArt
      art={artKeyForLeague(league)}
      size={size}
      alt=""
      fallback={<Trophy aria-hidden className="text-muted-foreground size-4" />}
    />
  );

  // THE ONE GOLD BUTTON: the war board while a battle day has attacks unspent.
  // Otherwise the open poll's "Answer" may have it. Never both.
  const warIsTheAction = war?.state === "inWar" && attacksLeft > 0;

  return (
    <main className="mx-auto max-w-page space-y-6 p-4 sm:p-6">
      {/* ── The banner, wearing this clan's own colour ────────────────────────
          --hero-accent is read by .cb-hero and .cb-hero-stripe in globals.css,
          so each clan gets its own banner without this file or that
          stylesheet ever naming a clan (lib/clan-accent.ts). */}
      <section
        className="cb-hero overflow-hidden rounded-hero border"
        style={{ "--hero-accent": accent.color } as React.CSSProperties}
      >
        <div aria-hidden className="cb-hero-stripe" />
        <div className="flex flex-wrap items-center gap-4 p-5 sm:gap-5 sm:p-6">
          <ClanBadge src={clan.badgeUrl} name={clan.name} size="xl" tone={accent.color} priority />
          <div className="min-w-0 flex-1 space-y-3">
            <div>
              <h1 className="cb-title text-3xl sm:text-4xl">{clan.name}</h1>
              {/* Tag and role as chips — the two facts a member checks to be
                  sure they are on the right clan, and the right account. */}
              <p className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                <span className="cb-sunken rounded-chip px-2 py-1 font-mono">{clan.tag}</span>
                <span className="border-trim rounded-chip border px-2 py-1 font-semibold capitalize">
                  {clan.role}
                </span>
              </p>
            </div>
            {/* The facts, in a line. They were six framed tiles. */}
            {!neverSynced && (
              <FactRow
                items={[
                  {
                    label: (reported ?? held) === 1 ? "member" : "members",
                    value: reported ?? held,
                    icon: Users,
                    title: memberHint,
                  },
                  ...(detail?.level ? [{ label: "level", value: detail.level, icon: Shield }] : []),
                  ...(detail?.warLeague
                    ? [{ label: "war league", value: detail.warLeague, art: leagueArt(20) }]
                    : []),
                  {
                    // The one number here worth a link: Clash deletes a league
                    // season when it ends, and these are the ones kept for good.
                    label: seasons.length === 1 ? "CWL season saved" : "CWL seasons saved",
                    value: seasons.length,
                    icon: Trophy,
                    href: `${href}/cwl`,
                    title: seasons.length
                      ? `Newest ${seasons[0]!.season}. The game deletes its own.`
                      : "None saved yet. The game deletes its own.",
                  },
                ]}
              />
            )}
          </div>
          <DataFreshness freshness={fresh} canAdmin={isLeader(clan.role)} />
        </div>
      </section>

      {neverSynced && (
        <Panel>
          <EmptyState
            icon={CalendarClock}
            title="This clan has never been synced"
            body={
              <>
                The clan row exists, but no sync job has read it from the game yet. Level,
                member count and war league fill in on the next run of{" "}
                <code className="text-xs">sync:clans</code>. If this is still here tomorrow,
                the job is not running — check{" "}
                <Link className="underline" href="/admin">
                  Admin
                </Link>
                .
              </>
            }
          />
        </Panel>
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

      {/* ── The open poll, if there is one (T6.7) — one row, one action ──── */}
      {poll && (
        <Panel aria-label="Open poll">
          <ul>
            <ListRow
              icon={Vote}
              tone="var(--info)"
              title={`${poll.title} is open`}
              meta={
                answered === 0
                  ? "Nobody has answered yet — your leader sizes the war from these answers."
                  : `${answered} ${answered === 1 ? "person has" : "people have"} answered — your leader sizes the war from these.`
              }
              action={{
                href: `${href}/polls/${encodeURIComponent(poll.id)}`,
                label: "Answer",
                primary: !warIsTheAction,
              }}
            />
          </ul>
        </Panel>
      )}

      {/* ── War and CWL: the first screen ────────────────────────────────── */}
      <div className="grid items-start gap-5 lg:grid-cols-[3fr_2fr]">
        <Tile
          as="section"
          accent={accent.color}
          ribbon={
            <Ribbon tone={warFlag.tone} icon={warFlag.icon}>
              {warFlag.label}
            </Ribbon>
          }
          className="space-y-4"
        >
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Swords aria-hidden className="text-muted-foreground size-4.5" />
            War
          </h2>

          {!war ? (
            // T9.10 — not being at war is the ordinary state for most of a week,
            // so this says what to do rather than apologising for an empty card.
            <div className="space-y-3">
              <p className="text-muted-foreground text-sm">
                No war on right now. The board fills in within the hour of a war
                being declared in game.
              </p>
              <Button asChild variant="outline">
                <Link href={`${href}/war/lineup`}>Plan the next lineup</Link>
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <WarScoreboard
                size="compact"
                us={{
                  name: clan.name,
                  stars: war.ourStars,
                  destruction: war.ourDestruction,
                  badgeUrl: clan.badgeUrl,
                }}
                them={{
                  name: war.opponentName,
                  stars: war.theirStars,
                  destruction: war.theirDestruction,
                  badgeUrl: war.opponentBadgeUrl,
                }}
                accent={accent.color}
              />

              {/* THE NUMBER THIS TILE EXISTS FOR. Attacks, not people — a war
                  gives two each, so fifteen members who used one apiece is a
                  whole roster's worth unspent. services/war.ts argues it. */}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-1 text-sm">
                  {war.state === "warEnded" ? (
                    <p className="text-muted-foreground">Ended {when(war.endTime)}.</p>
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
                    <p className="text-muted-foreground">The roster has not been synced yet.</p>
                  )}
                  {war.endTime && war.state !== "warEnded" && (
                    <p className="text-muted-foreground">
                      {war.state === "preparation" ? "Battle day starts" : "Ends"}{" "}
                      <LocalTime
                        iso={war.state === "preparation" ? war.startTime : war.endTime}
                        style="weekday"
                      />
                    </p>
                  )}
                </div>
                <Button
                  asChild
                  variant={warIsTheAction ? "gold" : "outline"}
                  size={warIsTheAction ? "cta" : "default"}
                >
                  <Link href={`${href}/war`}>
                    <Swords aria-hidden />
                    Open the war board
                  </Link>
                </Button>
              </div>
            </div>
          )}
        </Tile>

        {/* ── Clan War League, next or now (T4.4) ─────────────────────────
            CWL is the reason this project exists: the API deletes a season's
            data when it ends. Missing signup is not a missed feature, it is a
            month that never happened. */}
        <Tile
          as="section"
          accent="var(--ribbon-cwl)"
          ribbon={
            <Ribbon tone={cwlFlag.tone} icon={cwlFlag.icon}>
              {cwlFlag.label}
            </Ribbon>
          }
          className="space-y-4"
        >
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            {league ? leagueArt(24) : <Trophy aria-hidden className="text-muted-foreground size-4.5" />}
            Clan War League
          </h2>

          {cwlSeasonRow ? (
            // Reality (R12). The sync has found the league group, so there is
            // nothing left to infer and the calendar has no business here.
            <div className="space-y-3">
              <p className="text-muted-foreground text-sm">
                {cwlNext.season} is running
                {cwlSeasonRow.league ? ` in ${cwlSeasonRow.league}` : ""}.
              </p>
              {/* The deadline, in the reader's own zone. A CWL day gives one
                  attack and no second chance, so this is the line on the page
                  most worth being exact about. */}
              {cwlToday && (
                <p className="text-sm font-medium">
                  {cwlToday.state === "preparation" ? (
                    <>
                      Day {cwlToday.dayNumber ?? "?"}: battle day starts{" "}
                      <LocalTime iso={cwlToday.startTime} style="weekday" />
                    </>
                  ) : cwlToday.state === "inWar" ? (
                    <>
                      Day {cwlToday.dayNumber ?? "?"} ends{" "}
                      <LocalTime iso={cwlToday.endTime} style="weekday" />
                    </>
                  ) : (
                    <>
                      Day {cwlToday.dayNumber ?? "?"} ended{" "}
                      <LocalTime iso={cwlToday.endTime} style="weekday" />
                    </>
                  )}
                </p>
              )}
              <Button asChild variant="outline">
                <Link href={`${href}/cwl/${encodeURIComponent(cwlSeasonRow.season)}`}>
                  Open {cwlSeasonRow.season}
                </Link>
              </Button>
            </div>
          ) : phase === "signup" ? (
            <div className="space-y-3">
              <p className="text-muted-foreground text-sm">
                Sign-up is open until roughly{" "}
                <LocalTime iso={cwlNext.warsStart.toISOString()} style="date" />. Whoever
                is in the roster when it closes is in for all seven wars.
              </p>
              <Button asChild variant="outline">
                <Link href={`${href}/cwl/roster`}>See the lineup</Link>
              </Button>
            </div>
          ) : (
            // Deliberately vague. Supercell has moved the schedule by a day
            // before, and nothing in the API confirms the date.
            <p className="text-muted-foreground text-sm">
              The next league usually opens for sign-up around{" "}
              <LocalTime iso={cwlNext.signupOpens.toISOString()} style="date" />, with
              seven war days two days later. The game does not publish the date, so
              this is the usual calendar rather than a promise.
            </p>
          )}
        </Tile>
      </div>

      {/* ── Announcement ───────────────────────────────────────────────────── */}
      <Panel aria-labelledby="notice-title" className="space-y-3">
        <SectionHeader
          id="notice-title"
          title="Latest announcement"
          icon={Megaphone}
          action={{ href: `${href}/notices`, label: "All announcements" }}
        />
        {announcement ? (
          <div className="space-y-1">
            <p className="flex flex-wrap items-center gap-2 font-medium">
              {announcement.title}
              {announcement.pinned && (
                <Badge variant="info">
                  <BellRing aria-hidden />
                  pinned
                </Badge>
              )}
            </p>
            {/* Plain text. Nothing here interprets markup. */}
            <p className="text-muted-foreground text-sm whitespace-pre-line">{announcement.body}</p>
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">Nothing posted yet.</p>
        )}
      </Panel>
    </main>
  );
}
