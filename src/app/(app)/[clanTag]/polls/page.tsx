// T4B.3, T4B.4 — Polls
//
// A clan sees its own polls and every family-scoped one. A CWL availability poll
// is family-scoped, because the leader picks across all clans at once (T4B.7) —
// so the poll a member most needs to answer is the one that does not belong to
// their clan at all. Filtering on clan_id alone would hide exactly that.
//
// R11 — HUMAN DECISION DATA. No sync job writes here.

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { requireClanByTag } from "@/lib/clans";
import { currentUserId } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { myPlayers, pollsForClan, responsesForPoll } from "@/repositories/polls";
import { isOpen } from "@/services/polls";

export const dynamic = "force-dynamic";

function isLeadership(role: string): boolean {
  return role === "leader" || role === "co-leader";
}

function closesLabel(closesAt: string | null): string {
  if (!closesAt) return "no closing date";
  const hours = Math.round((new Date(closesAt).getTime() - Date.now()) / 3_600_000);
  if (hours < 0) return "closed";
  if (hours < 1) return "closes within the hour";
  if (hours < 24) return `closes in ${hours} hours`;
  return `closes in ${Math.round(hours / 24)} days`;
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
  const answeredCount = new Map<string, number>();
  for (const poll of polls) {
    const responses = await responsesForPoll(supabase, poll.id);
    answeredCount.set(poll.id, responses.filter((r) => myPlayerIds.has(r.playerId)).length);
  }

  const open = polls.filter((p) => isOpen(p));
  const closed = polls.filter((p) => !isOpen(p));

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Polls</h1>
          <p className="text-muted-foreground text-sm">
            {clan.name} — availability and questions for the clan.
          </p>
        </div>
        {isLeadership(clan.role) && (
          <Button asChild size="sm">
            <Link href={`/${encodeURIComponent(clan.tag)}/polls/new`}>New poll</Link>
          </Button>
        )}
      </div>

      {polls.length === 0 ? (
        <section className="cb-panel space-y-3 rounded-lg border p-6">
          <h2 className="font-medium">No polls yet</h2>
          <p className="text-muted-foreground text-sm">
            {isLeadership(clan.role)
              ? "Open one before CWL signup, so you know who is available before you pick the roster rather than after."
              : "Your leader has not asked anything yet. Questions appear here when they do."}
          </p>
        </section>
      ) : (
        <>
          <section className="space-y-3">
            <h2 className="text-muted-foreground text-sm font-medium">Open ({open.length})</h2>
            {open.length === 0 ? (
              <p className="text-muted-foreground rounded-lg border p-6 text-sm">
                Nothing open right now.
              </p>
            ) : (
              <ul className="divide-y rounded-lg border">
                {open.map((poll) => {
                  const answers = answeredCount.get(poll.id) ?? 0;
                  const outstanding = mine.length - answers;
                  return (
                    <li key={poll.id} className="flex flex-wrap items-center gap-3 p-4">
                      <div className="min-w-0 flex-1 space-y-1">
                        <Link
                          className="font-medium underline-offset-2 hover:underline"
                          href={`/${encodeURIComponent(clan.tag)}/polls/${poll.id}`}
                        >
                          {poll.title}
                        </Link>
                        <p className="text-muted-foreground text-xs">
                          {poll.scope === "family" ? "All clans" : clan.name} ·{" "}
                          {closesLabel(poll.closesAt)}
                        </p>
                      </div>
                      {mine.length === 0 ? (
                        <Badge variant="outline">verify to answer</Badge>
                      ) : outstanding > 0 ? (
                        <Badge variant="destructive">
                          {outstanding === mine.length ? "not answered" : `${outstanding} left`}
                        </Badge>
                      ) : (
                        <Badge variant="secondary">answered</Badge>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {closed.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-muted-foreground text-sm font-medium">
                Closed ({closed.length})
              </h2>
              <ul className="divide-y rounded-lg border">
                {closed.map((poll) => (
                  <li key={poll.id} className="flex flex-wrap items-center gap-3 p-4">
                    <Link
                      className="min-w-0 flex-1 underline-offset-2 hover:underline"
                      href={`/${encodeURIComponent(clan.tag)}/polls/${poll.id}`}
                    >
                      {poll.title}
                    </Link>
                    <span className="text-muted-foreground text-xs">
                      {poll.scope === "family" ? "All clans" : clan.name}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </main>
  );
}
