// T12.6 / T12.10 — home. Where every member lands after signing in.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHAT THIS PAGE IS FOR, and it took four versions to say it plainly:
//
//   1. Show me EVERY clan at a glance — is a war on, and do I owe it an attack?
//   2. Tell me what else I need to DO, most urgent first.
//
// The versions before this answered the second question well and the first
// badly. The last one put a to-do list first and then ONE clan at a time
// behind tabs, so a member in four clans clicked four tabs to learn which of
// them was at war — and those tabs, named after the clans, went to
// /dashboard?clan= while the same names in the Clans menu went to the clan.
//
// So: a tile per clan, all at once (components/clan-status-tile.tsx), each led
// by a ribbon saying what it is doing and a line saying what you owe it; then
// "Needs you" beneath (services/home.ts, pure and tested, because the ORDER is
// the design).
//
// Above the clans, the member's own main base — Town Hall, progress, heroes —
// with Base details one click away instead of four. Each clan tile carries
// your village there and the clan's latest notice, and a small Announcements
// feed sits beside "Needs you", so "anything new?" needs no Notices page.
//
// The "Online now" and "Go to" side panels are gone — every link
// in "Go to" is on the rail or in the account menu under the same name, and
// the online count is on the rail.
//
// HCI, explicitly: visibility of status (a ribbon on every clan, visible
// together), recognition over recall (the action sits next to the thing it
// acts on), one name per destination (a tile opens the clan, as the menu
// does), minimal design (facts in a line, not in boxes), error prevention
// (leader items appear only where the role allows the action).
// ─────────────────────────────────────────────────────────────────────────────
//
// R3 — clans come from visibleClans(); every read below takes that clan's id.
// Two rounds of reads per clan (the second needs the war and season ids from
// the first), and every clan's rounds run in parallel with every other clan's.
// CWL is read only during CWL week, so the other three weeks pay nothing for it.

import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Bell,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ClipboardList,
  Flame,
  Plus,
  Shield,
  Swords,
  UserCheck,
  Vote,
  type LucideIcon,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { accountProfile, currentUserId } from "@/lib/auth";
import { visibleClans, type VisibleClan } from "@/lib/clans";
import { clanAccent } from "@/lib/clan-accent";
import { cwlPhase, nextCwlWindow } from "@/lib/coc-time";
import { isLeader, isLeadership } from "@/lib/visibility";
import {
  announcementsForClan,
  clanDetail,
  currentMemberCount,
  type Announcement,
} from "@/repositories/clans";
import { basesForUser, type OwnedBase } from "@/repositories/account-bases";
import { baseProgress } from "@/repositories/player-progress";
import { baseLabel } from "@/lib/nickname";
import { encodeTag } from "@/lib/tags";
import { counts, groupProgress, overallProgress } from "@/services/progress";
import { attacksForWar, currentWar, membersOfWar, type WarRow } from "@/repositories/war";
import * as cwlRepo from "@/repositories/cwl";
import { myPlayers, pollsForClan, responsesForPoll, type Poll } from "@/repositories/polls";
import { latestRun } from "@/repositories/sync-log";
import { membersForClan } from "@/repositories/members";
import { unreadCount } from "@/repositories/notifications";
import { adminAccounts } from "@/repositories/accounts";
import { isOpen } from "@/services/polls";
import { warRecord, type MemberWarRecord } from "@/services/war";
import { warRecord as cwlWarRecord } from "@/services/cwl";
import { freshness, type Freshness } from "@/services/freshness";
import {
  announcementFeed,
  clanStatus,
  mainBase,
  needsYou,
  type HomeClan,
  type HomeCwl,
  type NeedClan,
  type NeedItem,
  type NeedKind,
} from "@/services/home";
import { EmptyState, ListRow, Panel, SectionHeader } from "@/components/kit";
import { PageHeader } from "@/components/page-header";
import { ClanStatusTile } from "@/components/clan-status-tile";
import { MainBaseCard, type MainBaseView } from "@/components/main-base-card";
import { AnnouncementFeed } from "@/components/announcement-feed";
import { SceneBackdrop } from "@/components/game/scene-backdrop";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

