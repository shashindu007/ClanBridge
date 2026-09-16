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
// REDESIGNED so a member sees their own answer first — big answer cards with an
// icon each, "Current answer: In", and a closed poll showing what was answered
// instead of promising it "below" and never showing it — and a leader sees the
// chase list and the answers grouped by option side by side.
//
// THE LIST THAT MATTERS is "has not answered". Counts are the easy half and
// every polling tool shows them; the useful half is the absence. Thirty members,
// eighteen answers, and the question is which twelve — a list that cannot come
// from poll_responses, because the people on it have no row there.

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { BellRing, CheckCircle2, CircleAlert, CircleHelp, XCircle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { SubmitButton } from "@/components/submit-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/page-header";
import { formatDisplay } from "@/lib/display-time";
import { availabilityOf, seasonLabel } from "@/lib/roster-view";
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
  redirect(`${here}?ok=poll-answered`);
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
  redirect(`${here}?ok=poll-closed`);
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
  searchParams: Promise<{ reminded?: string }>;
}) {
  const { clanTag, pollId } = await params;
  const { reminded } = await searchParams;
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
  const labelOf = new Map(options.map((o) => [o.id, o.label]));

  // Who SHOULD have answered. A clan poll asks this clan; a family poll asks
  // every clan, but leadership here can only see their own clan's members, so
  // the chase list is honestly scoped to what they can act on.
  let eligible: EligibleMember[] = [];
  if (leadership) {
    const members = await membersForClan(supabase, clan.id);
    // Departed members are excluded (T3.9).
    eligible = members
      .filter((m) => m.leftAt === null)
      .map((m) => ({ playerId: m.playerId, tag: m.tag, name: m.name }));
  }
  const breakdown = leadership ? pollBreakdown(eligible, responses, options) : null;
  const shares = optionShare(counts);
  const totalVotes = counts.reduce((sum, c) => sum + c.votes, 0);
  const back = `/${encodeURIComponent(clan.tag)}/polls`;
  const allAnswered = mine.length > 0 && mine.every((p) => myResponses.has(p.id));

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-4 sm:p-8">
      <PageHeader
        back={{ href: back, label: "All polls" }}
        eyebrow={
          <>
            {poll.scope === "family" ? "Asked of every clan" : clan.name}
            {poll.season ? ` · ${seasonLabel(poll.season)}` : ""}
          </>
        }
        title={poll.title}
        description={poll.question ?? undefined}
        actions={
          <span className="flex flex-col items-end gap-1">
            <Badge variant={open ? "success" : "secondary"}>{open ? "Open" : "Closed"}</Badge>
            {poll.closesAt && (
              <span className="text-muted-foreground text-xs">
                {open ? "Closes " : "Closed "}
                {formatDisplay(poll.closesAt, "datetime")}
              </span>
            )}
          </span>
        }
      />

      {/* Said plainly, including when it is zero. A reminder button that reports
          nothing leaves the leader believing thirty people were chased when none
          of them have notifications turned on. */}
      {reminded !== undefined && (
        <Alert variant={reminded === "0" ? "warning" : "info"}>
          <BellRing aria-hidden />
          <AlertTitle>
            {reminded === "0" ? "Nobody could be reached" : `Reminder sent to ${reminded}`}
          </AlertTitle>
          <AlertDescription>
            {reminded === "0"
              ? "None of the members who have not answered have notifications turned on. You will have to chase them another way."
              : "Only members with notifications turned on receive reminders, so this is usually smaller than the list."}
          </AlertDescription>
        </Alert>
      )}

      {/* ── Your answer ─────────────────────────────────────────────────────── */}
      {mine.length === 0 ? (
        <Alert variant="info">
          <CircleAlert aria-hidden />
          <AlertTitle>Link your Clash account to answer</AlertTitle>
          <AlertDescription className="space-y-3">
            <p>
              Answers belong to a village, not to your login — a member with two villages
              gives two answers.
            </p>
            <Button asChild size="sm">
              <Link href="/verify">Link an account</Link>
            </Button>
          </AlertDescription>
        </Alert>
      ) : (
        <section className="cb-panel space-y-4 rounded-lg border p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold">{mine.length > 1 ? "Your answers" : "Your answer"}</h2>
            {allAnswered ? (
              <Badge variant="success">
                <CheckCircle2 aria-hidden />
                Answered
              </Badge>
            ) : open ? (
              <Badge variant="warning">Waiting for your answer</Badge>
            ) : null}
          </div>

          {mine.map((player) => {
            const existing = myResponses.get(player.id);
            const chosen = existing ? labelOf.get(existing.optionId) : null;

            // Closed: show what was answered, locked. The old page said "locked in
            // below" and then never showed it.
            if (!open) {
              return (
                <div key={player.id} className="bg-card flex flex-wrap items-center justify-between gap-2 rounded-md border p-4">
                  <span className="font-medium">
                    {player.name} <span className="text-muted-foreground font-mono text-xs">{player.tag}</span>
                  </span>
                  <span className="text-sm">
                    {chosen ? (
                      <>
                        Answered <span className="font-semibold">{chosen}</span>
                        {existing?.note && <span className="text-muted-foreground"> — {existing.note}</span>}
                      </>
                    ) : (
                      <span className="text-muted-foreground">Did not answer</span>
                    )}
                  </span>
                </div>
              );
            }

            return (
              <form key={player.id} action={submitAnswer} className="bg-card space-y-4 rounded-md border p-4">
                <input type="hidden" name="clanTag" value={clanTag} />
                <input type="hidden" name="pollId" value={poll.id} />
                <input type="hidden" name="playerId" value={player.id} />

                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-medium">
                    {player.name} <span className="text-muted-foreground font-mono text-xs">{player.tag}</span>
                  </p>
                  {chosen && (
                    <p className="text-muted-foreground text-sm">
                      Current answer: <span className="text-foreground font-semibold">{chosen}</span>
                    </p>
                  )}
                </div>

                <fieldset className="space-y-2">
                  <legend className="sr-only">Choose an answer for {player.name}</legend>
                  <div className="grid gap-2 sm:grid-cols-3">
                    {options.map((option) => (
                      <label
                        key={option.id}
                        className="has-checked:border-primary has-checked:bg-accent has-checked:ring-primary/30 flex cursor-pointer items-center gap-3 rounded-lg border-2 px-4 py-3 text-sm font-medium transition-colors has-checked:ring-2 hover:bg-accent/50"
                      >
                        <input
                          type="radio"
                          name="optionId"
                          value={option.id}
                          defaultChecked={existing?.optionId === option.id}
                          required
                          className="accent-primary size-4"
                        />
                        <OptionIcon label={option.label} />
                        {option.label}
                      </label>
                    ))}
                  </div>
                </fieldset>

                <div className="space-y-1.5">
                  <Label htmlFor={`note-${player.id}`}>Add a note for your leader (optional)</Label>
                  <Input
                    id={`note-${player.id}`}
                    name="note"
                    maxLength={200}
                    defaultValue={existing?.note ?? ""}
                    placeholder="e.g. Away on days 3 and 4"
                  />
                </div>

                <SubmitButton pendingLabel="Saving">
                  {existing ? "Update my answer" : "Save my answer"}
                </SubmitButton>
              </form>
            );
          })}

          {open && (
            <p className="text-muted-foreground text-xs">
              You can change your answer until the poll closes.
            </p>
          )}
        </section>
      )}

      {/* ── Results ───────────────────────────────────────────────────────── */}
      <section className="cb-panel space-y-4 rounded-lg border p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">Results so far</h2>
          <span className="text-muted-foreground text-sm tabular-nums">
            {totalVotes} answer{totalVotes === 1 ? "" : "s"}
            {breakdown ? ` from ${breakdown.totalEligible} members` : ""}
          </span>
        </div>

        {shares.length === 0 ? (
          <p className="text-muted-foreground text-sm">This poll has no options.</p>
        ) : (
          <ul className="space-y-3">
            {shares.map((option) => (
              <li key={option.optionId} className="space-y-1.5">
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="flex items-center gap-2 font-medium">
                    <OptionIcon label={option.label} />
                    {option.label}
                  </span>
                  <span className="text-muted-foreground tabular-nums">
                    {option.votes} · {option.share}%
                  </span>
                </div>
                <Progress value={option.share} label={`${option.label}: ${option.share}%`} />
              </li>
            ))}
          </ul>
        )}
        {!leadership && (
          <p className="text-muted-foreground text-xs">
            Only the totals are shown to members. Leaders can see who answered what.
          </p>
        )}
      </section>

      {/* ── Leadership: who to chase, and who said what. Policy, not hiding. ── */}
      {leadership && breakdown && (
        <div className="grid items-start gap-6 md:grid-cols-2">
          <section className="cb-panel space-y-4 rounded-lg border p-6">
            <div className="space-y-1">
              <h2 className="text-lg font-semibold">
                Not answered yet{" "}
                <span className="text-muted-foreground text-base font-normal tabular-nums">
                  {breakdown.notAnswered.length} of {breakdown.totalEligible}
                </span>
              </h2>
              <p className="text-muted-foreground text-sm">Members of {clan.name} with no answer.</p>
            </div>

            {breakdown.notAnswered.length === 0 ? (
              <p className="text-sm">
                <CheckCircle2 aria-hidden className="text-success mr-1 inline size-4" />
                Everyone has answered.
              </p>
            ) : (
              <>
                {/* T4B.5 — only these people are notified; reminding everyone
                    teaches the prompt answerers that answering changes nothing. */}
                {open ? (
                  <form action={remindNonResponders} className="space-y-1.5">
                    <input type="hidden" name="clanTag" value={clanTag} />
                    <input type="hidden" name="pollId" value={pollId} />
                    <SubmitButton size="sm" pendingLabel="Sending reminders">
                      <BellRing aria-hidden />
                      Remind these {breakdown.notAnswered.length}
                    </SubmitButton>
                    <p className="text-muted-foreground text-xs">
                      Sent only to members with notifications turned on.
                    </p>
                  </form>
                ) : (
                  <p className="text-muted-foreground text-xs">The poll has closed, so there is nobody left to chase.</p>
                )}
                <ul className="max-h-96 divide-y overflow-y-auto rounded-md border">
                  {breakdown.notAnswered.map((m) => (
                    <li key={m.playerId} className="flex items-center justify-between gap-3 px-3 py-2">
                      <span className="text-sm">{m.name}</span>
                      <span className="text-muted-foreground font-mono text-xs">{m.tag}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>

          <section className="cb-panel space-y-4 rounded-lg border p-6">
            <div className="space-y-1">
              <h2 className="text-lg font-semibold">Who answered what</h2>
              <p className="text-muted-foreground text-sm">Grouped by answer. Notes are shown under names.</p>
            </div>
            {breakdown.answered.length === 0 ? (
              <p className="text-muted-foreground text-sm">Nobody has answered yet.</p>
            ) : (
              <div className="space-y-4">
                {options.map((option) => {
                  const group = breakdown.answered.filter((r) => r.optionId === option.id);
                  if (group.length === 0) return null;
                  return (
                    <div key={option.id} className="space-y-1.5">
                      <h3 className="flex items-center gap-2 text-sm font-medium">
                        <OptionIcon label={option.label} />
                        {option.label}
                        <span className="text-muted-foreground tabular-nums">({group.length})</span>
                      </h3>
                      <ul className="divide-y rounded-md border">
                        {group.map((r) => (
                          <li key={r.playerId} className="px-3 py-2 text-sm">
                            <span className="flex items-center justify-between gap-2">
                              {r.name}
                              {r.changedAt && <Badge variant="outline">changed answer</Badge>}
                            </span>
                            {r.note && <span className="text-muted-foreground block text-xs">“{r.note}”</span>}
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      )}

      {leadership && open && (
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed p-4">
          <p className="text-muted-foreground text-sm">
            Closing locks every answer. Members can no longer change theirs.
          </p>
          <form action={submitClose}>
            <input type="hidden" name="clanTag" value={clanTag} />
            <input type="hidden" name="pollId" value={poll.id} />
            <SubmitButton variant="outline" size="sm" pendingLabel="Closing">
              Close this poll now
            </SubmitButton>
          </form>
        </section>
      )}
    </main>
  );
}

/** An icon for the three standard answers, so a result reads without the colour. */
function OptionIcon({ label }: { label: string }) {
  const kind = availabilityOf(label);
  if (kind === "in") return <CheckCircle2 aria-hidden className="text-success size-4 shrink-0" />;
  if (kind === "maybe") return <CircleHelp aria-hidden className="text-warning-ink size-4 shrink-0" />;
  if (kind === "out") return <XCircle aria-hidden className="text-destructive size-4 shrink-0" />;
  return null;
}
