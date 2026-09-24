// T12.6 / T12.10 — home. Where every member lands after signing in.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHAT THIS PAGE IS FOR, and it took three versions to say it plainly:
//
//   1. Tell me what I need to DO — across every clan, most urgent first.
//   2. Let me look at ONE clan properly — its war, its polls, its notices.
//
// The first two versions answered neither. A card grid, then a table of
// members / level / league: facts about clans, when the member's question is
// "what does this clan need from me?". Polls and announcements appeared as a
// truncated half-line, and a war you still had attacks in looked the same as
// no war at all.
//
// So: "Needs you" first — built by services/home.ts, which is pure and tested,
// because the ORDER is the design — then one tab per clan, each a link
// (?clan=TAG), with the selected clan's live detail beneath it. Links rather
// than client tabs: no JavaScript, the Back button works, and a URL can be
// sent to someone.
//
// HCI, explicitly: visibility of status (counts on each tab, "all caught up"),
// recognition over recall (every item carries its own action button), minimal
// design (one clan open at a time; the four-tile stat strip is gone — it
// restated what the tabs show), consistency (every block is kit.tsx), error
// prevention (leader items appear only where the role allows the action).
// ─────────────────────────────────────────────────────────────────────────────
//
// R3 — clans come from visibleClans(); every read below takes that clan's id.
// Two rounds of reads per clan (the second needs the war and poll ids from the
// first), and every clan's rounds run in parallel with every other clan's.

import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Activity,
  ArrowRight,
  Bell,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ClipboardList,
  Flame,
  Megaphone,
  MessageSquareHeart,
  Plus,
  Search,
  Shield,
  ShieldCheck,
  Swords,
  Trophy,
  TriangleAlert,
  UserCheck,
  Users,
  Vote,
  type LucideIcon,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { accountProfile, currentUserId } from "@/lib/auth";
import { visibleClans, type VisibleClan } from "@/lib/clans";
import { clanAccent } from "@/lib/clan-accent";
import { isLeader, isLeadership } from "@/lib/visibility";
import {
  announcementsForClan,
  clanDetail,
  currentMemberCount,
  type Announcement,
} from "@/repositories/clans";
import { attacksForWar, currentWar, membersOfWar, type WarRow } from "@/repositories/war";
import { myPlayers, pollsForClan, responsesForPoll, type Poll } from "@/repositories/polls";
import { latestRun } from "@/repositories/sync-log";
import { membersForClan } from "@/repositories/members";
import { activeMembers, unreadCount } from "@/repositories/notifications";
import { adminAccounts } from "@/repositories/accounts";
import { isOpen } from "@/services/polls";
import { warRecord, type MemberWarRecord } from "@/services/war";
import { freshness, type Freshness } from "@/services/freshness";
import {
  countsByClan,
  needsYou,
  timeUntil,
  type NeedClan,
  type NeedItem,
  type NeedKind,
} from "@/services/home";
import { EmptyState, ListRow, Panel, SectionHeader } from "@/components/kit";
import { WarScoreboard } from "@/components/war-scoreboard";
import { LocalTime } from "@/components/local-time";
import { Badge } from "@/components/ui/badge";
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
  openPolls: Array<{ poll: Poll; responders: string[] }>;
  /** Current members' player ids — only for a clan the caller helps run, where non-responders are counted. */
  memberIds: string[];
  notices: Announcement[];
}

/**
 * A plain boolean, NOT a `war is WarRow` guard: a guard would tell TypeScript
 * that "not live" means "no war at all", and an ENDED war — the one case the
 * else-branch below exists to describe — would narrow away to `never`.
 */
function isLive(war: WarRow | null): boolean {
  return war?.state === "preparation" || war?.state === "inWar";
}

