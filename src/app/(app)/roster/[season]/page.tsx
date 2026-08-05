// T4B.7, T4B.8, T4B.9 — the availability pool, the roster builder, and publish.
//
// This is the screen the decision is actually made on, so everything needed to
// decide has to be on it: poll answer, current clan, Town Hall, and last
// season's CWL record. A leader who has to open three other pages to check one
// player will do it for the first five and guess for the rest.
//
// Spans every clan the leader runs, which is why it lives outside [clanTag]. The
// double-booking guard in migration 011 is what makes that safe: assigning
// someone already picked elsewhere raises, and the message names the clan they
// are in.
//
// Saved continuously as a draft. There is no "save" button because there is
// nothing to lose — each add and remove is its own write. The leader will not
// finish in one sitting, and a form that loses an hour of cross-referencing to a
// closed tab is a form nobody uses twice.

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { currentUserId } from "@/lib/auth";
import { visibleClans, type VisibleClan } from "@/lib/clans";
import { createClient } from "@/lib/supabase/server";
import { membersForClan } from "@/repositories/members";
import { playerSeasonHistory } from "@/repositories/cwl";
import {
  optionsForPoll,
  pollsForClan,
  responsesForPoll,
  type PollResponse,
} from "@/repositories/polls";
import {
  addToRoster,
  membersOfRoster,
  publishRoster,
  removeFromRoster,
  rostersForSeason,
  unpublishRoster,
  type Roster,
  type RosterMember,
} from "@/repositories/rosters";

export const dynamic = "force-dynamic";

function isLeadership(role: string): boolean {
  return role === "leader" || role === "co-leader";
}

async function mutate(formData: FormData) {
  "use server";

  const supabase = await createClient();
  const userId = await currentUserId(supabase);
  if (!userId) redirect("/login");

  const season = String(formData.get("season") ?? "");
  const action = String(formData.get("action") ?? "");
  const rosterId = String(formData.get("rosterId") ?? "");
  const playerId = String(formData.get("playerId") ?? "");
  const here = `/roster/${encodeURIComponent(season)}`;

  let result: { error?: string } = {};
  if (action === "add") result = await addToRoster(supabase, rosterId, playerId, userId);
  else if (action === "remove") result = await removeFromRoster(supabase, rosterId, playerId);
  else if (action === "publish") result = await publishRoster(supabase, rosterId);
  else if (action === "unpublish") result = await unpublishRoster(supabase, rosterId);
  else redirect(`${here}?error=unknown-action`);

  // The double-booking guard's message names the clashing clan, so it is passed
  // through verbatim. "Already in the Clan B roster" is actionable; a generic
  // "constraint violation" sends the leader hunting through three rosters.
  if (result.error) redirect(`${here}?error=${encodeURIComponent(result.error)}`);

  revalidatePath(here);
  redirect(here);
}

interface PoolPlayer {
  playerId: string;
  tag: string;
  name: string;
  thLevel: number | null;
  clanId: string;
  clanName: string;
  answer: string | null;
  answerNote: string | null;
  lastSeasonAttacks: number | null;
  lastSeasonMissed: number | null;
  assignedTo: string | null;
}

