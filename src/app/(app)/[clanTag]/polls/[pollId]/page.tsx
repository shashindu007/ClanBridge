// T4B.3, T4B.4 — Answer a poll, and see the results.
//
// Answers are editable until closes_at and then locked — enforced by the policy
// in migration 010, not by disabling a button. A closed poll that a crafted
// request can still edit is a poll whose result is not final.
//
// T4B.4: members see counts, leadership sees names. That split is a POLICY, so
// this page cannot leak it by accident: responsesForPoll() simply returns
// nothing but your own rows unless you are leadership, and the counts come from
// a definer function that aggregates without exposing a row.
//
// THE LIST THAT MATTERS is "has not answered". Counts are the easy half and
// every polling tool shows them; the useful half is the absence. Thirty members,
// eighteen answers, and the question is which twelve — a list that cannot come
// from poll_responses, because the people on it have no row there.

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requireClanByTag } from "@/lib/clans";
import { currentUserId } from "@/lib/auth";
import { notifyUsers } from "@/lib/push";
import { createClient } from "@/lib/supabase/server";
import { membersForClan, userIdsForPlayers } from "@/repositories/members";
import {
  answerPoll,
  closePoll,
  countsForPoll,
  myPlayers,
  optionsForPoll,
  pollById,
  responsesForPoll,
} from "@/repositories/polls";
import {
  isOpen,
  nonResponders,
  optionShare,
  pollBreakdown,
  type EligibleMember,
} from "@/services/polls";

export const dynamic = "force-dynamic";

function isLeadership(role: string): boolean {
  return role === "leader" || role === "co-leader";
}

async function submitAnswer(formData: FormData) {
  "use server";

  const supabase = await createClient();
  const userId = await currentUserId(supabase);
  if (!userId) redirect("/login");

  const clanTag = String(formData.get("clanTag") ?? "");
  const pollId = String(formData.get("pollId") ?? "");
  const clan = await requireClanByTag(supabase, clanTag);
  const here = `/${encodeURIComponent(clan.tag)}/polls/${pollId}`;

  const playerId = String(formData.get("playerId") ?? "");
  const optionId = String(formData.get("optionId") ?? "");
  if (!playerId || !optionId) redirect(`${here}?error=incomplete`);

  const note = String(formData.get("note") ?? "").trim() || null;

  const { error } = await answerPoll(supabase, pollId, playerId, optionId, note);
  if (error) redirect(`${here}?error=${encodeURIComponent(error)}`);

  revalidatePath(here);
  redirect(here);
}

async function submitClose(formData: FormData) {
  "use server";

  const supabase = await createClient();
  const clanTag = String(formData.get("clanTag") ?? "");
  const pollId = String(formData.get("pollId") ?? "");
  const clan = await requireClanByTag(supabase, clanTag);
  const here = `/${encodeURIComponent(clan.tag)}/polls/${pollId}`;

  const { error } = await closePoll(supabase, pollId);
  if (error) redirect(`${here}?error=${encodeURIComponent(error)}`);

  revalidatePath(here);
  redirect(here);
}

/**
 * T4B.5 — push a reminder to the members who have not answered.
 *
 * The non-responder list is recomputed here rather than being posted from the
 * page. A hidden field carrying the list would let a caller name anyone, and it
 * would also be stale: somebody answers while the leader is reading the page,
 * and the button then reminds a person who already did the thing.
 *
 * Authority comes from push_targets() (023), which returns nothing at all unless
 * the caller is leadership of the clan. requireClanByTag establishes the clan;
 * the database decides whether this caller may address it.
 */
async function remindNonResponders(formData: FormData) {
  "use server";

  const supabase = await createClient();
  const clanTag = String(formData.get("clanTag") ?? "");
  const pollId = String(formData.get("pollId") ?? "");
  const clan = await requireClanByTag(supabase, clanTag);
  const here = `/${encodeURIComponent(clan.tag)}/polls/${pollId}`;

  const poll = await pollById(supabase, pollId);
  if (!poll) redirect(here);

  // Reminding people about a poll they can no longer answer is worse than not
  // reminding them: the notification is an instruction that cannot be followed.
  if (!isOpen(poll)) redirect(`${here}?error=closed`);

  const [responses, members] = await Promise.all([
    responsesForPoll(supabase, poll.id),
    membersForClan(supabase, clan.id),
  ]);

  const eligible = members
    .filter((m) => m.leftAt === null)
    .map((m) => ({ playerId: m.playerId, tag: m.tag, name: m.name }));

  const chase = nonResponders(eligible, responses);
  const userIds = await userIdsForPlayers(
    supabase,
    clan.id,
    chase.map((m) => m.playerId),
  );

  const result = await notifyUsers(supabase, clan.id, "poll_reminders", userIds, {
    title: `${clan.name} — ${poll.title}`,
    body: "You have not answered this poll yet.",
    url: here,
    // One key per poll, so chasing twice replaces the first reminder rather
    // than stacking a second identical one on the lock screen.
    tag: `poll:${poll.id}`,
  });

  revalidatePath(here);
  redirect(`${here}?reminded=${result.sent}`);
}

