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
import { activeMembers, unreadCount } from "@/repositories/notifications";
import { adminAccounts } from "@/repositories/accounts";
import { isOpen } from "@/services/polls";
import { warRecord, type MemberWarRecord } from "@/services/war";
import { freshness, type Freshness } from "@/services/freshness";
import { countsByClan, needsYou, timeUntil, type NeedItem, type NeedKind } from "@/services/home";
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
  const [detail, held, run, war, polls, notices] = await Promise.all([
    clanDetail(supabase, clan.id),
    currentMemberCount(supabase, clan.id),
    latestRun(supabase, "clans", clan.id),
    currentWar(supabase, clan.id),
    pollsForClan(supabase, clan.id),
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
    openPolls: open.map((poll, i) => ({
      poll,
      responders: responses[i]!.map((r) => r.playerId),
    })),
    notices: notices.slice(0, 2),
  };
}

/** Icon and hue for each kind of to-do. Status hues only where the row IS one. */
const KIND_STYLE: Record<NeedKind, { icon: LucideIcon; tone: string }> = {
  "war-attacks": { icon: Flame, tone: "var(--warning)" },
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
      })),
      memberCount: l.memberCount,
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

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-4 sm:p-8">
      <div className="space-y-1">
        <h1 className="cb-title text-3xl sm:text-4xl">Welcome back, {name}</h1>
        <p className="text-muted-foreground">{summary}</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="min-w-0 space-y-6">
          {/* ── Needs you ─────────────────────────────────────────────── */}
          <Panel aria-labelledby="needs-title" className="space-y-4">
            <SectionHeader id="needs-title" title="Needs you" count={items.length} />
            {items.length === 0 ? (
              <EmptyState
                icon={CheckCircle2}
                title="You're all caught up"
                body="No war attacks waiting, no polls to answer, nothing unread."
              />
            ) : (
              <ul className="divide-y">
                {items.map((item: NeedItem, i) => {
                  const style = KIND_STYLE[item.kind];
                  return (
                    <ListRow
                      key={`${item.kind}-${item.clanId ?? "all"}-${i}`}
                      icon={style.icon}
                      tone={style.tone}
                      context={item.clanName ?? undefined}
                      title={item.title}
                      meta={item.meta ?? undefined}
                      action={{ href: item.href, label: item.actionLabel, primary: i === 0 }}
                    />
                  );
                })}
              </ul>
            )}
          </Panel>

          {/* ── Clans ─────────────────────────────────────────────────── */}
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

              <nav aria-label="Choose a clan" className="cb-scroll-x -mx-1 flex gap-2 px-1 pb-1">
                {loaded.map(({ clan }) => {
                  const on = selected?.clan.id === clan.id;
                  const count = perClan.get(clan.id) ?? 0;
                  return (
                    <Link
                      key={clan.id}
                      href={`/dashboard?clan=${encodeURIComponent(clan.tag)}`}
                      aria-current={on ? "page" : undefined}
                      scroll={false}
                      className={`flex shrink-0 items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
                        on
                          ? "cb-panel border-trim font-semibold"
                          : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                      }`}
                    >
                      <span
                        aria-hidden
                        className="size-2.5 shrink-0 rounded-full"
                        style={{ background: clanAccent(clan.id).color }}
                      />
                      {clan.name}
                      {count > 0 && (
                        <span className="bg-info-tint text-info-ink rounded-full px-1.5 text-xs font-semibold tabular-nums">
                          {count}
                          <span className="sr-only"> {count === 1 ? "thing needs" : "things need"} you</span>
                        </span>
                      )}
                    </Link>
                  );
                })}
              </nav>

              {selected && (
                <ClanPanel
                  loaded={selected}
                  myIds={myIds}
                  canLead={isLeadership(selected.clan.role)}
                />
              )}
            </section>
          )}
        </div>

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
    </main>
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

  return (
    <Panel padded={false} aria-label={clan.name} className="overflow-hidden">
      {/* The clan's own colour along the top edge — the same hue as its tab. */}
      <div aria-hidden className="h-1.5" style={{ background: accent }} />

      <div className="space-y-6 p-5">
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
          <div className="min-w-0 flex-1">
            <p className="text-xl font-semibold">{clan.name}</p>
            <p className="text-muted-foreground text-sm">
              <span className="font-mono">{clan.tag}</span> · you are{" "}
              <span className="capitalize">{clan.role}</span>
            </p>
          </div>
          <Button asChild>
            <Link href={base}>
              Open clan
              <ArrowRight aria-hidden />
            </Link>
          </Button>
        </div>

        {/* Three plain facts, label above value — no table, nothing to align. */}
        <dl className="grid grid-cols-3 gap-3">
          <Fact label="Members" value={String(loaded.memberCount)} />
          <Fact label="Clan level" value={loaded.level ? String(loaded.level) : "—"} />
          <Fact label="War league" value={loaded.warLeague ?? "—"} />
        </dl>

        {behind && (
          <p className="text-warning-ink flex items-center gap-2 text-sm">
            <TriangleAlert aria-hidden className="size-4 shrink-0" />
            Game data {loaded.fresh.label} — numbers here may be out of date.
          </p>
        )}

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
            <div className="flex flex-wrap items-center justify-between gap-3">
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
                    meta={[answered ? "You answered" : "You have not answered", closes ? `closes ${closes}` : null]
                      .filter(Boolean)
                      .join(" · ")}
                    action={
                      answered
                        ? canLead
                          ? { href, label: "See answers" }
                          : { href, label: "View" }
                        : { href, label: "Answer", primary: true }
                    }
                  />
                );
              })}
            </ul>
          )}
        </section>

        {/* Announcements */}
        <section aria-labelledby="notices-title" className="space-y-3">
          <SectionHeader
            id="notices-title"
            title="Announcements"
            icon={Megaphone}
            action={{ href: `${base}/notices`, label: "All notices" }}
          />
          {loaded.notices.length === 0 ? (
            <p className="text-muted-foreground text-sm">Nothing posted yet.</p>
          ) : (
            <ul className="space-y-4">
              {loaded.notices.map((notice) => (
                <li key={notice.id} className="space-y-1">
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

        {canLead && (
          <p className="text-muted-foreground border-t pt-4 text-xs">
            <Users aria-hidden className="mr-1 inline size-3.5 align-[-2px]" />
            You help run {clan.name}: leader tasks for it appear under Needs you.
          </p>
        )}
      </div>
    </Panel>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="cb-sunken min-w-0 rounded-lg px-3 py-2">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="truncate font-semibold tabular-nums" title={value}>
        {value}
      </dd>
    </div>
  );
}