export default async function RosterBuilderPage({
  params,
  searchParams,
}: {
  params: Promise<{ season: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { season: rawSeason } = await params;
  const { error } = await searchParams;
  const season = decodeURIComponent(rawSeason);
  const supabase = await createClient();

  const userId = await currentUserId(supabase);
  if (!userId) redirect("/login");

  const clans = await visibleClans(supabase, userId);
  const leads = clans.filter((c) => isLeadership(c.role));

  const rosters = await rostersForSeason(supabase, season);
  if (rosters.length === 0) notFound();

  // Rosters this caller may actually edit. RLS already restricts what came back;
  // this is the mechanism to the policy's net (R3).
  const editable = rosters.filter((r) => leads.some((c) => c.id === r.clanId));

  // ── The availability pool (T4B.7) ────────────────────────────────────────
  //
  // Every player across every clan the leader runs, with the four things that
  // decide a slot. Assembled here rather than in SQL because it spans three
  // tables that have no join path PostgREST can express.
  const rosterMembers = new Map<string, RosterMember[]>();
  for (const roster of rosters) {
    rosterMembers.set(roster.id, await membersOfRoster(supabase, roster.id));
  }

  const assignment = new Map<string, string>(); // playerId -> rosterId
  for (const [rosterId, members] of rosterMembers) {
    for (const m of members) assignment.set(m.playerId, rosterId);
  }

  // The season's availability poll, if one was opened. Family-scoped, so any
  // clan's list finds it.
  const polls = leads.length ? await pollsForClan(supabase, leads[0]!.id) : [];
  const availabilityPoll = polls.find(
    (p) => p.pollType === "cwl_availability" && (p.season === season || p.season === null),
  );
  let answers = new Map<string, PollResponse>();
  let optionLabel = new Map<string, string>();
  if (availabilityPoll) {
    const [responses, options] = await Promise.all([
      responsesForPoll(supabase, availabilityPoll.id),
      optionsForPoll(supabase, availabilityPoll.id),
    ]);
    answers = new Map(responses.map((r) => [r.playerId, r]));
    optionLabel = new Map(options.map((o) => [o.id, o.label]));
  }

  const pool: PoolPlayer[] = [];
  for (const clan of leads) {
    for (const member of await membersForClan(supabase, clan.id)) {
      const history = await playerSeasonHistory(supabase, clan.id, member.playerId);
      const previous = history[0] ?? null;
      const answer = answers.get(member.playerId);
      pool.push({
        playerId: member.playerId,
        tag: member.tag,
        name: member.name,
        thLevel: member.thLevel,
        clanId: clan.id,
        clanName: clan.name,
        answer: answer ? (optionLabel.get(answer.optionId) ?? null) : null,
        answerNote: answer?.note ?? null,
        lastSeasonAttacks: previous ? previous.attacksUsed : null,
        lastSeasonMissed: previous ? previous.warsRostered - previous.attacksUsed : null,
        assignedTo: assignment.get(member.playerId) ?? null,
      });
    }
  }

  // In first, then Maybe, then unanswered, then Out — the order a leader works
  // down. Within a band, the highest Town Hall first.
  const answerRank = (a: string | null): number =>
    a === "In" ? 0 : a === "Maybe" ? 1 : a === null ? 2 : 3;
  pool.sort(
    (a, b) =>
      answerRank(a.answer) - answerRank(b.answer) ||
      (b.thLevel ?? 0) - (a.thLevel ?? 0) ||
      a.name.localeCompare(b.name),
  );

  const unassigned = pool.filter((p) => p.assignedTo === null);
  const clanById = new Map<string, VisibleClan>(clans.map((c) => [c.id, c]));

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-8">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">CWL {season}</h1>
        <p className="text-muted-foreground text-sm">
          Pick each clan&apos;s lineup. Saved as you go —{" "}
          <Link className="underline" href="/roster">
            all seasons
          </Link>
        </p>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertTitle>That did not work</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {!availabilityPoll && (
        <Alert>
          <AlertTitle>No availability poll for this season</AlertTitle>
          <AlertDescription>
            You can still pick a roster, but you are picking blind. Open a CWL
            availability poll from any clan&apos;s Polls page and the answers appear
            in the pool below.
          </AlertDescription>
        </Alert>
      )}

      {/* ── The roster panels (T4B.8) ─────────────────────────────────────── */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {editable.map((roster) => {
          const clan = clanById.get(roster.clanId);
          const members = rosterMembers.get(roster.id) ?? [];
          const remaining = roster.slotCount - members.length;
          return (
            <RosterPanel
              key={roster.id}
              roster={roster}
              clanName={clan?.name ?? "Unknown clan"}
              members={members}
              remaining={remaining}
              season={season}
            />
          );
        })}
      </div>

      {/* ── The availability pool (T4B.7) ─────────────────────────────────── */}
      <section className="space-y-4 rounded-lg border p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-medium">
            Available{" "}
            <span className="text-muted-foreground font-normal">
              ({unassigned.length} unassigned of {pool.length})
            </span>
          </h2>
        </div>

        {pool.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No members found. Run the clan sync so the player list is populated.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-muted-foreground border-b text-left">
                <tr>
                  <th className="py-2 pr-3 font-medium">Player</th>
                  <th className="py-2 pr-3 font-medium">Clan</th>
                  <th className="py-2 pr-3 text-right font-medium">TH</th>
                  <th className="py-2 pr-3 font-medium">Answer</th>
                  <th className="py-2 pr-3 text-right font-medium">Last CWL</th>
                  <th className="py-2 font-medium">Assign to</th>
                </tr>
              </thead>
              <tbody>
                {pool.map((p) => (
                  <tr key={p.playerId} className="border-b last:border-0">
                    <td className="py-2 pr-3">
                      <span className="font-medium">{p.name}</span>
                      {p.answerNote && (
                        <span className="text-muted-foreground block text-xs">
                          {p.answerNote}
                        </span>
                      )}
                    </td>
                    <td className="text-muted-foreground py-2 pr-3">{p.clanName}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{p.thLevel ?? "—"}</td>
                    <td className="py-2 pr-3">
                      {p.answer === null ? (
                        <span className="text-muted-foreground">no answer</span>
                      ) : (
                        <Badge
                          variant={
                            p.answer === "In"
                              ? "default"
                              : p.answer === "Out"
                                ? "destructive"
                                : "secondary"
                          }
                        >
                          {p.answer}
                        </Badge>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {p.lastSeasonAttacks === null ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <>
                          {p.lastSeasonAttacks} used
                          {p.lastSeasonMissed! > 0 && (
                            <span className="text-destructive">
                              {" "}
                              / {p.lastSeasonMissed} missed
                            </span>
                          )}
                        </>
                      )}
                    </td>
                    <td className="py-2">
                      {p.assignedTo ? (
                        <span className="text-muted-foreground text-xs">
                          {clanById.get(
                            rosters.find((r) => r.id === p.assignedTo)?.clanId ?? "",
                          )?.name ?? "assigned"}
                        </span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {editable.map((roster) => (
                            <form key={roster.id} action={mutate}>
                              <input type="hidden" name="season" value={season} />
                              <input type="hidden" name="action" value="add" />
                              <input type="hidden" name="rosterId" value={roster.id} />
                              <input type="hidden" name="playerId" value={p.playerId} />
                              <Button type="submit" size="xs" variant="outline">
                                {clanById.get(roster.clanId)?.name ?? "Add"}
                              </Button>
                            </form>
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );

  // ── Panel, inline so it shares the server action above ───────────────────
  function RosterPanel({
    roster,
    clanName,
    members,
    remaining,
    season,
  }: {
    roster: Roster;
    clanName: string;
    members: RosterMember[];
    remaining: number;
    season: string;
  }) {
    const published = roster.status === "published";
    return (
      <section className="space-y-3 rounded-lg border p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-medium">{clanName}</h2>
          <Badge variant={published ? "default" : "outline"}>
            {published ? "published" : "draft"}
          </Badge>
        </div>

        <p className="text-muted-foreground text-sm tabular-nums">
          {members.length} of {roster.slotCount} slots
          {remaining > 0 && ` · ${remaining} left`}
          {remaining < 0 && (
            <span className="text-destructive"> · {Math.abs(remaining)} over</span>
          )}
        </p>

        {members.length === 0 ? (
          <p className="text-muted-foreground text-sm">Nobody picked yet.</p>
        ) : (
          <ul className="divide-y">
            {members.map((m) => (
              <li key={m.playerId} className="flex items-center gap-2 py-2">
                <span className="min-w-0 flex-1 truncate text-sm">{m.name}</span>
                <span className="text-muted-foreground text-xs tabular-nums">
                  {m.thLevel ?? "—"}
                </span>
                <form action={mutate}>
                  <input type="hidden" name="season" value={season} />
                  <input type="hidden" name="action" value="remove" />
                  <input type="hidden" name="rosterId" value={roster.id} />
                  <input type="hidden" name="playerId" value={m.playerId} />
                  <Button type="submit" size="xs" variant="ghost">
                    Drop
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        )}

        {/* T4B.9 — publishing is what members finally see, and it is recorded in
            audit_log by the update policy's trail. Republishing after a change
            records a new entry, because members ask when they were dropped and
            the answer should not depend on memory. */}
        <form action={mutate}>
          <input type="hidden" name="season" value={season} />
          <input type="hidden" name="action" value={published ? "unpublish" : "publish"} />
          <input type="hidden" name="rosterId" value={roster.id} />
          <Button
            type="submit"
            size="sm"
            variant={published ? "outline" : "default"}
            className="w-full"
            disabled={!published && members.length === 0}
          >
            {published ? "Back to draft" : "Publish to members"}
          </Button>
        </form>
      </section>
    );
  }
}