export default async function PollDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ clanTag: string; pollId: string }>;
  searchParams: Promise<{ error?: string; reminded?: string }>;
}) {
  const { clanTag, pollId } = await params;
  const { error, reminded } = await searchParams;
  const supabase = await createClient();

  const clan = await requireClanByTag(supabase, clanTag);
  const userId = await currentUserId(supabase);

  const poll = await pollById(supabase, pollId);
  if (!poll) notFound();

  const [options, counts, responses, mine] = await Promise.all([
    optionsForPoll(supabase, poll.id),
    countsForPoll(supabase, poll.id),
    responsesForPoll(supabase, poll.id),
    userId ? myPlayers(supabase, userId) : Promise.resolve([]),
  ]);

  const open = isOpen(poll);
  const leadership = isLeadership(clan.role);
  const myResponses = new Map(
    responses.filter((r) => mine.some((p) => p.id === r.playerId)).map((r) => [r.playerId, r]),
  );

  // Who SHOULD have answered. A clan poll asks this clan; a family poll asks
  // every clan, but leadership here can only see their own clan's members, so
  // the chase list is honestly scoped to what they can act on.
  let eligible: EligibleMember[] = [];
  if (leadership) {
    const members = await membersForClan(supabase, clan.id);
    // Departed members are excluded: chasing an answer from someone who has left
    // the clan is noise, and it makes the "18 of 30" denominator wrong (T3.9).
    eligible = members
      .filter((m) => m.leftAt === null)
      .map((m) => ({ playerId: m.playerId, tag: m.tag, name: m.name }));
  }
  const breakdown = leadership ? pollBreakdown(eligible, responses, options) : null;
  const shares = optionShare(counts);
  const totalVotes = counts.reduce((sum, c) => sum + c.votes, 0);

  const back = `/${encodeURIComponent(clan.tag)}/polls`;

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-8">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{poll.title}</h1>
          <Badge variant={open ? "default" : "secondary"}>{open ? "Open" : "Closed"}</Badge>
        </div>
        {poll.question && <p className="text-sm">{poll.question}</p>}
        <p className="text-muted-foreground text-sm">
          {poll.scope === "family" ? "Asked of every clan" : clan.name}
          {poll.season ? ` · season ${poll.season}` : ""} ·{" "}
          <Link className="underline" href={back}>
            All polls
          </Link>
        </p>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertTitle>That did not work</AlertTitle>
          <AlertDescription>
            {error === "incomplete"
              ? "Pick an account and an option."
              : error === "closed"
                ? "This poll has closed, so there is nothing to remind anyone about."
                : error}
          </AlertDescription>
        </Alert>
      )}

      {/* Said plainly, including when it is zero. A reminder button that reports
          nothing leaves the leader believing thirty people were chased when the
          real answer is that none of them have notifications turned on — and
          they find out a week later, when nobody has answered. */}
      {reminded !== undefined && (
        <Alert>
          <AlertTitle>
            {reminded === "0" ? "Nobody could be reached" : `Reminded ${reminded}`}
          </AlertTitle>
          <AlertDescription>
            {reminded === "0"
              ? "None of the members who have not answered have notifications turned on for a device. You will have to chase them another way."
              : "Only members with notifications turned on receive these, so the number is usually smaller than the list."}
          </AlertDescription>
        </Alert>
      )}

      {/* ── Answering ─────────────────────────────────────────────────────── */}
      {mine.length === 0 ? (
        <Alert>
          <AlertTitle>Verify a player first</AlertTitle>
          <AlertDescription>
            Answers belong to a Clash account, not to your login — a member with two
            villages has two answers to give.{" "}
            <Link className="underline" href="/verify">
              Verify an account
            </Link>{" "}
            to take part.
          </AlertDescription>
        </Alert>
      ) : !open ? (
        <section className="rounded-lg border p-6">
          <p className="text-muted-foreground text-sm">
            This poll is closed. Your answer
            {mine.length > 1 ? "s are" : " is"} locked in below.
          </p>
        </section>
      ) : (
        mine.map((player) => {
          const existing = myResponses.get(player.id);
          return (
            <form
              key={player.id}
              action={submitAnswer}
              className="space-y-4 rounded-lg border p-6"
            >
              <input type="hidden" name="clanTag" value={clanTag} />
              <input type="hidden" name="pollId" value={poll.id} />
              <input type="hidden" name="playerId" value={player.id} />

              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-medium">
                  {player.name}{" "}
                  <span className="text-muted-foreground font-mono text-xs">{player.tag}</span>
                </h2>
                {existing && <Badge variant="secondary">answered</Badge>}
              </div>

              <div className="flex flex-wrap gap-2">
                {options.map((option) => (
                  <label
                    key={option.id}
                    className="has-checked:border-primary has-checked:bg-accent flex cursor-pointer items-center gap-2 rounded-md border px-4 py-2 text-sm"
                  >
                    <input
                      type="radio"
                      name="optionId"
                      value={option.id}
                      defaultChecked={existing?.optionId === option.id}
                      required
                      className="accent-primary"
                    />
                    {option.label}
                  </label>
                ))}
              </div>

              <div className="space-y-2">
                <Label htmlFor={`note-${player.id}`}>Note (optional)</Label>
                <Input
                  id={`note-${player.id}`}
                  name="note"
                  maxLength={200}
                  defaultValue={existing?.note ?? ""}
                  placeholder="Away days 3 and 4"
                />
              </div>

              <Button type="submit" size="sm">
                {existing ? "Change my answer" : "Submit"}
              </Button>
            </form>
          );
        })
      )}

      {/* ── Results ───────────────────────────────────────────────────────── */}
      <section className="space-y-4 rounded-lg border p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-medium">Results</h2>
          <span className="text-muted-foreground text-sm tabular-nums">
            {totalVotes} answer{totalVotes === 1 ? "" : "s"}
          </span>
        </div>

        {shares.length === 0 ? (
          <p className="text-muted-foreground text-sm">No options on this poll.</p>
        ) : (
          <ul className="space-y-3">
            {shares.map((option) => (
              <li key={option.optionId} className="space-y-1">
                <div className="flex justify-between text-sm">
                  <span>{option.label}</span>
                  <span className="text-muted-foreground tabular-nums">
                    {option.votes} · {option.share}%
                  </span>
                </div>
                <div className="bg-muted h-2 w-full overflow-hidden rounded-full">
                  <div className="bg-primary h-full" style={{ width: `${option.share}%` }} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── The chase list. Leadership only, by policy, not by hiding. ────── */}
      {leadership && breakdown && (
        <>
          <section className="space-y-4 rounded-lg border p-6">
            <h2 className="font-medium">
              Has not answered{" "}
              <span className="text-muted-foreground font-normal">
                ({breakdown.notAnswered.length} of {breakdown.totalEligible})
              </span>
            </h2>
            {breakdown.notAnswered.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                Everyone in {clan.name} has answered.
              </p>
            ) : (
              <>
                <ul className="divide-y">
                  {breakdown.notAnswered.map((m) => (
                    <li key={m.playerId} className="flex items-center gap-4 py-2">
                      <span className="flex-1 text-sm">{m.name}</span>
                      <span className="text-muted-foreground font-mono text-xs">{m.tag}</span>
                    </li>
                  ))}
                </ul>
                {/* T4B.5 — chase them, rather than listing them and hoping.
                    Only the people on this list are notified; reminding everyone
                    teaches the members who answered on time that answering does
                    not stop the reminders, and they stop answering. */}
                {open ? (
                  <form action={remindNonResponders} className="flex items-center gap-3">
                    <input type="hidden" name="clanTag" value={clanTag} />
                    <input type="hidden" name="pollId" value={pollId} />
                    <Button type="submit" variant="outline" size="sm">
                      Remind these {breakdown.notAnswered.length}
                    </Button>
                    <span className="text-muted-foreground text-xs">
                      Only members who have turned notifications on can be reached.
                    </span>
                  </form>
                ) : (
                  <p className="text-muted-foreground text-xs">
                    This poll is closed — there is nothing left to chase.
                  </p>
                )}
              </>
            )}
          </section>

          <section className="space-y-4 rounded-lg border p-6">
            <h2 className="font-medium">Who answered what</h2>
            {breakdown.answered.length === 0 ? (
              <p className="text-muted-foreground text-sm">Nobody has answered yet.</p>
            ) : (
              <ul className="divide-y">
                {breakdown.answered.map((r) => (
                  <li key={r.playerId} className="flex flex-wrap items-center gap-3 py-2">
                    <span className="min-w-0 flex-1 text-sm">
                      {r.name}
                      {r.note && (
                        <span className="text-muted-foreground"> — {r.note}</span>
                      )}
                    </span>
                    {r.changedAt && <Badge variant="outline">changed</Badge>}
                    <Badge variant="secondary">{r.optionLabel}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {open && (
            <form action={submitClose}>
              <input type="hidden" name="clanTag" value={clanTag} />
              <input type="hidden" name="pollId" value={poll.id} />
              <Button type="submit" variant="outline" size="sm">
                Close this poll now
              </Button>
            </form>
          )}
        </>
      )}
    </main>
  );
}