type Supabase = Awaited<ReturnType<typeof createClient>>;

interface LoadedClan {
  clan: VisibleClan;
  memberCount: number;
  level: number | null;
  warLeague: string | null;
  fresh: Freshness;
  war: WarRow | null;
  /** Only for a war that is on. Empty otherwise. */
  record: MemberWarRecord[];
  /** Only during CWL week, and only once the group has formed. */
  cwl: HomeCwl | null;
  openPolls: Array<{ poll: Poll; responders: string[] }>;
  /** Current members' player ids — only for a clan the caller helps run, where non-responders are counted. */
  memberIds: string[];
  /** Live announcements, pinned first then newest. */
  notices: Announcement[];
}

/**
 * A plain boolean, NOT a `war is WarRow` guard: a guard would tell TypeScript
 * that "not live" means "no war at all", and an ENDED war would narrow away.
 */
function isLive(war: WarRow | null): boolean {
  return war?.state === "preparation" || war?.state === "inWar";
}

/**
 * Today's CWL for one clan: the season's war on battle day (else the one in
 * preparation), and on battle day who has used their one attack.
 *
 * Null outside the war days, and before the group has formed — the season row
 * does not exist until the first CWL sync of the week finds a group.
 */
async function loadCwl(supabase: Supabase, clanId: string, now: Date): Promise<HomeCwl | null> {
  const season = nextCwlWindow(now).season;
  const found = await cwlRepo.seasonByName(supabase, clanId, season);
  if (!found) return null;

  const wars = await cwlRepo.warsInSeason(supabase, found.id);
  const today = wars.find((w) => w.state === "inWar") ?? wars.find((w) => w.state === "preparation") ?? null;
  if (!today) return { season, war: null, record: [] };

  const battle = today.state === "inWar";
  const [roster, attacks] = battle
    ? await Promise.all([cwlRepo.rosterForWar(supabase, today.id), cwlRepo.attacksForWar(supabase, today.id)])
    : [[], []];

  return {
    season,
    war: {
      state: today.state,
      dayNumber: today.dayNumber,
      startTime: today.startTime,
      endTime: today.endTime,
    },
    // One attack per member per day in CWL: a member with no attack row has one left.
    record: cwlWarRecord(roster, attacks).map((m) => ({
      playerId: m.playerId,
      attacksRemaining: m.missed ? 1 : 0,
    })),
  };
}

async function loadClan(
  supabase: Supabase,
  clan: VisibleClan,
  now: Date,
  duringCwlWars: boolean,
): Promise<LoadedClan> {
  const [detail, held, run, war, polls, roster, cwl, notices] = await Promise.all([
    clanDetail(supabase, clan.id),
    currentMemberCount(supabase, clan.id),
    latestRun(supabase, "clans", clan.id),
    currentWar(supabase, clan.id),
    pollsForClan(supabase, clan.id),
    // Who SHOULD answer, per clan. A family poll's responders span every
    // clan, so "members minus responders" undercounts; see services/home.ts.
    isLeadership(clan.role) ? membersForClan(supabase, clan.id) : Promise.resolve([]),
    duringCwlWars ? loadCwl(supabase, clan.id, now) : Promise.resolve(null),
    announcementsForClan(supabase, clan.id),
  ]);

  const open = polls.filter((p) => isOpen(p));
  const live = war !== null && isLive(war);

  // Round two: only what round one proved is there. responsesForPoll returns a
  // member their OWN answers and leadership everyone's (010), which is exactly
  // what both "did I answer" and "how many have" need.
  const [members, attacks, responses] = await Promise.all([
    live && war ? membersOfWar(supabase, war.id) : Promise.resolve([]),
    live && war ? attacksForWar(supabase, war.id) : Promise.resolve([]),
    Promise.all(open.map((p) => responsesForPoll(supabase, p.id))),
  ]);

  return {
    clan,
    memberCount: detail?.memberCount ?? held,
    level: detail?.level ?? null,
    warLeague: detail?.warLeague ?? null,
    fresh: freshness(run),
    war,
    record: live ? warRecord(members, attacks) : [],
    cwl,
    openPolls: open.map((poll, i) => ({
      poll,
      responders: responses[i]!.map((r) => r.playerId),
    })),
    memberIds: roster.map((m) => m.playerId),
    notices,
  };
}

