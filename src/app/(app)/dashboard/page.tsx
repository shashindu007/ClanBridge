// T12.6 — home. Where every member lands after signing in.
//
// Login used to redirect to `clans[0]` — whichever clan sorts first by tag —
// so a leader of three clans always landed in the same one and had to switch
// out of it to reach the others, and nothing anywhere showed the clans side by
// side. This page is the choice instead of the assumption.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY A TABLE AND NOT CARDS
//
// The first version was a card per clan in a three-column grid, and with four
// clans it broke in the way card grids always do: three in a row and one alone
// underneath with two empty cells beside it. Worse, the cards could not be
// COMPARED — members, level and league sat in a separate box on each card, so
// telling which clan was short of members meant reading every card in turn.
//
// A leader's question on this page is comparative ("which clan needs me?"), so
// the clans are rows with a shared column template: the same fact is always in
// the same column, a fifth clan is one more row, and nothing is truncated to
// fit a box. Below `md` each row stacks into a labelled block instead.
//
// The data freshness warning is said ONCE, above the table. It was on every
// card, in amber, four times — one fact (the sync is behind) made to look like
// four problems.
// ─────────────────────────────────────────────────────────────────────────────
//
// ONE ROUND TRIP'S WORTH OF LATENCY. Every clan's six reads, plus the feed, the
// people list and the waiting count, go out together — a leader of four clans
// pays for the slowest read, not the sum of twenty-eight.
//
// R3 — clans come from visibleClans(), the member's own clan_roles. Every
// repository call below takes that clan's id and filters on it.
//
// ACCESSIBILITY: one h1, an h2 per region, each clan row is ONE link named by
// the clan (the War and CWL shortcuts are separate, labelled targets), column
// labels are real on-screen text at every width, and every status is a word
// beside any colour.

import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Activity,
  ArrowRight,
  Bell,
  CalendarDays,
  ChevronRight,
  ClipboardList,
  Flame,
  Megaphone,
  MessageSquareHeart,
  Plus,
  Shield,
  ShieldCheck,
  Swords,
  TriangleAlert,
  Trophy,
  UserCheck,
  Users,
  Vote,
  Wifi,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { accountProfile, currentUserId } from "@/lib/auth";
import { visibleClans, type VisibleClan } from "@/lib/clans";
import { clanAccent } from "@/lib/clan-accent";
import { isLeader, isLeadership } from "@/lib/visibility";
import { clanDetail, currentMemberCount, latestAnnouncement } from "@/repositories/clans";
import { currentWar, type WarRow } from "@/repositories/war";
import { pollsForClan } from "@/repositories/polls";
import { latestRun } from "@/repositories/sync-log";
import { activeMembers, feedFor, platformPresence, unreadCount } from "@/repositories/notifications";
import { adminAccounts } from "@/repositories/accounts";
import { openWarAvailabilityPoll } from "@/services/polls";
import { freshness, type Freshness } from "@/services/freshness";
import { GameStat } from "@/components/game-stat";
import { LocalTime } from "@/components/local-time";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

interface ClanSummary {
  clan: VisibleClan;
  memberCount: number;
  level: number | null;
  warLeague: string | null;
  war: WarRow | null;
  pollTitle: string | null;
  noticeTitle: string | null;
  fresh: Freshness;
}

async function summarise(
  supabase: Awaited<ReturnType<typeof createClient>>,
  clan: VisibleClan,
): Promise<ClanSummary> {
  const [detail, held, notice, run, war, polls] = await Promise.all([
    clanDetail(supabase, clan.id),
    currentMemberCount(supabase, clan.id),
    latestAnnouncement(supabase, clan.id),
    latestRun(supabase, "clans", clan.id),
    currentWar(supabase, clan.id),
    pollsForClan(supabase, clan.id),
  ]);

  return {
    clan,
    // The game's own count when the sync has it; the members this system holds
    // otherwise. Same preference the clan page makes.
    memberCount: detail?.memberCount ?? held,
    level: detail?.level ?? null,
    warLeague: detail?.warLeague ?? null,
    war,
    pollTitle: openWarAvailabilityPoll(polls)?.title ?? null,
    noticeTitle: notice?.title ?? null,
    fresh: freshness(run),
  };
}

