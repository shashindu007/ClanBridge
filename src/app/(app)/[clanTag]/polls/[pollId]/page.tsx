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
// ─────────────────────────────────────────────────────────────────────────────
// ONE FORM, WITH A VILLAGE PICKER
//
// Answers belong to villages, and a member with three bases used to get three
// full forms stacked down the page — three sets of In / Out / Maybe, three
// note boxes, three Save buttons — with no way to see at a glance which were
// done. Now: a row of village chips, each saying its answer or "Not answered",
// and ONE form for the village chosen (?base=). The page lands on the first
// village still owed, and Save moves on to the next one (services/polls.ts,
// chooseBase and nextUnanswered).
//
// A FAMILY POLL IS ONE POLL, SEEN ONCE
//
// A CWL availability poll is asked of the whole family at once, because the
// leader then decides who plays for which clan — a Dark Hell member can be
// placed in DH CWL ONLY. Showing a leader only their own clan's members, as
// this page did, cut the one list they needed into pieces by the very
// boundary they were about to redraw. For a family poll the leader now sees
// EVERY clan's members in one list, each with their clan and Town Hall, and a
// link to the lineup builder where the placing is done. RLS already allowed
// it: 010 lets leadership of any clan read a family poll's answers.
// ─────────────────────────────────────────────────────────────────────────────
//
// THE LIST THAT MATTERS is "has not answered". Counts are the easy half and
// every polling tool shows them; the useful half is the absence.

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  ArrowRight,
  BellRing,
  CheckCircle2,
  CircleAlert,
  CircleHelp,
  ClipboardList,
  XCircle,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { SubmitButton } from "@/components/submit-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/page-header";
import { Panel, SectionHeader } from "@/components/kit";
import { TownHall } from "@/components/game/town-hall";
import { formatDisplay } from "@/lib/display-time";
import { availabilityOf, seasonLabel } from "@/lib/roster-view";
import { requireClanByTag, visibleClans } from "@/lib/clans";
import { clanAccent } from "@/lib/clan-accent";
import { isLeadership } from "@/lib/visibility";
import { currentUserId } from "@/lib/auth";
import { notifyUsers } from "@/lib/push";
import { createClient } from "@/lib/supabase/server";
import { membersForClan, userIdsForPlayers } from "@/repositories/members";
import { familyClanRoster, familyClans } from "@/repositories/family";
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
  chooseBase,
  isOpen,
  nextUnanswered,
  nonResponders,
  optionShare,
  pollBreakdown,
  villagesFor,
  type EligibleMember,
} from "@/services/polls";

export const dynamic = "force-dynamic";

type Supabase = Awaited<ReturnType<typeof createClient>>;

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
  if (!playerId || !optionId) redirect(`${here}?base=${encodeURIComponent(playerId)}&error=incomplete`);

  const note = String(formData.get("note") ?? "").trim() || null;

  const { error } = await answerPoll(supabase, pollId, playerId, optionId, note);
  if (error) redirect(`${here}?base=${encodeURIComponent(playerId)}&error=${encodeURIComponent(error)}`);

  // On to the next village still owing an answer, so three villages are three
  // taps of Save rather than three hunts down the page.
  const [allMine, responses, poll] = await Promise.all([
    myPlayers(supabase, userId),
    responsesForPoll(supabase, pollId),
    pollById(supabase, pollId),
  ]);
  const mine = poll ? villagesFor(poll, allMine) : allMine;
  const answered = new Set(responses.map((r) => r.playerId));
  const next = nextUnanswered(mine, answered, playerId);

  revalidatePath(here);
  redirect(`${here}?base=${encodeURIComponent(next?.id ?? playerId)}&ok=poll-answered`);
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
 * would also be stale.
 *
 * Per clan, always. A family poll is chased in every clan the caller HELPS RUN
 * — push_targets() (023) returns nothing for a clan they do not — so a leader
 * of one clan cannot push another clan's members, however family-wide the
 * poll. The reminder names the clan it comes from.
 */
