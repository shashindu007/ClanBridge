// T12.10 — what the home page tells a member they need to do.
//
// PURE: no database, no clock except the one passed in. The dashboard fetches;
// this decides. Kept apart so the part a member actually acts on — which
// things surface, and in what order — is tested without a session.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE ORDER IS THE DESIGN
//
// A to-do list that puts a notice above an unused war attack is worse than no
// list: the member reads the first line, does it, and leaves. So urgency is
// fixed and deliberate, most time-critical first:
//
//   your attacks on battle day   the war ends and the attack is gone forever
//     (a regular war or today's CWL war — both are gone at the deadline)
//   polls you have not answered  a leader is waiting on you to size the war
//   your war starting soon       worth knowing, nothing to do yet
//   leader: attacks unused       chase people while there is still time
//   leader: poll non-responders
//   leader: accounts waiting
//   unread notifications         never urgent on its own; the rest may be
//
// A member sees only the items that are THEIRS — their own villages' attacks,
// polls in clans they belong to. Leader items appear only where the caller's
// role allows the action the item links to, so the list never offers a door
// the database will then refuse (error prevention, not just tidiness).
//
// clanStatus() is the other half: the one-line answer to "what is this clan
// doing right now" that each clan tile on Home leads with, as a ribbon. It
// reads the same inputs as needsYou(), so a tile and the to-do list below it
// can never disagree about whether you have an attack left.
// ─────────────────────────────────────────────────────────────────────────────

import type { ClanRole } from "@/types/domain";
import { isLeadership } from "@/lib/visibility";

export interface HomeClan {
  id: string;
  tag: string;
  name: string;
  role: ClanRole;
  /** The current or most recent war, or null. */
  war: {
    state: string | null;
    endTime: string | null;
    startTime: string | null;
    ourStars?: number | null;
    theirStars?: number | null;
    /** 'win' | 'lose' | 'tie', as the sync computes it. */
    result?: string | null;
  } | null;
  /** Everybody's war record for that war. Empty when there is no war. */
  warRecord: Array<{ playerId: string; attacksRemaining: number; attacksAllowed?: number }>;
  /**
   * CWL today — loaded only during CWL week. During CWL the regular war
   * endpoint reports `notInWar`, so without this a clan fighting its league
   * war read as idle on Home.
   */
  cwl?: HomeCwl | null;
  /**
   * OPEN polls only. `responders` is the player ids the caller can see answer:
   * their own for a member, everybody's for leadership (010's RLS asymmetry,
   * documented on responsesForPoll). Both uses below are correct under it.
   */
  openPolls: Array<{
    id: string;
    title: string;
    closesAt: string | null;
    responders: string[];
    /** A family poll is ONE poll asked of every clan (010), so it reaches here once per clan. */
    scope?: "clan" | "family";
  }>;
  memberCount: number;
  /**
   * The current members' player ids — loaded for clans the caller helps run,
   * where "who has not answered" is counted. Without it the count falls back to
   * memberCount minus responders, which is only right for a clan-scoped poll:
   * a family poll's responders span every clan.
   */
  memberIds?: string[];
}

export interface HomeCwl {
  /** 'YYYY-MM', for the link to the season page. */
  season: string;
  /**
   * Today's war day: the one on battle day, else the one in preparation. Null
   * before the group has formed.
   */
  war: {
    state: string | null;
    dayNumber: number | null;
    startTime: string | null;
    endTime: string | null;
  } | null;
  /** Today's battle-day roster with attacks left — one each in CWL. Empty unless inWar. */
  record: Array<{ playerId: string; attacksRemaining: number }>;
}

export interface NeedsYouInput {
  clans: HomeClan[];
  /** The caller's own villages, with the clan each is in. */
  myPlayers: Array<{ id: string; clanId: string | null }>;
  unread: number;
  /** Accounts waiting that THIS caller may approve — already scoped by admin_accounts(). */
  waitingAccounts: number;
  now?: Date;
}

export type NeedKind =
  | "war-attacks"
  | "cwl-attacks"
  | "poll"
  | "war-soon"
  | "lead-attacks"
  | "lead-poll"
  | "approvals"
  | "unread";

/** One clan an item concerns, with how many of the thing are in it when that varies. */
export interface NeedClan {
  id: string;
  name: string;
  count?: number;
}

export interface NeedItem {
  kind: NeedKind;
  /** The first clan in `clans`. Null for platform-wide items (approvals, unread). */
  clanId: string | null;
  clanName: string | null;
  /**
   * Every clan the item concerns. One for most items; several for a family
   * poll, which is one poll and therefore one row, not one row per clan.
   */
  clans: NeedClan[];
  title: string;
  meta: string | null;
  href: string;
  actionLabel: string;
  urgency: number;
}