function isLive(war: WarRow | null): war is WarRow {
  return war?.state === "preparation" || war?.state === "inWar";
}

function isBehind(fresh: Freshness): boolean {
  return fresh.level === "stale" || fresh.level === "failed";
}

/** "Crystal League III" → "Crystal III". The column says League already. */
function shortLeague(league: string | null): string {
  return league ? league.replace(/\s*League\s*/i, " ").trim() : "—";
}

// ─── The clan table ──────────────────────────────────────────────────────────

/**
 * ONE column template, shared by the header and every row, so each fact sits
 * in the same column for every clan. Changing a width here changes it
 * everywhere; there is no second copy to drift.
 */
const COLUMNS =
  "md:grid md:grid-cols-[minmax(0,2.4fr)_5rem_4.5rem_minmax(0,1fr)_minmax(0,1.9fr)_auto] md:items-center md:gap-4";

function WarStatus({ war }: { war: WarRow | null }) {
  if (!isLive(war)) {
    return (
      <span className="text-muted-foreground flex items-center gap-1.5">
        <Swords aria-hidden className="size-3.5 shrink-0" />
        No war on
      </span>
    );
  }

  if (war.state === "preparation") {
    return (
      <span className="flex min-w-0 items-center gap-1.5">
        <CalendarDays aria-hidden className="text-info size-3.5 shrink-0" />
        <span className="truncate">
          Preparation{war.opponentName ? ` vs ${war.opponentName}` : ""}
        </span>
      </span>
    );
  }

  return (
    <span className="flex min-w-0 items-center gap-1.5 font-medium">
      <Flame aria-hidden className="text-warning size-3.5 shrink-0" />
      <span className="truncate">
        Battle day
        {war.ourStars !== null && war.theirStars !== null && (
          <span className="tabular-nums"> · {war.ourStars}–{war.theirStars}</span>
        )}
      </span>
    </span>
  );
}

/** A value with its label. The label is shown only where the row is stacked. */
function Cell({
  label,
  children,
  className = "",
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`min-w-0 ${className}`}>
      <span className="text-muted-foreground block text-[0.7rem] font-medium tracking-wider uppercase md:hidden">
        {label}
      </span>
      {children}
    </div>
  );
}

function ClanRow({ summary }: { summary: ClanSummary }) {
  const { clan } = summary;
  const base = `/${encodeURIComponent(clan.tag)}`;
  const accent = clanAccent(clan.id).color;

  return (
    <li
      className={`hover:bg-accent/40 relative px-4 py-4 transition-colors sm:px-5 ${COLUMNS}`}
    >
      {/* The clan's colour down the leading edge — the same hue as its pill in
          the rail — so a leader recognises the row before reading it. */}
      <span
        aria-hidden
        className="absolute inset-y-3 left-0 w-1 rounded-r-full"
        style={{ background: accent }}
      />

      {/* Name. The link is stretched across the whole row with ::after, so
          the row is one click target and one tab stop named by the clan. */}
      <div className="flex min-w-0 items-center gap-3">
        {clan.badgeUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={clan.badgeUrl} alt="" className="size-10 shrink-0" />
        ) : (
          <span className="bg-muted flex size-10 shrink-0 items-center justify-center rounded-lg" aria-hidden>
            <Shield className="text-muted-foreground size-5" />
          </span>
        )}
        <div className="min-w-0">
          <Link
            href={base}
            className="cb-title block truncate text-lg after:absolute after:inset-0 after:content-[''] focus-visible:outline-none after:focus-visible:ring-[3px] after:focus-visible:ring-ring/50"
          >
            {clan.name}
          </Link>
          <p className="text-muted-foreground truncate text-xs">
            <span className="font-mono">{clan.tag}</span>
            <span aria-hidden> · </span>
            <span className="capitalize">{clan.role}</span>
          </p>
        </div>
      </div>

      {/* The three numbers. A row of three on a phone, three columns on a
          desktop — `contents` lets them join the row's grid directly. */}
      <div className="mt-3 grid grid-cols-3 gap-3 md:contents">
        <Cell label="Members">
          <span className="font-semibold tabular-nums md:text-right md:block">
            {summary.memberCount}
          </span>
        </Cell>
        <Cell label="Level">
          <span className="font-semibold tabular-nums md:text-right md:block">
            {summary.level ?? "—"}
          </span>
        </Cell>
        <Cell label="League">
          <span className="block truncate font-medium" title={summary.warLeague ?? undefined}>
            {shortLeague(summary.warLeague)}
          </span>
        </Cell>
      </div>

      <Cell label="Now" className="mt-3 text-sm md:mt-0">
        <WarStatus war={summary.war} />
        {/* The one secondary line, when there is something to say. A poll
            outranks a notice: it asks the member to DO something. */}
        {summary.pollTitle ? (
          <span className="text-info-ink mt-0.5 flex min-w-0 items-center gap-1.5 text-xs">
            <Vote aria-hidden className="size-3 shrink-0" />
            <span className="truncate">Poll open: {summary.pollTitle}</span>
          </span>
        ) : summary.noticeTitle ? (
          <span className="text-muted-foreground mt-0.5 flex min-w-0 items-center gap-1.5 text-xs">
            <Megaphone aria-hidden className="size-3 shrink-0" />
            <span className="truncate">{summary.noticeTitle}</span>
          </span>
        ) : null}
      </Cell>

      {/* Above the stretched link (relative z-10), so these stay their own
          targets instead of opening the overview. */}
      <div className="relative z-10 mt-3 flex items-center gap-1 md:mt-0 md:justify-end">
        <Button asChild size="xs" variant="ghost">
          <Link href={`${base}/war`} aria-label={`War — ${clan.name}`}>
            War
          </Link>
        </Button>
        <Button asChild size="xs" variant="ghost">
          <Link href={`${base}/cwl`} aria-label={`CWL — ${clan.name}`}>
            CWL
          </Link>
        </Button>
        <ChevronRight aria-hidden className="text-muted-foreground ml-1 hidden size-4 md:block" />
      </div>
    </li>
  );
}

