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
// ─────────────────────────────────────────────────────────────────────────────

import type { ClanRole } from "@/types/domain";
import { isLeadership } from "@/lib/visibility";

export interface HomeClan {
  id: string;
  tag: string;
  name: string;
  role: ClanRole;
  /** The current or most recent war, or null. */
  war: { state: string | null; endTime: string | null; startTime: string | null } | null;
  /** Everybody's war record for that war. Empty when there is no war. */
  warRecord: Array<{ playerId: string; attacksRemaining: number }>;
  /**
   * OPEN polls only. `responders` is the player ids the caller can see answer:
   * their own for a member, everybody's for leadership (010's RLS asymmetry,
   * documented on responsesForPoll). Both uses below are correct under it.
   */
  openPolls: Array<{ id: string; title: string; closesAt: string | null; responders: string[] }>;
  memberCount: number;
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
  | "poll"
  | "war-soon"
  | "lead-attacks"
  | "lead-poll"
  | "approvals"
  | "unread";

export interface NeedItem {
  kind: NeedKind;
  /** Null for platform-wide items (approvals, unread). */
  clanId: string | null;
  clanName: string | null;
  title: string;
  meta: string | null;
  href: string;
  actionLabel: string;
  urgency: number;
}

const URGENCY: Record<NeedKind, number> = {
  "war-attacks": 100,
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
    const iAmHere = input.myPlayers.some((p) => p.clanId === clan.id);

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
        title: "You are in the next war",
        meta: starts ? `Battle day starts ${starts}` : "Preparation day",
        href: `${base}/war`,
        actionLabel: "See the plan",
        urgency: URGENCY["war-soon"],
      });
    }

    // ── Polls ──────────────────────────────────────────────────────────────
    for (const poll of clan.openPolls) {
      const closes = timeUntil(poll.closesAt, now);
      const answered = poll.responders.some((id) => mine.has(id));

      if (iAmHere && !answered) {
        items.push({
          kind: "poll",
          clanId: clan.id,
          clanName: clan.name,
          title: `Answer: ${poll.title}`,
          meta: closes ? `Closes ${closes}` : null,
          href: `${base}/polls/${encodeURIComponent(poll.id)}`,
          actionLabel: "Answer",
          urgency: URGENCY.poll,
        });
      }

      if (leads) {
        const missing = clan.memberCount - new Set(poll.responders).size;
        if (missing > 0) {
          items.push({
            kind: "lead-poll",
            clanId: clan.id,
            clanName: clan.name,
            title: `${plural(missing, "member hasn't", "members haven't")} answered ${poll.title}`,
            meta: closes ? `Closes ${closes}` : null,
            href: `${base}/polls/${encodeURIComponent(poll.id)}`,
            actionLabel: "See answers",
            urgency: URGENCY["lead-poll"],
          });
        }
      }
    }
  }

  // ── Platform-wide ────────────────────────────────────────────────────────
  if (input.waitingAccounts > 0) {
    items.push({
      kind: "approvals",
      clanId: null,
      clanName: null,
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

/** How many items belong to each clan — the badge on each clan tab. */
export function countsByClan(items: NeedItem[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    if (item.clanId) counts.set(item.clanId, (counts.get(item.clanId) ?? 0) + 1);
  }
  return counts;
}