async function remindNonResponders(formData: FormData) {
  "use server";

  const supabase = await createClient();
  const userId = await currentUserId(supabase);
  if (!userId) redirect("/login");

  const clanTag = String(formData.get("clanTag") ?? "");
  const pollId = String(formData.get("pollId") ?? "");
  const clan = await requireClanByTag(supabase, clanTag);
  const here = `/${encodeURIComponent(clan.tag)}/polls/${pollId}`;

  const poll = await pollById(supabase, pollId);
  if (!poll) redirect(here);

  // Reminding people about a poll they can no longer answer is worse than not
  // reminding them: the notification is an instruction that cannot be followed.
  if (!isOpen(poll)) redirect(`${here}?error=closed`);

  const chased =
    poll.scope === "family"
      ? (await visibleClans(supabase, userId)).filter((c) => isLeadership(c.role))
      : [clan];

  const responses = await responsesForPoll(supabase, poll.id);
  let sent = 0;
  for (const target of chased) {
    const members = await membersForClan(supabase, target.id);
    const eligible = members
      .filter((m) => m.leftAt === null)
      .map((m) => ({ playerId: m.playerId, tag: m.tag, name: m.name }));
    const chase = nonResponders(eligible, responses);
    const userIds = await userIdsForPlayers(
      supabase,
      target.id,
      chase.map((m) => m.playerId),
    );
    const result = await notifyUsers(supabase, target.id, "poll_reminders", userIds, {
      title: `${target.name} — ${poll.title}`,
      body: "You have not answered this poll yet.",
      url: `/${encodeURIComponent(target.tag)}/polls/${poll.id}`,
      // One key per poll, so chasing twice replaces the first reminder rather
      // than stacking a second identical one on the lock screen.
      tag: `poll:${poll.id}`,
    });
    sent += result.sent;
  }

  revalidatePath(here);
  redirect(`${here}?reminded=${sent}`);
}

/** Who should answer, with the clan and Town Hall a leader places them by. */
interface Eligible extends EligibleMember {
  clanId: string;
  clanName: string;
  thLevel: number | null;
}

async function eligibleFor(
  supabase: Supabase,
  family: boolean,
  clan: { id: string; name: string },
): Promise<Eligible[]> {
  // Departed members are excluded (T3.9) in both branches.
  if (family) {
    const clans = await familyClans(supabase);
    const names = new Map(clans.map((c) => [c.id, c.name]));
    const roster = await familyClanRoster(
      supabase,
      clans.map((c) => c.id),
    );
    return roster
      .filter((m) => m.leftAt === null)
      .map((m) => ({
        playerId: m.playerId,
        tag: m.tag,
        name: m.name,
        clanId: m.clanId,
        clanName: names.get(m.clanId) ?? "",
        thLevel: m.thLevel,
      }));
  }
  const members = await membersForClan(supabase, clan.id);
  return members
    .filter((m) => m.leftAt === null)
    .map((m) => ({
      playerId: m.playerId,
      tag: m.tag,
      name: m.name,
      clanId: clan.id,
      clanName: clan.name,
      thLevel: m.thLevel,
    }));
}

/** Clan, then highest Town Hall first, then name — the order a lineup is picked in. */
function byClanThenHall(a: Eligible, b: Eligible): number {
  return (
    a.clanName.localeCompare(b.clanName) ||
    (b.thLevel ?? 0) - (a.thLevel ?? 0) ||
    a.name.localeCompare(b.name)
  );
}