async function loadClan(supabase: Supabase, clan: VisibleClan): Promise<LoadedClan> {
  const [detail, held, run, war, polls, notices, roster] = await Promise.all([
    clanDetail(supabase, clan.id),
    currentMemberCount(supabase, clan.id),
    latestRun(supabase, "clans", clan.id),
    currentWar(supabase, clan.id),
    pollsForClan(supabase, clan.id),
    announcementsForClan(supabase, clan.id),
    // Who SHOULD answer, per clan. A family poll's responders span every
    // clan, so "members minus responders" undercounts; see services/home.ts.
    isLeadership(clan.role) ? membersForClan(supabase, clan.id) : Promise.resolve([]),
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
    openPolls: open.map((poll, i) => ({
      poll,
      responders: responses[i]!.map((r) => r.playerId),
    })),
    memberIds: roster.map((m) => m.playerId),
    notices: notices.slice(0, 2),
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

  const { clan: wanted } = await searchParams;

  const [profile, clans, mine, unread, people] = await Promise.all([
    accountProfile(supabase, userId),
    visibleClans(supabase, userId),
    myPlayers(supabase, userId),
    unreadCount(supabase, userId),
    activeMembers(supabase),
  ]);
  const admin = profile?.isPlatformAdmin === true;
  const leads = clans.some((c) => isLeader(c.role));

  const [loaded, accounts] = await Promise.all([
    Promise.all(clans.map((clan) => loadClan(supabase, clan))),
    // Scoped by admin_accounts() to accounts THIS caller may approve.
    admin || leads ? adminAccounts(supabase) : Promise.resolve([]),
  ]);

  const items = needsYou({
    clans: loaded.map((l) => ({
      id: l.clan.id,
      tag: l.clan.tag,
      name: l.clan.name,
      role: l.clan.role,
      war: l.war && { state: l.war.state, endTime: l.war.endTime, startTime: l.war.startTime },
      warRecord: l.record,
      openPolls: l.openPolls.map(({ poll, responders }) => ({
        id: poll.id,
        title: poll.title,
        closesAt: poll.closesAt,
        responders,
        scope: poll.scope,
      })),
      memberCount: l.memberCount,
      memberIds: isLeadership(l.clan.role) ? l.memberIds : undefined,
    })),
    myPlayers: mine.map((p) => ({ id: p.id, clanId: p.clanId })),
    unread,
    waitingAccounts: accounts.filter((a) => a.status === "pending" && !a.removedAt).length,
  });
  const perClan = countsByClan(items);

  // The tab to open: the one asked for, else the first clan with something to
  // do, else the first clan. A stale ?clan= falls back rather than 404ing.
  const selected =
    loaded.find((l) => l.clan.tag === wanted) ??
    loaded.find((l) => (perClan.get(l.clan.id) ?? 0) > 0) ??
    loaded[0] ??
    null;

  const myIds = new Set(mine.map((p) => p.id));
  const online = people.filter((p) => p.isOnline && p.id !== userId);
  const name = profile?.username ?? "there";

  const summary = [
    `${clans.length} ${clans.length === 1 ? "clan" : "clans"}`,
    items.length === 0
      ? "nothing needs you"
      : `${items.length} ${items.length === 1 ? "thing needs" : "things need"} you`,
    online.length > 0 ? `${online.length} online` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  // Three rows, then the rest behind "Show more": the list is a to-do, and a
  // to-do list longer than the screen pushes the clan below it out of sight.
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
        action={{ href: item.href, label: item.actionLabel, primary: i === 0 }}
      />
    );
  };

  return (
    <main className="mx-auto max-w-6xl space-y-8 p-4 sm:p-8">
      <div className="space-y-1">
        <h1 className="cb-title text-3xl sm:text-4xl">Welcome back, {name}</h1>
        <p className="text-muted-foreground">{summary}</p>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        {/* ── Needs you ─────────────────────────────────────────────── */}
        <Panel aria-labelledby="needs-title" className="min-w-0 space-y-4">
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
                // component. The toggle sits above what it reveals — the one
                // place <details> allows a summary to be.
                <details className="group">
                  <summary className="text-muted-foreground hover:bg-accent hover:text-accent-foreground flex cursor-pointer list-none items-center justify-center gap-1.5 rounded-lg border border-dashed py-2 text-sm font-medium transition-colors [&::-webkit-details-marker]:hidden">
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

        {/* ── The side column ─────────────────────────────────────────── */}
        <aside className="space-y-4" aria-label="More">
          <Panel aria-labelledby="online-title" className="space-y-3">
            <SectionHeader
              id="online-title"
              title="Online now"
              count={online.length}
              action={{ href: "/people", label: "Everyone" }}
            />
            {online.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                Nobody else has opened the app in the last five minutes.
              </p>
            ) : (
              <ul className="space-y-2">
                {online.slice(0, 6).map((person) => (
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
                {online.length > 6 && (
                  <li className="text-muted-foreground text-xs">and {online.length - 6} more</li>
                )}
              </ul>
            )}
          </Panel>

          <Panel aria-labelledby="links-title" className="space-y-2">
            <SectionHeader id="links-title" title="Go to" />
            <ul className="-mx-2">
              {clans.some((c) => isLeadership(c.role)) && (
                <>
                  <QuickLink href="/roster" icon={ClipboardList} label="CWL lineups" />
                  <QuickLink href="/report" icon={Activity} label="Participation" />
                </>
              )}
              {(admin || leads) && <QuickLink href="/admin" icon={ShieldCheck} label="Admin" />}
              <QuickLink href="/search" icon={Search} label="Find a member" />
              <QuickLink href="/account" icon={Trophy} label="My bases" />
              <QuickLink href="/feedback" icon={MessageSquareHeart} label="Send feedback" />
            </ul>
          </Panel>
        </aside>
      </div>

      {/* ── Clans ─────────────────────────────────────────────────────
          Full width, under the to-do list rather than beside the side column:
          one clan in full is the widest thing on the page, and in the left
          column it left a gap beside it once the side column ran out. */}
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
                <Button asChild>
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
        <section aria-labelledby="clans-title" className="space-y-3">
          <h2 id="clans-title" className="text-lg font-semibold">
            Your clans
          </h2>

          <Panel padded={false} className="overflow-hidden">
            {/* The tabs are the top edge of the card they switch, so which
                clan the card shows is never in doubt. The chosen tab is
                underlined in that clan's own colour. */}
            <nav aria-label="Choose a clan" className="cb-scroll-x flex gap-1 border-b px-3">
              {loaded.map(({ clan }) => {
                const on = selected?.clan.id === clan.id;
                const count = perClan.get(clan.id) ?? 0;
                const color = clanAccent(clan.id).color;
                return (
                  <Link
                    key={clan.id}
                    href={`/dashboard?clan=${encodeURIComponent(clan.tag)}`}
                    aria-current={on ? "page" : undefined}
                    scroll={false}
                    className={`-mb-px flex shrink-0 items-center gap-2 border-b-2 px-3 py-3 text-sm transition-colors ${
                      on
                        ? "text-foreground font-semibold"
                        : "text-muted-foreground hover:text-foreground border-transparent"
                    }`}
                    style={on ? { borderColor: color } : undefined}
                  >
                    <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ background: color }} />
                    {clan.name}
                    {count > 0 && (
                      <span className="bg-muted text-muted-foreground rounded-full px-1.5 text-xs font-semibold tabular-nums">
                        {count}
                        <span className="sr-only"> {count === 1 ? "thing needs" : "things need"} you</span>
                      </span>
                    )}
                  </Link>
                );
              })}
            </nav>

            {selected && (
              <ClanPanel loaded={selected} myIds={myIds} canLead={isLeadership(selected.clan.role)} />
            )}
          </Panel>
        </section>
      )}
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

function QuickLink({ href, icon: Icon, label }: { href: string; icon: LucideIcon; label: string }) {
  return (
    <li>
      <Link
        href={href}
        className="hover:bg-accent hover:text-accent-foreground flex items-center gap-3 rounded-md px-2 py-2 text-sm transition-colors"
      >
        <Icon aria-hidden className="text-muted-foreground size-4 shrink-0" />
        <span className="flex-1">{label}</span>
        <ArrowRight aria-hidden className="text-muted-foreground size-3.5" />
      </Link>
    </li>
  );
}

/** One clan, in full: war, open polls, the latest notices. */
function ClanPanel({
  loaded,
  myIds,
  canLead,
}: {
  loaded: LoadedClan;
  myIds: Set<string>;
  canLead: boolean;
}) {
  const { clan, war } = loaded;
  const base = `/${encodeURIComponent(clan.tag)}`;
  const accent = clanAccent(clan.id).color;
  const behind = loaded.fresh.level === "stale" || loaded.fresh.level === "failed";

  const myLeft = loaded.record
    .filter((r) => myIds.has(r.playerId))
    .reduce((sum, r) => sum + r.attacksRemaining, 0);
  const clanLeft = loaded.record.reduce((sum, r) => sum + r.attacksRemaining, 0);
  const inWar = war?.state === "inWar";

  // One filled "Answer" in the card, on the first poll still owed — a column
  // of identical bright buttons has no first thing to do.
  const firstOwed = loaded.openPolls.find(({ responders }) => !responders.some((id) => myIds.has(id)))
    ?.poll.id;

  // Facts as one quiet line under the name. Three boxes the size of the war
  // section made members, level and league look like the point of the card.
  const facts: Array<{ icon: LucideIcon; text: string }> = [
    { icon: Users, text: `${loaded.memberCount} ${loaded.memberCount === 1 ? "member" : "members"}` },
    ...(loaded.level ? [{ icon: Shield, text: `Level ${loaded.level}` }] : []),
    ...(loaded.warLeague ? [{ icon: Trophy, text: loaded.warLeague }] : []),
  ];

  return (
    <div aria-label={clan.name} className="space-y-6 p-5">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-4">
        {clan.badgeUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={clan.badgeUrl} alt="" className="size-14 shrink-0" />
        ) : (
          <span aria-hidden className="bg-muted flex size-14 items-center justify-center rounded-xl">
            <Shield className="text-muted-foreground size-6" />
          </span>
        )}
        <div className="min-w-0 flex-1 space-y-1">
          <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="text-xl font-semibold">{clan.name}</span>
            <span className="text-muted-foreground text-sm">
              <span className="font-mono">{clan.tag}</span> ·{" "}
              <span className="capitalize">{clan.role}</span>
            </span>
          </p>
          <ul className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            {facts.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-1.5">
                <Icon aria-hidden className="size-3.5 shrink-0" />
                <span className="text-foreground/90 font-medium tabular-nums">{text}</span>
              </li>
            ))}
            {behind && (
              <li>
                <Badge
                  variant="warning"
                  title={`Game data ${loaded.fresh.label} — numbers here may be out of date.`}
                >
                  <TriangleAlert aria-hidden />
                  Data {loaded.fresh.label}
                </Badge>
              </li>
            )}
          </ul>
        </div>
        <Button asChild variant="outline">
          <Link href={base}>
            Open clan
            <ArrowRight aria-hidden />
          </Link>
        </Button>
      </div>

      <div className="grid gap-x-8 gap-y-6 border-t pt-6 lg:grid-cols-2">
        <div className="min-w-0 space-y-6">
          {/* War */}
          <section aria-labelledby="war-title" className="space-y-3">
            <SectionHeader
              id="war-title"
              title="War"
              icon={Swords}
              action={{ href: `${base}/war`, label: "War board" }}
            />
            {war && isLive(war) ? (
              <div className="space-y-3">
                <WarScoreboard
                  us={{ name: clan.name, stars: war.ourStars, destruction: war.ourDestruction }}
                  them={{
                    name: war.opponentName,
                    stars: war.theirStars,
                    destruction: war.theirDestruction,
                  }}
                  accent={accent}
                />
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Badge variant={war.state === "inWar" ? "warning" : "info"}>
                    {war.state === "inWar" ? (
                      <>
                        <Flame aria-hidden />
                        Battle day
                      </>
                    ) : (
                      <>
                        <CalendarDays aria-hidden />
                        Preparation day
                      </>
                    )}
                  </Badge>
                  {inWar && war.endTime && timeUntil(war.endTime, new Date()) && (
                    <span className="text-muted-foreground">
                      Ends {timeUntil(war.endTime, new Date())}
                    </span>
                  )}
                  {inWar && myLeft > 0 && (
                    <span className="font-medium">
                      · You have {myLeft} {myLeft === 1 ? "attack" : "attacks"} left
                    </span>
                  )}
                  {inWar && canLead && clanLeft > 0 && (
                    <span className="text-muted-foreground">
                      · {clanLeft} unused in the clan
                    </span>
                  )}
                </div>
              </div>
            ) : (
              <div className="cb-sunken flex flex-wrap items-center justify-between gap-3 rounded-lg px-4 py-3">
                <p className="text-muted-foreground text-sm">
                  {war?.state === "warEnded"
                    ? `Last war against ${war.opponentName ?? "an opponent"}: ${war.ourStars ?? 0}–${war.theirStars ?? 0} stars${
                        war.result ? ` (${war.result === "win" ? "won" : war.result === "lose" ? "lost" : "tie"})` : ""
                      }.`
                    : "No war on right now."}
                </p>
                {canLead && (
                  <Button asChild size="sm" variant="outline">
                    <Link href={`${base}/war/lineup`}>Plan the next lineup</Link>
                  </Button>
                )}
              </div>
            )}
          </section>

          {/* Polls */}
          <section aria-labelledby="polls-title" className="space-y-3">
            <SectionHeader
              id="polls-title"
              title="Open polls"
              icon={Vote}
              count={loaded.openPolls.length}
              action={{ href: `${base}/polls`, label: "All polls" }}
            />
            {loaded.openPolls.length === 0 ? (
              <p className="text-muted-foreground text-sm">No poll is open.</p>
            ) : (
              <ul className="divide-y">
                {loaded.openPolls.map(({ poll, responders }) => {
                  const answered = responders.some((id) => myIds.has(id));
                  const closes = timeUntil(poll.closesAt, new Date());
                  const href = `${base}/polls/${encodeURIComponent(poll.id)}`;
                  return (
                    <ListRow
                      key={poll.id}
                      icon={answered ? CheckCircle2 : Vote}
                      tone={answered ? "var(--success)" : "var(--info)"}
                      title={poll.title}
                      meta={[
                        answered ? "You answered" : "You have not answered",
                        poll.scope === "family" ? "all clans" : null,
                        closes ? `closes ${closes}` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                      action={
                        answered
                          ? canLead
                            ? { href, label: "See answers" }
                            : { href, label: "View" }
                          : { href, label: "Answer", primary: poll.id === firstOwed }
                      }
                    />
                  );
                })}
              </ul>
            )}
          </section>
        </div>

        {/* Announcements */}
        <section aria-labelledby="notices-title" className="min-w-0 space-y-3">
          <SectionHeader
            id="notices-title"
            title="Announcements"
            icon={Megaphone}
            action={{ href: `${base}/notices`, label: "All notices" }}
          />
          {loaded.notices.length === 0 ? (
            <p className="text-muted-foreground text-sm">Nothing posted yet.</p>
          ) : (
            <ul className="space-y-3">
              {loaded.notices.map((notice) => (
                <li key={notice.id} className="cb-sunken space-y-1 rounded-lg px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium">{notice.title}</p>
                    {notice.pinned && <Badge variant="info">Pinned</Badge>}
                    <span className="text-muted-foreground ml-auto text-xs">
                      <LocalTime iso={notice.createdAt} style="date" />
                    </span>
                  </div>
                  {/* Plain text, as on the notices page — nothing here
                      interprets markup. Three lines, then "All notices". */}
                  <p className="text-muted-foreground line-clamp-3 text-sm whitespace-pre-line">
                    {notice.body}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {canLead && (
        <p className="text-muted-foreground border-t pt-4 text-xs">
          <Users aria-hidden className="mr-1 inline size-3.5 align-[-2px]" />
          You help run {clan.name}: leader tasks for it appear under Needs you.
        </p>
      )}
    </div>
  );
}