const detailsHref = (b: OwnedBase) => `/account/bases/${encodeTag(b.tag)}/details`;

/**
 * The main base, drawn from its latest reading. Home village only: that is the
 * Town Hall the card names, and its heroes are what a member checks first.
 */
async function loadMainBase(
  supabase: Supabase,
  base: OwnedBase | null,
  clanNames: Map<string, string>,
): Promise<MainBaseView | null> {
  if (!base) return null;
  // "owner" scope: the member's own village, wherever it plays.
  const { latest } = await baseProgress(supabase, "owner", base.playerId);
  const home = latest?.units.filter((u) => u.village === "home") ?? [];
  const counted = home.filter(counts);
  const playing = base.clanId && !base.leftAt;

  return {
    label: baseLabel(base.nickname, base.name),
    name: base.name,
    tag: base.tag,
    thLevel: latest?.thLevel ?? base.thLevel,
    verified: base.verified,
    clanName: playing ? (clanNames.get(base.clanId!) ?? null) : null,
    clanRole: playing ? base.clanRole : null,
    detailsHref: detailsHref(base),
    reportHref: `/account/bases/${encodeTag(base.tag)}`,
    progress: latest
      ? {
          pct: overallProgress(latest.units, "home").pct,
          maxed: counted.filter((u) => u.level >= u.cap).length,
          counted: counted.length,
          capturedAt: latest.capturedAt,
          heroes: groupProgress(home, "home").find((g) => g.group === "hero")?.units ?? [],
        }
      : null,
  };
}

function toHomeClan(l: LoadedClan): HomeClan {
  return {
    id: l.clan.id,
    tag: l.clan.tag,
    name: l.clan.name,
    role: l.clan.role,
    war: l.war && {
      state: l.war.state,
      endTime: l.war.endTime,
      startTime: l.war.startTime,
      ourStars: l.war.ourStars,
      theirStars: l.war.theirStars,
      result: l.war.result,
    },
    warRecord: l.record,
    cwl: l.cwl,
    openPolls: l.openPolls.map(({ poll, responders }) => ({
      id: poll.id,
      title: poll.title,
      closesAt: poll.closesAt,
      responders,
      scope: poll.scope,
    })),
    memberCount: l.memberCount,
    memberIds: isLeadership(l.clan.role) ? l.memberIds : undefined,
  };
}