export default async function PollDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ clanTag: string; pollId: string }>;
  searchParams: Promise<{ reminded?: string; base?: string }>;
}) {
  const { clanTag, pollId } = await params;
  const { reminded, base: requestedBase } = await searchParams;
  const supabase = await createClient();

  const clan = await requireClanByTag(supabase, clanTag);
  const userId = await currentUserId(supabase);

  const poll = await pollById(supabase, pollId);
  if (!poll) notFound();

  const [options, counts, responses, allMine, myClans] = await Promise.all([
    optionsForPoll(supabase, poll.id),
    countsForPoll(supabase, poll.id),
    responsesForPoll(supabase, poll.id),
    userId ? myPlayers(supabase, userId) : Promise.resolve([]),
    userId ? visibleClans(supabase, userId) : Promise.resolve([]),
  ]);
  // Only the villages this poll is asking — see villagesFor().
  const mine = villagesFor(poll, allMine);

  const family = poll.scope === "family";
  const open = isOpen(poll);
  // A family poll is led from any clan you help run; a clan poll from this one.
  const leadership = family
    ? myClans.some((c) => isLeadership(c.role))
    : isLeadership(clan.role);

  const myResponses = new Map(
    responses.filter((r) => mine.some((p) => p.id === r.playerId)).map((r) => [r.playerId, r]),
  );
  const answeredMine = new Set(myResponses.keys());
  const labelOf = new Map(options.map((o) => [o.id, o.label]));
  const selected = chooseBase(mine, answeredMine, requestedBase);
  const owed = mine.filter((p) => !answeredMine.has(p.id)).length;
  const afterThis = selected
    ? nextUnanswered(mine, new Set([...answeredMine, selected.id]), selected.id)
    : null;

  const eligible = leadership ? (await eligibleFor(supabase, family, clan)).sort(byClanThenHall) : [];
  const meta = new Map(eligible.map((e) => [e.playerId, e]));
  const breakdown = leadership ? pollBreakdown(eligible, responses, options) : null;
  const clansAsked = new Set(eligible.map((e) => e.clanId)).size;
  const shares = optionShare(counts);
  const totalVotes = counts.reduce((sum, c) => sum + c.votes, 0);
  const back = `/${encodeURIComponent(clan.tag)}/polls`;
  const here = `/${encodeURIComponent(clan.tag)}/polls/${poll.id}`;

  return (
    <main className="mx-auto max-w-page space-y-6 p-4 sm:p-6">
      <PageHeader
        back={{ href: back, label: "All polls" }}
        eyebrow={
          <>
            {family ? "One poll for every clan" : clan.name}
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
      {mine.length === 0 || !selected ? (
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
        <Panel aria-labelledby="answer-title" className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="answer-title" className="text-lg font-semibold">
              {mine.length > 1 ? "Your villages" : "Your answer"}
            </h2>
            {owed === 0 ? (
              <Badge variant="success">
                <CheckCircle2 aria-hidden />
                {mine.length > 1 ? "All answered" : "Answered"}
              </Badge>
            ) : open ? (
              <Badge variant="warning">
                {mine.length > 1 ? `${owed} of ${mine.length} still to answer` : "Waiting for your answer"}
              </Badge>
            ) : null}
          </div>

          {/* The village picker. Each chip says where that village stands, so
              which ones are done is readable without opening any of them. */}
          {mine.length > 1 && (
            <nav aria-label="Choose a village" className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {mine.map((player) => {
                const response = myResponses.get(player.id);
                const answer = response ? labelOf.get(response.optionId) : null;
                const active = player.id === selected.id;
                return (
                  <Link
                    key={player.id}
                    href={`${here}?base=${encodeURIComponent(player.id)}`}
                    scroll={false}
                    aria-current={active ? "true" : undefined}
                    className={`flex items-center justify-between gap-3 rounded-control border-2 px-3 py-2.5 transition-colors ${
                      active
                        ? "border-primary bg-accent ring-primary/30 ring-2"
                        : "hover:bg-accent/50"
                    }`}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{player.name}</span>
                      <span className="text-muted-foreground block font-mono text-xs">{player.tag}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1.5 text-sm">
                      {answer ? (
                        <>
                          <OptionIcon label={answer} />
                          {answer}
                        </>
                      ) : (
                        <span className="text-muted-foreground">Not answered</span>
                      )}
                    </span>
                  </Link>
                );
              })}
            </nav>
          )}

          {open ? (
            <AnswerForm
              // Keyed on the village, so moving between chips resets the radios
              // and the note to THAT village's answer rather than keeping the
              // last one's on screen.
              key={selected.id}
              clanTag={clanTag}
              pollId={poll.id}
              player={selected}
              several={mine.length > 1}
              existing={myResponses.get(selected.id) ?? null}
              options={options}
              labelOf={labelOf}
              next={afterThis}
            />
          ) : (
            // Closed: every village's answer, locked, in one list.
            <ul className="divide-y">
              {mine.map((player) => {
                const response = myResponses.get(player.id);
                const answer = response ? labelOf.get(response.optionId) : null;
                return (
                  <li key={player.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 first:pt-0 last:pb-0">
                    <span className="text-sm font-medium">
                      {player.name}{" "}
                      <span className="text-muted-foreground font-mono text-xs">{player.tag}</span>
                    </span>
                    <span className="text-sm">
                      {answer ? (
                        <span className="flex items-center gap-1.5">
                          <OptionIcon label={answer} />
                          <span className="font-semibold">{answer}</span>
                          {response?.note && <span className="text-muted-foreground"> — {response.note}</span>}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">Did not answer</span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      )}

      {/* ── Results ───────────────────────────────────────────────────────── */}
      <Panel aria-labelledby="results-title" className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="results-title" className="text-lg font-semibold">
            Results so far
          </h2>
          <span className="text-muted-foreground text-sm tabular-nums">
            {totalVotes} answer{totalVotes === 1 ? "" : "s"}
            {breakdown
              ? ` from ${breakdown.totalEligible} ${breakdown.totalEligible === 1 ? "member" : "members"}${
                  family && clansAsked > 1 ? ` in ${clansAsked} clans` : ""
                }`
              : ""}
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
      </Panel>

      {/* ── Leadership: the family decides here, the lineup is built there ── */}
      {leadership && family && poll.pollType === "cwl_availability" && poll.season && (
        <Panel className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-muted-foreground max-w-2xl text-sm">
            Everyone in the family answers this one poll. Who plays for which clan is
            decided on the lineup page, where these answers sit beside each player.
          </p>
          <Button asChild variant="outline">
            <Link href={`/roster/${encodeURIComponent(poll.season)}`}>
              <ClipboardList aria-hidden />
              Pick the CWL lineup
              <ArrowRight aria-hidden />
            </Link>
          </Button>
        </Panel>
      )}

      {/* ── Leadership: who to chase, and who said what. Policy, not hiding. ── */}
      {leadership && breakdown && (
        <div className="grid items-start gap-6 md:grid-cols-2">
          <Panel aria-labelledby="missing-title" className="space-y-4">
            <div className="space-y-1">
              <SectionHeader
                id="missing-title"
                title={`Not answered yet · ${breakdown.notAnswered.length} of ${breakdown.totalEligible}`}
              />
              <p className="text-muted-foreground text-sm">
                {family
                  ? "Every clan in the family, highest Town Hall first."
                  : `Members of ${clan.name} with no answer.`}
              </p>
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
                    <SubmitButton size="sm" variant="outline" pendingLabel="Sending reminders">
                      <BellRing aria-hidden />
                      {family ? "Remind them in the clans you run" : `Remind these ${breakdown.notAnswered.length}`}
                    </SubmitButton>
                    <p className="text-muted-foreground text-xs">
                      Sent only to members with notifications turned on.
                    </p>
                  </form>
                ) : (
                  <p className="text-muted-foreground text-xs">
                    The poll has closed, so there is nobody left to chase.
                  </p>
                )}
                <ul className="max-h-96 divide-y overflow-y-auto rounded-control border">
                  {breakdown.notAnswered.map((m) => (
                    <PersonRow key={m.playerId} person={meta.get(m.playerId)} fallback={m} showClan={family} />
                  ))}
                </ul>
              </>
            )}
          </Panel>

          <Panel aria-labelledby="who-title" className="space-y-4">
            <div className="space-y-1">
              <SectionHeader id="who-title" title="Who answered what" />
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
                      {/* Capped and scrolling: a fifty-name group would otherwise
                          be the whole page. */}
                      <ul className="max-h-72 divide-y overflow-y-auto rounded-control border">
                        {group.map((r) => (
                          <PersonRow
                            key={r.playerId}
                            person={meta.get(r.playerId)}
                            fallback={r}
                            showClan={family}
                            note={r.note}
                            changed={Boolean(r.changedAt)}
                          />
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </div>
            )}
          </Panel>
        </div>
      )}

      {leadership && open && (
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-panel border border-dashed p-4">
          <p className="text-muted-foreground text-sm">
            Closing locks every answer{family ? ", in every clan" : ""}. Members can no longer change theirs.
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

/** The one answer form, for the village chosen in the picker. */
function AnswerForm({
  clanTag,
  pollId,
  player,
  several,
  existing,
  options,
  labelOf,
  next,
}: {
  clanTag: string;
  pollId: string;
  player: { id: string; name: string; tag: string };
  several: boolean;
  existing: { optionId: string; note: string | null } | null;
  options: Array<{ id: string; label: string }>;
  labelOf: Map<string, string>;
  next: { name: string } | null;
}) {
  const chosen = existing ? labelOf.get(existing.optionId) : null;
  return (
    <form action={submitAnswer} className="cb-sunken space-y-4 rounded-panel p-4">
      <input type="hidden" name="clanTag" value={clanTag} />
      <input type="hidden" name="pollId" value={pollId} />
      <input type="hidden" name="playerId" value={player.id} />

      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-medium">
          {several && <span className="text-muted-foreground font-normal">Answering for </span>}
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
              className="has-checked:border-primary has-checked:bg-accent has-checked:ring-primary/30 bg-tile flex cursor-pointer items-center gap-3 rounded-control border-2 px-4 py-3 text-sm font-medium transition-colors has-checked:ring-2 hover:bg-accent/50"
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

      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton variant="gold" pendingLabel="Saving">
          {existing ? "Update answer" : "Save answer"}
        </SubmitButton>
        <p className="text-muted-foreground text-xs">
          {next
            ? `Saving moves on to ${next.name}, which still needs an answer.`
            : "You can change your answer until the poll closes."}
        </p>
      </div>
    </form>
  );
}

/** One person in a leader's list: name, Town Hall, and their clan on a family poll. */
function PersonRow({
  person,
  fallback,
  showClan,
  note,
  changed = false,
}: {
  person: Eligible | undefined;
  fallback: { playerId: string; name: string; tag: string };
  showClan: boolean;
  note?: string | null;
  changed?: boolean;
}) {
  return (
    <li className="px-3 py-2 text-sm">
      <span className="flex items-center gap-2">
        <TownHall level={person?.thLevel ?? null} />
        <span className="min-w-0 flex-1 truncate">{fallback.name}</span>
        {changed && <Badge variant="outline">changed answer</Badge>}
        {showClan && person && (
          <span className="text-muted-foreground flex shrink-0 items-center gap-1.5 text-xs">
            <span
              aria-hidden
              className="size-2 rounded-full"
              style={{ background: clanAccent(person.clanId).color }}
            />
            {person.clanName}
          </span>
        )}
      </span>
      {note && <span className="text-muted-foreground block pl-9 text-xs">“{note}”</span>}
    </li>
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
