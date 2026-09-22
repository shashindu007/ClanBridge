// T12.6 — home. Where every member lands after signing in.
//
// Login used to redirect to `clans[0]` — whichever clan sorts first by tag —
// so a leader of three clans always landed in the same one and had to switch
// out of it to reach the others, and nothing anywhere showed the clans side by
// side. This page is the choice instead of the assumption: every clan the
// member belongs to as a card, what needs their attention across all of them,
// and one click into whichever clan they came for.
//
// ONE ROUND TRIP'S WORTH OF LATENCY. Every clan's six reads, plus the feed,
// the people list and the waiting count, go out in a single Promise.all — a
// leader of three clans pays for the slowest read, not the sum of twenty.
// Per-war attack detail is deliberately NOT fetched here: the card says a war
// is on and the score, and the war board is one click away for the rest.
//
// R3 — clans come from visibleClans(), the member's own clan_roles, never from
// a list. Every repository call below takes that clan's id and filters on it.
//
// ACCESSIBILITY: one h1, an h2 per region, each clan card is a single link
// whose accessible name is the clan's name, and status is always a word beside
// any colour.

import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowRight,
  Bell,
  CalendarDays,
  ClipboardList,
  Activity,
  Flame,
  Megaphone,
  MessageSquareHeart,
  Plus,
  ShieldCheck,
  Swords,
  Trophy,
  UserCheck,
  Users,
  Vote,
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
import { LocalTime } from "@/components/local-time";
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

/** War state as a word first and a colour second. */
function WarLine({ war }: { war: WarRow | null }) {
  if (!war || (war.state !== "preparation" && war.state !== "inWar")) {
    return (
      <span className="text-muted-foreground flex items-center gap-1.5">
        <Swords aria-hidden className="size-3.5" />
        No war on
      </span>
    );
  }

  const score =
    war.ourStars !== null && war.theirStars !== null
      ? ` · ${war.ourStars}–${war.theirStars} stars`
      : "";

  return war.state === "preparation" ? (
    <span className="flex items-center gap-1.5">
      <CalendarDays aria-hidden className="text-info size-3.5" />
      Preparation day{war.opponentName ? ` vs ${war.opponentName}` : ""}
    </span>
  ) : (
    <span className="flex items-center gap-1.5 font-medium">
      <Flame aria-hidden className="text-warning size-3.5" />
      Battle day{score}
    </span>
  );
}

