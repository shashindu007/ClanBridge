// T4B.3, T4B.4 — Polls
//
// A clan sees its own polls and every family-scoped one. A CWL availability poll
// is family-scoped, because the leader picks across all clans at once (T4B.7) —
// so the poll a member most needs to answer is the one that does not belong to
// their clan at all. Filtering on clan_id alone would hide exactly that.
//
// Each open poll is ONE ROW WITH ONE ACTION (kit ListRow): "Answer" on a poll
// you still owe — gold on the first, the page's one call to action — "View" on
// one you have answered. An unanswered poll used to wear a red "not answered"
// badge, the product's colour for "this is broken", for what is only a to-do.
// Closed polls fold, with their count showing.
//
// R11 — HUMAN DECISION DATA. No sync job writes here.

import Link from "next/link";
import { CheckCircle2, Vote } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { Disclosure, EmptyState, ListRow, Panel, SectionHeader } from "@/components/kit";
import { requireClanByTag } from "@/lib/clans";
import { isLeadership } from "@/lib/visibility";
import { currentUserId } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { myPlayers, pollsForClan, responsesForPoll } from "@/repositories/polls";
import { isOpen } from "@/services/polls";

export const dynamic = "force-dynamic";

/**
 * How long a poll has left, in words.
 *
 * ROUNDING HAPPENS ONCE, AT THE END, and the singular is branched on rather
 * than assumed. Both were wrong here. `Math.round` ran first, so 23.6 hours
 * became 24, failed the `< 24` test, and divided back down to a bare 1 —
 * printing "closes in 1 days" for every poll closing between roughly 23 and 36
 * hours away. The hour branch had the same fault: anything from half an hour to
 * ninety minutes read "closes in 1 hours".
 *
 * services/members.ts branches on `=== 1` eight lines from a similar string and
 * services/freshness.ts's ago() handles every singular case, so this was a seam
 * rather than a house style.
 */
function closesLabel(closesAt: string | null): string {
  if (!closesAt) return "no closing date";

  const hours = (new Date(closesAt).getTime() - Date.now()) / 3_600_000;
  if (hours < 0) return "closed";
  if (hours < 1) return "closes within the hour";

  // Compared on the unrounded value, so the branch and the number shown can
  // never disagree about which unit this is.
  if (hours < 24) {
    const whole = Math.round(hours);
    return `closes in ${whole} ${whole === 1 ? "hour" : "hours"}`;
  }

  const days = Math.round(hours / 24);
  return `closes in ${days} ${days === 1 ? "day" : "days"}`;
}

export default async function PollsPage({
  params,
}: {
  params: Promise<{ clanTag: string }>;
}) {
  const { clanTag } = await params;
  const supabase = await createClient();

  const clan = await requireClanByTag(supabase, clanTag);
  const userId = await currentUserId(supabase);

  const polls = await pollsForClan(supabase, clan.id);
  const mine = userId ? await myPlayers(supabase, userId) : [];
  const myPlayerIds = new Set(mine.map((p) => p.id));

  // Answered means answered for EVERY account this member owns. Someone with two
  // villages has two answers to give, and treating one as done would drop the
  // reminder while an account is still outstanding.
  const allResponses = await Promise.all(
    polls.map((poll) => responsesForPoll(supabase, poll.id)),
  );
  const answeredCount = new Map<string, number>(
    polls.map((poll, index) => [
      poll.id,
      allResponses[index]!.filter((r) => myPlayerIds.has(r.playerId)).length,
    ]),
  );

  const open = polls.filter((p) => isOpen(p));
  const closed = polls.filter((p) => !isOpen(p));

  const base = `/${encodeURIComponent(clan.tag)}`;
  const firstOwed = open.find((p) => mine.length > 0 && (answeredCount.get(p.id) ?? 0) < mine.length)?.id;

  return (
    <main className="mx-auto max-w-narrow space-y-6 p-4 sm:p-6">
      <PageHeader
        eyebrow={clan.name}
        title="Polls"
        description="Availability and questions for the clan."
        actions={
          isLeadership(clan.role) ? (
            <Button asChild variant="outline" size="sm">
              <Link href={`${base}/polls/new`}>New poll</Link>
            </Button>
          ) : undefined
        }
      />

      {polls.length === 0 ? (
        <Panel>
          <EmptyState
            icon={Vote}
            title="No polls yet"
            body={
              isLeadership(clan.role)
                ? "Open one before CWL sign-up, so you know who is available before you pick the lineup rather than after."
                : "Your leader has not asked anything yet. Questions appear here when they do."
            }
          />
        </Panel>
      ) : (
        <>
          <Panel aria-labelledby="open-title" className="space-y-4">
            <SectionHeader id="open-title" title="Open" count={open.length} />
            {open.length === 0 ? (
              <p className="text-muted-foreground text-sm">Nothing open right now.</p>
            ) : (
              <ul className="divide-y">
                {open.map((poll) => {
                  const answers = answeredCount.get(poll.id) ?? 0;
                  const outstanding = mine.length - answers;
                  const owed = mine.length > 0 && outstanding > 0;
                  const where = poll.scope === "family" ? "All clans" : clan.name;
                  const status =
                    mine.length === 0
                      ? "verify a village to answer"
                      : outstanding === 0
                        ? "you answered"
                        : outstanding === mine.length
                          ? "you have not answered"
                          : `${outstanding} of your villages still to answer`;
                  return (
                    <ListRow
                      key={poll.id}
                      icon={owed ? Vote : CheckCircle2}
                      tone={owed ? "var(--info)" : "var(--success)"}
                      context={where}
                      title={poll.title}
                      meta={`${closesLabel(poll.closesAt)} · ${status}`}
                      action={{
                        href: `${base}/polls/${poll.id}`,
                        label: owed ? "Answer" : "View",
                        primary: poll.id === firstOwed,
                      }}
                    />
                  );
                })}
              </ul>
            )}
          </Panel>

          {closed.length > 0 && (
            <Disclosure title="Closed" count={closed.length}>
              <ul className="divide-y">
                {closed.map((poll) => (
                  <li key={poll.id} className="flex flex-wrap items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                    <Link
                      className="min-w-0 flex-1 text-sm underline-offset-2 hover:underline"
                      href={`${base}/polls/${poll.id}`}
                    >
                      {poll.title}
                    </Link>
                    <span className="text-muted-foreground text-xs">
                      {poll.scope === "family" ? "All clans" : clan.name}
                    </span>
                  </li>
                ))}
              </ul>
            </Disclosure>
          )}
        </>
      )}
    </main>
  );
}