const URGENCY: Record<NeedKind, number> = {
  "war-attacks": 100,
  "cwl-attacks": 100,
  poll: 80,
  "war-soon": 70,
  "lead-attacks": 50,
  "lead-poll": 40,
  approvals: 30,
  unread: 20,
};

/** "in 5h", "in 40m", "in 2d" — or null once the moment has passed. */
export function timeUntil(iso: string | null, now: Date): string | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - now.getTime();
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `in ${Math.max(1, minutes)}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `in ${hours}h`;
  return `in ${Math.round(hours / 24)}d`;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function needsYou(input: NeedsYouInput): NeedItem[] {
  const now = input.now ?? new Date();
  const mine = new Set(input.myPlayers.map((p) => p.id));
  const items: NeedItem[] = [];

  for (const clan of input.clans) {
    const base = `/${encodeURIComponent(clan.tag)}`;
    const leads = isLeadership(clan.role);
    const here = [{ id: clan.id, name: clan.name }];

    // ── War ────────────────────────────────────────────────────────────────
    if (clan.war?.state === "inWar") {
      const myLeft = clan.warRecord
        .filter((r) => mine.has(r.playerId))
        .reduce((sum, r) => sum + r.attacksRemaining, 0);
      const ends = timeUntil(clan.war.endTime, now);

      if (myLeft > 0) {
        items.push({
          kind: "war-attacks",
          clanId: clan.id,
          clanName: clan.name,
          clans: here,
          title: `You have ${plural(myLeft, "attack", "attacks")} left`,
          meta: ends ? `War ends ${ends}` : null,
          href: `${base}/war`,
          actionLabel: "Attack",
          urgency: URGENCY["war-attacks"],
        });
      }

      if (leads) {
        const clanLeft = clan.warRecord.reduce((sum, r) => sum + r.attacksRemaining, 0);
        if (clanLeft > 0) {
          items.push({
            kind: "lead-attacks",
            clanId: clan.id,
            clanName: clan.name,
            clans: here,
            title: `${plural(clanLeft, "attack", "attacks")} still unused`,
            meta: ends ? `War ends ${ends}` : null,
            href: `${base}/war`,
            actionLabel: "Open war board",
            urgency: URGENCY["lead-attacks"],
          });
        }
      }
    } else if (clan.war?.state === "preparation" && clan.warRecord.some((r) => mine.has(r.playerId))) {
      const starts = timeUntil(clan.war.startTime, now);
      items.push({
        kind: "war-soon",
        clanId: clan.id,
        clanName: clan.name,
        clans: here,
        title: "You are in the next war",
        meta: starts ? `Battle day starts ${starts}` : "Preparation day",
        href: `${base}/war`,
        actionLabel: "See the plan",
        urgency: URGENCY["war-soon"],
      });
    }

    // ── CWL: today's war day ───────────────────────────────────────────────
    // One attack each, gone at the day's deadline — the same urgency as a
    // regular war's, and it links to the season page, where the day is.
    const cwl = clan.cwl;
    if (cwl?.war?.state === "inWar") {
      const href = `${base}/cwl/${encodeURIComponent(cwl.season)}`;
      const day = cwl.war.dayNumber ? `CWL day ${cwl.war.dayNumber}` : "CWL";
      const ends = timeUntil(cwl.war.endTime, now);
      const myLeft = cwl.record
        .filter((r) => mine.has(r.playerId))
        .reduce((sum, r) => sum + r.attacksRemaining, 0);

      if (myLeft > 0) {
        items.push({
          kind: "cwl-attacks",
          clanId: clan.id,
          clanName: clan.name,
          clans: here,
          title: `${day}: you have ${plural(myLeft, "attack", "attacks")} left`,
          meta: ends ? `Day ends ${ends}` : null,
          href,
          actionLabel: "Attack",
          urgency: URGENCY["cwl-attacks"],
        });
      }

      if (leads) {
        const clanLeft = cwl.record.reduce((sum, r) => sum + r.attacksRemaining, 0);
        if (clanLeft > 0) {
          items.push({
            kind: "lead-attacks",
            clanId: clan.id,
            clanName: clan.name,
            clans: here,
            title: `${day}: ${plural(clanLeft, "attack", "attacks")} still unused`,
            meta: ends ? `Day ends ${ends}` : null,
            href,
            actionLabel: "Open the day",
            urgency: URGENCY["lead-attacks"],
          });
        }
      }
    }
  }

  items.push(...pollNeeds(input, mine, now));

  // ── Platform-wide ────────────────────────────────────────────────────────
  if (input.waitingAccounts > 0) {
    items.push({
      kind: "approvals",
      clanId: null,
      clanName: null,
      clans: [],
      title: `${plural(input.waitingAccounts, "account is", "accounts are")} waiting for approval`,
      meta: null,
      href: "/admin/members",
      actionLabel: "Review",
      urgency: URGENCY.approvals,
    });
  }

  if (input.unread > 0) {
    items.push({
      kind: "unread",
      clanId: null,
      clanName: null,
      clans: [],
      title: `${plural(input.unread, "unread notification", "unread notifications")}`,
      meta: null,
      href: "/notifications",
      actionLabel: "Open",
      urgency: URGENCY.unread,
    });
  }

  // Stable: equal urgency keeps clan order, which is tag order.
  return items
    .map((item, i) => ({ item, i }))
    .sort((a, b) => b.item.urgency - a.item.urgency || a.i - b.i)
    .map(({ item }) => item);
}

/**
 * Polls, ONE ROW PER POLL rather than one per clan.
 *
 * A family poll (every CWL availability poll) is a single row in `polls` that
 * pollsForClan() returns for every clan, so the per-clan loop above used to ask
 * a member with villages in four clans to answer the same poll four times —
 * four rows, four buttons, all opening the same page. Grouping by poll id makes
 * it one row naming the clans it concerns.
 *
 * Answers are per VILLAGE (the poll page asks each of yours), so the member row
 * stays until every one of your villages in those clans has answered — not
 * until the first one has.
 */
function pollNeeds(input: NeedsYouInput, mine: Set<string>, now: Date): NeedItem[] {
  const groups = new Map<string, { poll: HomeClan["openPolls"][number]; clans: HomeClan[] }>();
  for (const clan of input.clans) {
    for (const poll of clan.openPolls) {
      const group = groups.get(poll.id);
      if (group) group.clans.push(clan);
      else groups.set(poll.id, { poll, clans: [clan] });
    }
  }

  const items: NeedItem[] = [];
  for (const { poll, clans } of groups.values()) {
    const closes = timeUntil(poll.closesAt, now);
    const hrefIn = (clan: HomeClan) =>
      `/${encodeURIComponent(clan.tag)}/polls/${encodeURIComponent(poll.id)}`;
    // Leadership sees everybody's answers and a member only their own, so the
    // union across the clans' copies is the most the caller can see (010).
    const responders = new Set(clans.flatMap((c) => c.openPolls.find((p) => p.id === poll.id)!.responders));

    // ── Yours ──
    const pending = input.myPlayers.filter(
      (p) => !responders.has(p.id) && clans.some((c) => c.id === p.clanId),
    );
    if (pending.length > 0) {
      const owed = clans.filter((c) => pending.some((p) => p.clanId === c.id));
      items.push({
        kind: "poll",
        clanId: owed[0]!.id,
        clanName: owed[0]!.name,
        clans: owed.map((c) => ({ id: c.id, name: c.name })),
        title: `Answer: ${poll.title}`,
        meta:
          [closes ? `Closes ${closes}` : null, pending.length > 1 ? `${pending.length} villages to answer` : null]
            .filter(Boolean)
            .join(" · ") || null,
        href: hrefIn(owed[0]!),
        actionLabel: "Answer",
        urgency: URGENCY.poll,
      });
    }

    // ── Leadership: who has not answered, counted per clan ──
    const chase = clans
      .filter((c) => isLeadership(c.role))
      .map((c) => ({
        clan: c,
        missing: c.memberIds
          ? c.memberIds.filter((id) => !responders.has(id)).length
          : Math.max(0, c.memberCount - responders.size),
      }))
      .filter((x) => x.missing > 0);
    if (chase.length > 0) {
      const total = chase.reduce((sum, x) => sum + x.missing, 0);
      // The action goes where the most chasing is; the reminder is per clan.
      const worst = chase.reduce((a, b) => (b.missing > a.missing ? b : a));
      items.push({
        kind: "lead-poll",
        clanId: worst.clan.id,
        clanName: worst.clan.name,
        clans: chase.map((x) => ({ id: x.clan.id, name: x.clan.name, count: x.missing })),
        title: `${plural(total, "member hasn't", "members haven't")} answered ${poll.title}`,
        meta: closes ? `Closes ${closes}` : null,
        href: hrefIn(worst.clan),
        actionLabel: "See answers",
        urgency: URGENCY["lead-poll"],
      });
    }
  }
  return items;
}

export type StatusKind = "cwl" | "war" | "cwl-prep" | "prep" | "signup" | "result" | "idle";

export interface ClanStatus {
  kind: StatusKind;
  /** The ribbon's colour — decoration; `label` carries the meaning. */
  tone: "war" | "prep" | "cwl" | "neutral";
  /** In capitals, for the ribbon: "WAR · 12h", "CWL DAY 3 · 8h", "WON 32–28". */
  label: string;
  /**
   * The caller's own attacks in the war the ribbon is about — left and allowed,
   * summed over their villages in it. Null when none of their villages is in it.
   */
  mine: { left: number; allowed: number } | null;
  /** Where "go and do it" leads: the war board or the CWL season. */
  href: string;
}

/** "12h", "40m", "2d" — timeUntil without the "in". */
function shortly(iso: string | null, now: Date): string | null {
  return timeUntil(iso, now)?.replace(/^in /, "") ?? null;
}

function tally(
  record: Array<{ playerId: string; attacksRemaining: number; attacksAllowed?: number }>,
  mine: ReadonlySet<string>,
  perHead: number,
): ClanStatus["mine"] {
  const rows = record.filter((r) => mine.has(r.playerId));
  if (rows.length === 0) return null;
  return {
    left: rows.reduce((sum, r) => sum + r.attacksRemaining, 0),
    allowed: rows.reduce((sum, r) => sum + (r.attacksAllowed ?? perHead), 0),
  };
}

const RESULT_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * What one clan is doing right now, as the ribbon on its Home tile.
 *
 * ONE STATE WINS, most pressing first: a CWL battle day, a regular battle day,
 * CWL preparation, regular preparation, CWL sign-up, a war that ended in the
 * last day (its result), and otherwise nothing. CWL outranks a regular war
 * because during CWL week the regular endpoint is `notInWar` anyway; if both
 * ever read as live, the league war is the one with a daily deadline.
 */
export function clanStatus(
  clan: HomeClan,
  myPlayerIds: ReadonlySet<string>,
  now: Date,
  cwlPhase: "signup" | "wars" | null = null,
): ClanStatus {
  const base = `/${encodeURIComponent(clan.tag)}`;
  const cwl = clan.cwl ?? null;
  const cwlHref = cwl ? `${base}/cwl/${encodeURIComponent(cwl.season)}` : `${base}/cwl`;
  const day = cwl?.war?.dayNumber ? `CWL DAY ${cwl.war.dayNumber}` : "CWL";
  const withTime = (label: string, t: string | null) => (t ? `${label} · ${t}` : label);

  if (cwl?.war?.state === "inWar") {
    return {
      kind: "cwl",
      tone: "cwl",
      label: withTime(day, shortly(cwl.war.endTime, now)),
      mine: tally(cwl.record, myPlayerIds, 1),
      href: cwlHref,
    };
  }

  if (clan.war?.state === "inWar") {
    return {
      kind: "war",
      tone: "war",
      label: withTime("WAR", shortly(clan.war.endTime, now)),
      mine: tally(clan.warRecord, myPlayerIds, 2),
      href: `${base}/war`,
    };
  }

  if (cwl?.war?.state === "preparation") {
    return {
      kind: "cwl-prep",
      tone: "cwl",
      label: withTime(`${day} PREP`, shortly(cwl.war.startTime, now)),
      mine: null,
      href: cwlHref,
    };
  }

  if (clan.war?.state === "preparation") {
    return {
      kind: "prep",
      tone: "prep",
      label: withTime("PREP", shortly(clan.war.startTime, now)),
      mine: tally(clan.warRecord, myPlayerIds, 2),
      href: `${base}/war`,
    };
  }

  if (cwlPhase === "signup") {
    return { kind: "signup", tone: "cwl", label: "CWL SIGN-UP", mine: null, href: cwlHref };
  }

  const ended = clan.war?.state === "warEnded" && clan.war.endTime
    ? now.getTime() - new Date(clan.war.endTime).getTime()
    : Number.POSITIVE_INFINITY;
  if (clan.war && ended >= 0 && ended < RESULT_WINDOW_MS) {
    const word = clan.war.result === "win" ? "WON" : clan.war.result === "lose" ? "LOST" : "DRAW";
    const score =
      clan.war.ourStars != null && clan.war.theirStars != null
        ? ` ${clan.war.ourStars}–${clan.war.theirStars}`
        : "";
    return { kind: "result", tone: "neutral", label: `${word}${score}`, mine: null, href: `${base}/war` };
  }

  return { kind: "idle", tone: "neutral", label: "NO WAR", mine: null, href: `${base}/war` };
}

/** How many items belong to each clan — the badge on each clan tab. */
export function countsByClan(items: NeedItem[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    for (const clan of item.clans) counts.set(clan.id, (counts.get(clan.id) ?? 0) + 1);
  }
  return counts;
}
