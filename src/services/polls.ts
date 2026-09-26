// T4B.4 — what a poll actually tells you.
//
// The headline function is nonResponders(). IMPLEMENTATION.md is explicit about
// why: "Critically, also the list of who has not answered — that is the list the
// leader chases."
//
// Counts are the easy half and every polling tool shows them. The useful half is
// the absence: thirty members, eighteen answers, and the question is which
// twelve. That list cannot come from poll_responses, because the people on it
// have no row there — it is eligible members MINUS respondents, the same
// anti-join shape as missed CWL attacks.

import type { Poll, PollCount, PollOption, PollResponse } from "@/repositories/polls";

export interface Respondent {
  playerId: string;
  tag: string;
  name: string;
  optionId: string;
  optionLabel: string;
  note: string | null;
  respondedAt: string;
  /** Set only when they changed their mind — a late flip a leader should see. */
  changedAt: string | null;
}

export interface EligibleMember {
  playerId: string;
  tag: string;
  name: string;
}

export interface PollBreakdown {
  answered: Respondent[];
  /** THE LIST THE LEADER CHASES. */
  notAnswered: EligibleMember[];
  totalEligible: number;
}

/**
 * Split the eligible members into answered and not.
 *
 * `eligible` is passed in rather than derived here because who *should* answer
 * differs by scope: a clan poll asks one clan, a family poll asks all three.
 * Deciding that inside this function would mean it needed a database.
 */
export function pollBreakdown(
  eligible: EligibleMember[],
  responses: PollResponse[],
  options: PollOption[],
): PollBreakdown {
  const labelById = new Map(options.map((o) => [o.id, o.label]));
  const byPlayer = new Map(responses.map((r) => [r.playerId, r]));

  const answered: Respondent[] = [];
  const notAnswered: EligibleMember[] = [];

  for (const member of eligible) {
    const response = byPlayer.get(member.playerId);
    if (!response) {
      notAnswered.push(member);
      continue;
    }
    answered.push({
      playerId: member.playerId,
      tag: member.tag,
      name: member.name,
      optionId: response.optionId,
      optionLabel: labelById.get(response.optionId) ?? "Unknown",
      note: response.note,
      respondedAt: response.respondedAt,
      // updated_at is only set by the trigger on a real UPDATE, so its presence
      // IS the "they changed their mind" signal (T4B.3).
      changedAt: response.updatedAt,
    });
  }

  // Most recent answer first: while a poll is open, what changed is the news.
  answered.sort((a, b) => (a.respondedAt < b.respondedAt ? 1 : -1));
  notAnswered.sort((a, b) => a.name.localeCompare(b.name));

  return { answered, notAnswered, totalEligible: eligible.length };
}

/** Just the chase list, for callers that want nothing else. */
/**
 * The caller's villages that may answer this poll.
 *
 * A family poll (CWL availability) asks every clan, so every village. A clan
 * poll asks ONE clan, so only villages in it. The page used to offer them all:
 * a member with a village in each clan was told "1 of 2 still to answer" on
 * clan A's war poll, and answering with the clan B village added to A's "In"
 * count — the number the war lineup is sized from. 046 enforces the same rule
 * in the database; this is what keeps the page from offering what it refuses.
 */
export function villagesFor<T extends { clanId: string | null }>(
  poll: Pick<Poll, "scope" | "clanId">,
  mine: readonly T[],
): T[] {
  if (poll.scope === "family") return [...mine];
  return mine.filter((p) => p.clanId !== null && p.clanId === poll.clanId);
}

/**
 * Which of the caller's villages the answer form is showing.
 *
 * ONE FORM, NOT ONE PER VILLAGE. A member with three bases used to get three
 * full answer forms stacked down the page — three sets of In / Out / Maybe,
 * three note boxes, three Save buttons — and could not tell at a glance which
 * were done. Now the page shows a row of village chips and one form, for the
 * village asked for (`?base=`), else the first still unanswered, else the
 * first. So a member arriving to answer lands on exactly the one they owe.
 */
export function chooseBase<T extends { id: string }>(
  players: readonly T[],
  answered: ReadonlySet<string>,
  requested?: string | null,
): T | null {
  if (players.length === 0) return null;
  return (
    players.find((p) => p.id === requested) ??
    players.find((p) => !answered.has(p.id)) ??
    players[0]!
  );
}

/**
 * The next village still to answer after `current`, in list order and
 * wrapping round; null once every one has answered. Saving an answer moves the
 * form here, so three villages are three taps of Save rather than three hunts.
 */
export function nextUnanswered<T extends { id: string }>(
  players: readonly T[],
  answered: ReadonlySet<string>,
  current: string,
): T | null {
  const at = players.findIndex((p) => p.id === current);
  const order = at < 0 ? players : [...players.slice(at + 1), ...players.slice(0, at)];
  return order.find((p) => p.id !== current && !answered.has(p.id)) ?? null;
}

export function nonResponders(
  eligible: EligibleMember[],
  responses: PollResponse[],
): EligibleMember[] {
  return pollBreakdown(eligible, responses, []).notAnswered;
}

/**
 * Is this poll accepting answers right now?
 *
 * Mirrors the WITH CHECK in 010's insert policy. Kept in step deliberately: the
 * database is what enforces it, and this exists only so the form can disable a
 * button rather than let someone type an answer that will be rejected.
 */
export function isOpen(poll: Poll, now: Date = new Date()): boolean {
  if (poll.status !== "open") return false;
  if (poll.closesAt && new Date(poll.closesAt) <= now) return false;
  if (poll.opensAt && new Date(poll.opensAt) > now) return false;
  return true;
}

/**
 * The war availability poll a leader should size the next war from (T6.7).
 *
 * OPEN ones only, and that is the whole point. `pollsForClan` filters on
 * `deleted_at` alone, so the newest war_availability poll it returns is very
 * often last war's, closed days ago. Sizing a war from those answers is the
 * exact failure T6.7 exists to prevent — worse than having no poll at all,
 * because a stale count looks like a fresh one and nothing on the page says
 * which it is.
 *
 * Null when none is open. The lineup page's "you are picking blind" branch is
 * the honest answer there.
 *
 * Takes the list newest-first, as `pollsForClan` returns it, and keeps that
 * order: with two open polls the newer one is the one being answered now.
 */
export function openWarAvailabilityPoll(polls: Poll[], now: Date = new Date()): Poll | null {
  return polls.find((p) => p.pollType === "war_availability" && isOpen(p, now)) ?? null;
}

/** Percentage per option, for the bar a member sees. Empty poll gives zeroes. */
export function optionShare(counts: PollCount[]): Array<PollCount & { share: number }> {
  const total = counts.reduce((sum, c) => sum + c.votes, 0);
  return counts.map((c) => ({
    ...c,
    share: total === 0 ? 0 : Math.round((c.votes / total) * 100),
  }));
}

/**
 * The CWL availability template (T4B.2).
 *
 * "Maybe" earns its place: forcing a binary answer from someone who does not yet
 * know pushes them to guess, and a wrong In is worse for the leader than an
 * honest Maybe — it fills a roster slot that then goes unused.
 */
export const CWL_AVAILABILITY_OPTIONS = ["In", "Out", "Maybe"] as const;

export const POLL_TEMPLATES: Record<string, { title: string; options: string[] }> = {
  cwl_availability: {
    title: "CWL availability",
    options: [...CWL_AVAILABILITY_OPTIONS],
  },
  war_availability: {
    title: "War availability",
    options: ["In", "Out"],
  },
  general: {
    title: "",
    options: ["Yes", "No"],
  },
};