/** Icon and hue for each kind of to-do. Status hues only where the row IS one. */
const KIND_STYLE: Record<NeedKind, { icon: LucideIcon; tone: string }> = {
  "war-attacks": { icon: Flame, tone: "var(--warning)" },
  "cwl-attacks": { icon: Flame, tone: "var(--warning)" },
  poll: { icon: Vote, tone: "var(--info)" },
  "war-soon": { icon: CalendarDays, tone: "var(--info)" },
  "lead-attacks": { icon: Swords, tone: "var(--primary)" },
  "lead-poll": { icon: ClipboardList, tone: "var(--primary)" },
  approvals: { icon: UserCheck, tone: "var(--primary)" },
  unread: { icon: Bell, tone: "var(--info)" },
};

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ clan?: string }>;
}) {
  const supabase = await createClient();
  const userId = await currentUserId(supabase);
  if (!userId) redirect("/login");

  const [{ clan: wanted }, profile, clans, mine, unread, bases] = await Promise.all([
    searchParams,
    accountProfile(supabase, userId),
    visibleClans(supabase, userId),
    myPlayers(supabase, userId),
    unreadCount(supabase, userId),
    basesForUser(supabase, userId),
  ]);

  // The old clan tabs were links to /dashboard?clan=TAG. Those bookmarks now go
  // where the same clan's name goes everywhere else: the clan itself.
  if (wanted && clans.some((c) => c.tag === wanted)) {
    redirect(`/${encodeURIComponent(wanted)}`);
  }

  const now = new Date();
  const phase = cwlPhase(now);
  const admin = profile?.isPlatformAdmin === true;
  const leads = clans.some((c) => isLeader(c.role));

  const main = mainBase(bases);
  const clanNames = new Map(clans.map((c) => [c.id, c.name]));

  const [loaded, accounts, mainView] = await Promise.all([
    Promise.all(clans.map((clan) => loadClan(supabase, clan, now, phase === "wars"))),
    // Scoped by admin_accounts() to accounts THIS caller may approve.
    admin || leads ? adminAccounts(supabase) : Promise.resolve([]),
    loadMainBase(supabase, main, clanNames),
  ]);

  // Your village in each clan: the same rule as the main base, applied to the
  // villages playing there — so the main one wins wherever it plays.
  const villageIn = (clanId: string) => {
    const here = mainBase(bases.filter((b) => b.clanId === clanId && !b.leftAt));
    return here
      ? { label: baseLabel(here.nickname, here.name), thLevel: here.thLevel, href: detailsHref(here) }
      : null;
  };

  const feed = announcementFeed(
    loaded.flatMap((l) =>
      l.notices.map((n) => ({
        id: n.id,
        title: n.title,
        body: n.body,
        pinned: n.pinned,
        createdAt: n.createdAt,
        clanId: l.clan.id,
        clanTag: l.clan.tag,
        clanName: l.clan.name,
      })),
    ),
  );

  const homeClans = loaded.map(toHomeClan);
  const items = needsYou({
    clans: homeClans,
    myPlayers: mine.map((p) => ({ id: p.id, clanId: p.clanId })),
    unread,
    waitingAccounts: accounts.filter((a) => a.status === "pending" && !a.removedAt).length,
    now,
  });

  const myIds = new Set(mine.map((p) => p.id));
  const statuses = homeClans.map((c) => clanStatus(c, myIds, now, phase));

  // THE ONE GOLD BUTTON. The first clan where you still have an attack gets it
  // on its tile; if there is none, the first "Needs you" row does. Never both.
  const goldTile = statuses.findIndex(
    (s) => (s.kind === "war" || s.kind === "cwl") && (s.mine?.left ?? 0) > 0,
  );

  const name = profile?.username ?? "there";
  const summary = [
    `${clans.length} ${clans.length === 1 ? "clan" : "clans"}`,
    items.length === 0
      ? "nothing needs you"
      : `${items.length} ${items.length === 1 ? "thing needs" : "things need"} you`,
  ].join(" · ");

  // Three rows, then the rest behind "Show more": a to-do list longer than the
  // screen is one nobody reaches the end of.
  const FIRST = 3;
  const needRow = (item: NeedItem, i: number) => {
    const style = KIND_STYLE[item.kind];
    return (
      <ListRow
        key={`${item.kind}-${item.clanId ?? "all"}-${i}`}
        icon={style.icon}
        tone={style.tone}
        context={item.clans.length > 0 ? <ClanChips clans={item.clans} /> : undefined}
        title={item.title}
        meta={item.meta ?? undefined}
        action={{ href: item.href, label: item.actionLabel, primary: i === 0 && goldTile === -1 }}
      />
    );
  };

  return (
    <main className="mx-auto max-w-page space-y-6 p-4 sm:p-6">
      {/* The welcome, on a banner with the game behind it — the one place on
          Home that is greeting rather than work. */}
      <section className="cb-hero rounded-hero border px-5 py-7 sm:px-8 sm:py-9">
        <SceneBackdrop scene="crystal" blur="md" fade="left" />
        <PageHeader title={`Welcome back, ${name}`} description={summary} />
      </section>

      {/* ── Your main base ─────────────────────────────────────────────── */}
      <MainBaseCard base={mainView} otherBases={Math.max(0, bases.length - 1)} />

      {/* ── Every clan, at once ────────────────────────────────────────── */}
      {loaded.length === 0 ? (
        <Panel>
          <EmptyState
            icon={Shield}
            title={admin ? "No clans on the platform yet" : "You are not in a clan yet"}
            body={
              admin
                ? "Add the first one by its tag. Its members arrive with the next sync."
                : "Your account is approved, but a leader still needs to add you to a clan. Ask them in game."
            }
            action={
              admin ? (
                <Button asChild variant="gold">
                  <Link href="/admin">
                    <Plus aria-hidden />
                    Add your first clan
                  </Link>
                </Button>
              ) : undefined
            }
          />
        </Panel>
      ) : (
        <section aria-labelledby="clans-title" className="space-y-2">
          <h2 id="clans-title" className="text-lg font-semibold">
            Your clans
          </h2>
          {/* A list of small rows: any number of clans reads top to bottom,
              with no orphan tile on a second line. */}
          <ul className="space-y-2.5">
            {loaded.map((l, i) => (
              <ClanStatusTile
                key={l.clan.id}
                clan={{
                  id: l.clan.id,
                  tag: l.clan.tag,
                  name: l.clan.name,
                  role: l.clan.role,
                  badgeUrl: l.clan.badgeUrl,
                  color: clanAccent(l.clan.id).color,
                }}
                status={statuses[i]!}
                memberCount={l.memberCount}
                level={l.level}
                warLeague={l.warLeague}
                fresh={l.fresh}
                gold={i === goldTile}
                clanLeft={
                  isLeadership(l.clan.role)
                    ? (statuses[i]!.kind === "cwl" ? (l.cwl?.record ?? []) : l.record).reduce(
                        (sum, r) => sum + r.attacksRemaining,
                        0,
                      ) || null
                    : null
                }
                village={villageIn(l.clan.id)}
                notice={l.notices[0] ?? null}
                now={now}
              />
            ))}
          </ul>
        </section>
      )}

      {/* ── Needs you, and the announcements beside it ─────────────────── */}
      <div className="grid items-start gap-6 lg:grid-cols-3">
      <Panel aria-labelledby="needs-title" className="space-y-4 lg:col-span-2">
        <SectionHeader id="needs-title" title="Needs you" count={items.length} />
        {items.length === 0 ? (
          <EmptyState
            icon={CheckCircle2}
            title="You're all caught up"
            body="No war attacks waiting, no polls to answer, nothing unread."
          />
        ) : (
          <>
            <ul className="divide-y">{items.slice(0, FIRST).map(needRow)}</ul>
            {items.length > FIRST && (
              // Native <details>: no JavaScript, and the page stays a server
              // component.
              <details className="group">
                <summary className="text-muted-foreground hover:bg-accent hover:text-accent-foreground flex cursor-pointer list-none items-center justify-center gap-1.5 rounded-control border border-dashed py-2 text-sm font-medium transition-colors [&::-webkit-details-marker]:hidden">
                  <span className="group-open:hidden">Show {items.length - FIRST} more</span>
                  <span className="hidden group-open:inline">Show fewer</span>
                  <ChevronDown aria-hidden className="size-4 transition-transform group-open:rotate-180" />
                </summary>
                <ul className="mt-4 divide-y">
                  {items.slice(FIRST).map((item, i) => needRow(item, i + FIRST))}
                </ul>
              </details>
            )}
          </>
        )}
      </Panel>

      <AnnouncementFeed
        notices={feed}
        now={now}
        allHref={loaded.length === 1 ? `/${encodeURIComponent(loaded[0]!.clan.tag)}/notices` : undefined}
      />
      </div>
    </main>
  );
}

/**
 * The clans a to-do concerns, as small chips: a family poll is one row that
 * names each clan, where it used to be one row per clan. Three at most, then
 * "+N" — the row's job is the action, not the list.
 */
function ClanChips({ clans }: { clans: NeedClan[] }) {
  const shown = clans.slice(0, 3);
  return (
    <span className="flex flex-wrap items-center gap-1">
      {shown.map((c) => (
        <span
          key={c.id}
          className="bg-muted/60 inline-flex max-w-[12rem] items-center gap-1 rounded-full px-1.5 py-px"
        >
          <span aria-hidden className="size-1.5 shrink-0 rounded-full" style={{ background: clanAccent(c.id).color }} />
          <span className="truncate">{c.name}</span>
          {c.count !== undefined && <span className="tabular-nums opacity-80">· {c.count}</span>}
        </span>
      ))}
      {clans.length > shown.length && <span>+{clans.length - shown.length}</span>}
    </span>
  );
}