// ─── The side column ─────────────────────────────────────────────────────────

function Panel({
  title,
  href,
  linkLabel,
  children,
}: {
  title: string;
  href?: string;
  linkLabel?: string;
  children: React.ReactNode;
}) {
  const id = `panel-${title.toLowerCase().replace(/\W+/g, "-")}`;
  return (
    <section aria-labelledby={id} className="cb-panel rounded-xl border">
      <div className="flex items-center justify-between gap-2 border-b px-5 py-3">
        <h2 id={id} className="cb-title text-base">
          {title}
        </h2>
        {href && (
          <Link href={href} className="text-primary text-xs font-medium hover:underline">
            {linkLabel}
          </Link>
        )}
      </div>
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}

function QuickLink({
  href,
  Icon,
  label,
}: {
  href: string;
  Icon: typeof Users;
  label: string;
}) {
  return (
    <li>
      <Link
        href={href}
        className="hover:bg-accent hover:text-accent-foreground -mx-2 flex items-center gap-3 rounded-md px-2 py-2 text-sm transition-colors"
      >
        <Icon aria-hidden className="text-muted-foreground size-4 shrink-0" />
        <span className="flex-1">{label}</span>
        <ChevronRight aria-hidden className="text-muted-foreground size-3.5" />
      </Link>
    </li>
  );
}

// ─── The page ────────────────────────────────────────────────────────────────

export default async function DashboardPage() {
  const supabase = await createClient();
  const userId = await currentUserId(supabase);
  if (!userId) redirect("/login");

  const [profile, clans] = await Promise.all([
    accountProfile(supabase, userId),
    visibleClans(supabase, userId),
  ]);
  const admin = profile?.isPlatformAdmin === true;
  const leads = clans.some((c) => isLeader(c.role));
  const leadership = clans.some((c) => isLeadership(c.role));

  const [summaries, feed, unread, people, presence, accounts] = await Promise.all([
    Promise.all(clans.map((clan) => summarise(supabase, clan))),
    feedFor(supabase, userId, 4),
    // The real count, not the unread among the few shown — a member with
    // eleven unread must not be told they have two.
    unreadCount(supabase, userId),
    activeMembers(supabase),
    platformPresence(supabase),
    // Leaders and the owner only. admin_accounts() is scoped to the clans the
    // caller leads, so "waiting" means waiting for THEM, not for the platform.
    admin || leads ? adminAccounts(supabase) : Promise.resolve([]),
  ]);

  const waiting = accounts.filter((a) => a.status === "pending" && !a.removedAt).length;
  const online = people.filter((p) => p.isOnline && p.id !== userId);
  const name = profile?.username ?? "there";

  const totalMembers = summaries.reduce((sum, s) => sum + s.memberCount, 0);
  const warsOn = summaries.filter((s) => isLive(s.war));
  const battles = warsOn.filter((s) => s.war?.state === "inWar").length;
  const behind = summaries.filter((s) => isBehind(s.fresh));

  return (
    <main className="mx-auto max-w-7xl space-y-6 p-4 sm:p-8">
      {/* ── Header ───────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="cb-title text-3xl sm:text-4xl">Welcome back, {name}</h1>
          <p className="text-muted-foreground">
            Here is where your {clans.length === 1 ? "clan stands" : `${clans.length} clans stand`}{" "}
            right now.
          </p>
        </div>

        {/* What needs this person, as actions rather than a paragraph. */}
        {(waiting > 0 || unread > 0) && (
          <div className="flex flex-wrap gap-2">
            {waiting > 0 && (
              <Button asChild variant="outline" size="sm">
                <Link href="/admin/members">
                  <UserCheck aria-hidden />
                  {waiting} waiting for approval
                </Link>
              </Button>
            )}
            {unread > 0 && (
              <Button asChild variant="outline" size="sm">
                <Link href="/notifications">
                  <Bell aria-hidden />
                  {unread} unread
                </Link>
              </Button>
            )}
          </div>
        )}
      </div>

      {/* ── Summary strip ────────────────────────────────────────────── */}
      <section aria-label="At a glance" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {/* Tile hues are decoration, so none of them is a status colour —
            the first version had "Wars on" in --warning and "Online" in
            --success, which made two ordinary numbers read as an alert and
            an all-clear. */}
        <GameStat
          label="Clans"
          value={String(clans.length)}
          hint={leads ? "you lead" : "you belong to"}
          Icon={Shield}
          tone="var(--primary)"
        />
        <GameStat
          label="Members"
          value={String(totalMembers)}
          hint="across all of them"
          Icon={Users}
          tone="var(--clan-1)"
        />
        <GameStat
          label="Wars on"
          value={String(warsOn.length)}
          hint={
            warsOn.length === 0
              ? "no war in progress"
              : battles > 0
                ? `${battles} on battle day`
                : "all in preparation"
          }
          Icon={Swords}
          tone="var(--foe)"
        />
        <GameStat
          label="Online now"
          value={String(presence.onlineNow)}
          hint={`of ${presence.activeAccounts} accounts`}
          Icon={Wifi}
          tone="var(--clan-3)"
          href="/people"
        />
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        {/* ── Your clans ────────────────────────────────────────────── */}
        <section aria-labelledby="clans-title" className="space-y-3">
          <h2 id="clans-title" className="cb-title text-2xl">
            Your clans
          </h2>

          {/* Said once, for every clan it affects — not once per row. */}
          {behind.length > 0 && (
            <Alert variant="warning">
              <TriangleAlert aria-hidden />
              <AlertTitle>
                {behind.length === summaries.length
                  ? `Game data ${behind[0]!.fresh.label}`
                  : `${behind.length} of ${summaries.length} clans are behind`}
              </AlertTitle>
              <AlertDescription>
                The sync job may have stopped, so numbers below can be out of date.
                {(admin || leads) && (
                  <>
                    {" "}
                    <Link href="/admin" className="font-medium underline underline-offset-2">
                      Check sync health
                    </Link>
                  </>
                )}
              </AlertDescription>
            </Alert>
          )}

          {clans.length === 0 ? (
            <div className="rounded-xl border border-dashed p-8 text-center">
              {admin ? (
                <>
                  <p className="font-medium">No clans on the platform yet</p>
                  <p className="text-muted-foreground mt-1 text-sm">
                    Add the first one by its tag. Its members arrive with the next sync.
                  </p>
                  <Button asChild className="mt-4">
                    <Link href="/admin">
                      <Plus aria-hidden />
                      Add your first clan
                    </Link>
                  </Button>
                </>
              ) : (
                <>
                  <p className="font-medium">You are not in a clan yet</p>
                  <p className="text-muted-foreground mt-1 text-sm">
                    Your account is approved, but a leader still needs to add you to a clan.
                    Ask them in game.
                  </p>
                </>
              )}
            </div>
          ) : (
            <div className="cb-panel overflow-hidden rounded-xl border">
              {/* Column labels, desktop only; stacked rows label each value. */}
              <div
                aria-hidden
                className={`text-muted-foreground hidden border-b px-5 py-2.5 text-[0.7rem] font-medium tracking-wider uppercase ${COLUMNS}`}
              >
                <span>Clan</span>
                <span className="text-right">Members</span>
                <span className="text-right">Level</span>
                <span>League</span>
                <span>Now</span>
                <span className="sr-only">Shortcuts</span>
              </div>
              <ul className="divide-y">
                {summaries.map((summary) => (
                  <ClanRow key={summary.clan.id} summary={summary} />
                ))}
              </ul>
            </div>
          )}
        </section>

        {/* ── The side column ───────────────────────────────────────── */}
        <div className="space-y-4">
          <Panel title="Latest notifications" href="/notifications" linkLabel="View all">
            {feed.length === 0 ? (
              <p className="text-muted-foreground text-sm">Nothing yet.</p>
            ) : (
              <ul className="space-y-3">
                {feed.map((item) => (
                  <li key={item.id} className="flex gap-2.5">
                    <span
                      aria-hidden
                      className={`mt-1.5 size-2 shrink-0 rounded-full ${
                        item.readAt ? "bg-transparent" : "bg-info"
                      }`}
                    />
                    <div className="min-w-0">
                      <p className={`text-sm leading-snug ${item.readAt ? "" : "font-medium"}`}>
                        {!item.readAt && <span className="sr-only">Unread: </span>}
                        {item.title}
                      </p>
                      <p className="text-muted-foreground text-xs">
                        <LocalTime iso={item.createdAt} />
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Online now" href="/people" linkLabel="Everyone">
            {online.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                Nobody else has opened the app in the last five minutes.
              </p>
            ) : (
              <ul className="space-y-2">
                {online.slice(0, 5).map((person) => (
                  <li key={person.id} className="flex items-center gap-2 text-sm">
                    <span aria-hidden className="bg-success size-2 shrink-0 rounded-full" />
                    <span className="truncate">
                      {person.username ?? person.displayName ?? "Someone"}
                    </span>
                    {person.clans[0] && (
                      <span className="text-muted-foreground ml-auto truncate text-xs">
                        {person.clans[0].clan}
                      </span>
                    )}
                  </li>
                ))}
                {online.length > 5 && (
                  <li className="text-muted-foreground text-xs">and {online.length - 5} more</li>
                )}
              </ul>
            )}
          </Panel>

          {/* A list, not a two-column grid: "Find a member" was truncating
              to "Find a mem…" at this width, and a list of labelled rows
              reads faster than a grid of clipped buttons. */}
          <Panel title="Quick links">
            <ul className="space-y-0.5">
              {leadership && (
                <>
                  <QuickLink href="/roster" Icon={ClipboardList} label="Rosters" />
                  <QuickLink href="/report" Icon={Activity} label="Participation" />
                </>
              )}
              {(admin || leads) && <QuickLink href="/admin" Icon={ShieldCheck} label="Admin" />}
              <QuickLink href="/search" Icon={Users} label="Find a member" />
              <QuickLink href="/account" Icon={Trophy} label="My bases" />
            </ul>
          </Panel>

          <Link
            href="/feedback"
            className="cb-panel cb-panel-interactive flex items-center gap-3 rounded-xl border p-4"
          >
            <MessageSquareHeart aria-hidden className="text-primary size-5 shrink-0" />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">Tell us what you think</span>
              <span className="text-muted-foreground block text-xs">
                Your feedback shapes what gets built next.
              </span>
            </span>
            <ArrowRight aria-hidden className="text-muted-foreground size-4" />
          </Link>
        </div>
      </div>
    </main>
  );
}