function ClanCard({ summary }: { summary: ClanSummary }) {
  const { clan } = summary;
  const base = `/${encodeURIComponent(clan.tag)}`;
  const accent = clanAccent(clan.id).color;
  const stale = summary.fresh.level === "stale" || summary.fresh.level === "failed";

  return (
    <li className="cb-panel relative flex flex-col overflow-hidden rounded-xl border">
      {/* The clan's colour, the same one the rail pill uses, so a leader of
          three clans recognises each card before reading its name. */}
      <span aria-hidden className="h-1.5 w-full" style={{ background: accent }} />

      <div className="flex flex-1 flex-col gap-4 p-5">
        <div className="flex items-start gap-3">
          {clan.badgeUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={clan.badgeUrl} alt="" className="size-11 shrink-0" />
          ) : (
            <span className="bg-muted size-11 shrink-0 rounded-lg" aria-hidden />
          )}
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-lg font-semibold">
              {/* The whole card is this link — the ::after overlay stretches it
                  across the card — so there is one tab stop and one accessible
                  name per clan instead of a card full of nested links. */}
              <Link
                href={base}
                className="after:absolute after:inset-0 after:content-[''] focus-visible:outline-none after:focus-visible:rounded-xl after:focus-visible:ring-[3px] after:focus-visible:ring-ring/50"
              >
                {clan.name}
              </Link>
            </h3>
            <p className="text-muted-foreground flex flex-wrap items-center gap-x-2 text-xs">
              <span className="font-mono">{clan.tag}</span>
              <span aria-hidden>·</span>
              <span className="capitalize">{clan.role}</span>
            </p>
          </div>
        </div>

        <dl className="grid grid-cols-3 gap-2 text-center">
          <div className="bg-muted/50 rounded-md p-2">
            <dt className="text-muted-foreground text-[0.7rem] uppercase">Members</dt>
            <dd className="font-semibold tabular-nums">{summary.memberCount}</dd>
          </div>
          <div className="bg-muted/50 rounded-md p-2">
            <dt className="text-muted-foreground text-[0.7rem] uppercase">Level</dt>
            <dd className="font-semibold tabular-nums">{summary.level ?? "—"}</dd>
          </div>
          <div className="bg-muted/50 rounded-md p-2">
            <dt className="text-muted-foreground text-[0.7rem] uppercase">League</dt>
            <dd className="truncate text-sm font-semibold" title={summary.warLeague ?? undefined}>
              {summary.warLeague?.replace(/ League/, "") ?? "—"}
            </dd>
          </div>
        </dl>

        <ul className="space-y-1.5 text-sm">
          <li>
            <WarLine war={summary.war} />
          </li>
          {summary.pollTitle && (
            <li className="flex items-center gap-1.5">
              <Vote aria-hidden className="text-info size-3.5 shrink-0" />
              <span className="truncate">Poll open: {summary.pollTitle}</span>
            </li>
          )}
          {summary.noticeTitle && (
            <li className="text-muted-foreground flex items-center gap-1.5">
              <Megaphone aria-hidden className="size-3.5 shrink-0" />
              <span className="truncate">{summary.noticeTitle}</span>
            </li>
          )}
        </ul>

        <div className="mt-auto flex items-center justify-between gap-2 border-t pt-3 text-xs">
          <span className={stale ? "text-warning-ink font-medium" : "text-muted-foreground"}>
            Data {summary.fresh.label}
          </span>
          {/* Above the card's stretched link (relative z-10), so these two
              remain their own targets rather than opening the overview. */}
          <span className="relative z-10 flex gap-1">
            <Link
              href={`${base}/war`}
              className="hover:bg-accent rounded px-2 py-1 font-medium transition-colors"
            >
              War
            </Link>
            <Link
              href={`${base}/cwl`}
              className="hover:bg-accent rounded px-2 py-1 font-medium transition-colors"
            >
              CWL
            </Link>
          </span>
        </div>
      </div>
    </li>
  );
}

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
    <section aria-labelledby={id} className="cb-panel space-y-3 rounded-xl border p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 id={id} className="font-semibold">{title}</h2>
        {href && (
          <Link href={href} className="text-primary text-sm hover:underline">
            {linkLabel}
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}

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
    feedFor(supabase, userId, 3),
    // The real count, not the unread among the three shown — a member with
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

  const summaryLine = [
    `${clans.length} ${clans.length === 1 ? "clan" : "clans"}`,
    presence.onlineNow > 0 ? `${presence.onlineNow} online now` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <main className="mx-auto max-w-7xl space-y-8 p-4 sm:p-8">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Welcome back, {name}</h1>
        <p className="text-muted-foreground">{summaryLine}</p>
      </div>

      {/* ── What needs you. Only rendered when something does. ─────────── */}
      {(waiting > 0 || unread > 0) && (
        <section aria-label="Needs your attention" className="flex flex-wrap gap-3">
          {waiting > 0 && (
            <Link
              href="/admin/members"
              className="cb-panel cb-panel-interactive flex items-center gap-3 rounded-xl border px-4 py-3"
            >
              <UserCheck aria-hidden className="text-info size-5" />
              <span className="text-sm">
                <strong>{waiting}</strong>{" "}
                {waiting === 1 ? "account is" : "accounts are"} waiting for approval
              </span>
              <ArrowRight aria-hidden className="text-muted-foreground size-4" />
            </Link>
          )}
          {unread > 0 && (
            <Link
              href="/notifications"
              className="cb-panel cb-panel-interactive flex items-center gap-3 rounded-xl border px-4 py-3"
            >
              <Bell aria-hidden className="text-info size-5" />
              <span className="text-sm">
                <strong>{unread}</strong> unread {unread === 1 ? "notification" : "notifications"}
              </span>
              <ArrowRight aria-hidden className="text-muted-foreground size-4" />
            </Link>
          )}
        </section>
      )}

      <div className="grid gap-8 lg:grid-cols-[1fr_20rem]">
        {/* ── Your clans ──────────────────────────────────────────────── */}
        <section aria-labelledby="clans-title" className="space-y-4">
          <h2 id="clans-title" className="text-lg font-semibold">
            Your clans
          </h2>

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
            <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {summaries.map((summary) => (
                <ClanCard key={summary.clan.id} summary={summary} />
              ))}
            </ul>
          )}
        </section>

        {/* ── The side column ─────────────────────────────────────────── */}
        <div className="space-y-4">
          <Panel title="Latest notifications" href="/notifications" linkLabel="All">
            {feed.length === 0 ? (
              <p className="text-muted-foreground text-sm">Nothing yet.</p>
            ) : (
              <ul className="space-y-3">
                {feed.map((item) => (
                  <li key={item.id} className="space-y-0.5">
                    <p className={`text-sm ${item.readAt ? "" : "font-medium"}`}>
                      {!item.readAt && <span className="sr-only">Unread: </span>}
                      {item.title}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      <LocalTime iso={item.createdAt} />
                    </p>
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
                    <span className="truncate">{person.username ?? person.displayName ?? "Someone"}</span>
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

          <Panel title="Quick links">
            <ul className="grid grid-cols-2 gap-2 text-sm">
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
            className="cb-panel cb-panel-interactive flex items-center gap-3 rounded-xl border p-5"
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
        className="hover:bg-accent hover:text-accent-foreground flex items-center gap-2 rounded-md border px-3 py-2 transition-colors"
      >
        <Icon aria-hidden className="text-muted-foreground size-4 shrink-0" />
        <span className="truncate">{label}</span>
      </Link>
    </li>
  );
}
