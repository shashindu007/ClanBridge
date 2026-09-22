// T6.3, T6.4, T6.5 — War board, target assignment, plan vs outcome.
//
// Keep war_targets (the plan) separate from war_attacks (what happened). Never
// merge them. The two sit side by side in the same row of the roster table
// below, and that adjacency IS T6.5 — one column says what a member was told to
// do and the next says what they did. A single reconciled column would be
// shorter, easier to read, and would delete the only thing this page knows that
// a screenshot of the in-game war map does not.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHAT IS AT THE TOP, AND WHY IT IS NOT THE SCOREBOARD
//
// Who has not attacked, first. It is the list the leader acts on, and the one
// thing the WhatsApp-and-logbook workflow could never produce reliably. The
// score is already in the game; the chase list is not.
//
// And it counts ATTACKS, not people. A war gives two each, so a member who used
// one is half a miss — fifteen of those is a whole roster's worth of attacks
// unspent, and a page listing only the people who did nothing at all would
// report that clan as fine. services/war.ts has the argument in full.
// ─────────────────────────────────────────────────────────────────────────────
//
// REDESIGNED FOR A FIRST-TIME VISITOR. Top to bottom it now answers: what is the
// score and how many attacks are left (scoreboard), what should I do (your
// attacks, with free bases as buttons instead of a dropdown of bare numbers), who
// still has to attack (split into "not at all" and "one left"), and then the
// plan-versus-result table and the enemy bases, with every column labelled in
// words ("Our base", "Target", "Attacked") and the assign control saying "Assign"
// and "Change" rather than "Set". The page's error Alert is gone: the toast
// already shows every ?error=, and the page said it twice.
//
// R1 — PostgreSQL only, never the Clash of Clans API. R3 — the war is resolved
// under an explicit clan filter, so every roster, attack and target below it is
// known to belong here.

import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { SubmitButton } from "@/components/submit-button";
import { DataFreshness } from "@/components/data-freshness";
import { TownHall } from "@/components/lineup-parts";
import { PageHeader } from "@/components/page-header";
import { Stars, Stat } from "@/components/stars";
import { currentUserId } from "@/lib/auth";
import { requireClanByTag } from "@/lib/clans";
import { isLeader, isLeadership } from "@/lib/visibility";
import { createClient } from "@/lib/supabase/server";
import { myPlayers } from "@/repositories/polls";
import { latestRun } from "@/repositories/sync-log";
import {
  assignTarget,
  attacksForWar,
  claimTarget,
  clearTarget,
  currentWar,
  membersOfWar,
  opponentsOfWar,
  releaseTarget,
  targetsForWar,
  warById,
  type WarRow,
} from "@/repositories/war";
import {
  enemyBoard,
  outstandingAttacks,
  parseBasePosition,
  warRecord,
  type MemberWarRecord,
} from "@/services/war";
import { freshness } from "@/services/freshness";
import { LocalTime } from "@/components/local-time";

export const dynamic = "force-dynamic";

function stateBadge(war: WarRow) {
  if (war.state === "preparation") return <Badge variant="info">Preparation day</Badge>;
  if (war.state === "inWar") return <Badge variant="warning">Battle day</Badge>;
  if (war.result === "win") return <Badge variant="success">Won</Badge>;
  if (war.result === "lose") return <Badge variant="destructive">Lost</Badge>;
  if (war.result === "tie") return <Badge variant="secondary">Tie</Badge>;
  return <Badge variant="outline">Ended</Badge>;
}

/**
 * Every write on this page, through the definer functions in 024 and 025.
 *
 * Those functions are the authority — not this action, and not the buttons it
 * renders. They check the role, the clan, whether the player is in the war and
 * whether it has ended, and they write audit_log in the same statement. This
 * only routes and reports. A role check here as well would be a second opinion
 * that can disagree with the first, and the first is the one that counts.
 *
 * The ONE thing it does check is the base number, because nothing else does.
 * 003's war_targets has no range CHECK and neither definer function validates
 * the position, so the range is unowned — and an unowned check is not a second
 * opinion, it is the only one. See parseBasePosition.
 */
async function mutate(formData: FormData) {
  "use server";

  const supabase = await createClient();
  const userId = await currentUserId(supabase);
  if (!userId) redirect("/login");

  const clanTag = String(formData.get("clanTag") ?? "");
  const warId = String(formData.get("warId") ?? "");
  const action = String(formData.get("action") ?? "");
  const playerId = String(formData.get("playerId") ?? "");
  const note = String(formData.get("note") ?? "").trim() || null;

  const here = `/${encodeURIComponent(clanTag)}/war?war=${encodeURIComponent(warId)}`;

  // Only for the two actions that carry one. Resolving the war costs two
  // queries, so clear and release — which have no position — do not pay for it.
  let position = Number.NaN;
  if (action === "assign" || action === "claim") {
    const clan = await requireClanByTag(supabase, clanTag);
    const war = await warById(supabase, clan.id, warId);
    const parsed = parseBasePosition(formData.get("position"), war?.teamSize ?? null);
    if (parsed === null) redirect(`${here}&error=pick-a-base`);
    position = parsed;
  }

  let result: { error?: string } = {};
  let done = "";
  if (action === "assign") {
    result = await assignTarget(supabase, warId, playerId, position, note);
    done = "target-assigned";
  } else if (action === "clear") {
    result = await clearTarget(supabase, warId, playerId);
    done = "target-cleared";
  } else if (action === "claim") {
    result = await claimTarget(supabase, warId, position, note);
    done = "target-claimed";
  } else if (action === "release") {
    result = await releaseTarget(supabase, warId);
    done = "target-released";
  } else {
    redirect(`${here}&error=unknown-action`);
  }

  // The functions' own messages name the reason — "base 4 is already taken",
  // "that player is not in this war", "this war has ended". Passed through
  // verbatim, because each of those is actionable and "could not save" is not.
  if (result.error) redirect(`${here}&error=${encodeURIComponent(result.error)}`);

  revalidatePath(here);
  // `&`, not `?` — `here` already carries the war id. Getting this wrong makes
  // a second query string that silently drops the war being looked at.
  redirect(`${here}&ok=${done}`);
}

export default async function WarBoardPage({
  params,
  searchParams,
}: {
  params: Promise<{ clanTag: string }>;
  searchParams: Promise<{ war?: string }>;
}) {
  const { clanTag } = await params;
  const { war: requestedWar } = await searchParams;
  const supabase = await createClient();

  const clan = await requireClanByTag(supabase, clanTag);
  const userId = await currentUserId(supabase);
  if (!userId) redirect("/login");

  const base = `/${encodeURIComponent(clan.tag)}`;
  const runs = freshness(await latestRun(supabase, "war", clan.id));

  // R3 — warById filters by clan, so a war id from another clan pasted into the
  // URL resolves to nothing and falls through to "no war", not to their data.
  const war = requestedWar
    ? await warById(supabase, clan.id, requestedWar)
    : await currentWar(supabase, clan.id);

  const header = (
    <PageHeader
      eyebrow={clan.name}
      title="War board"
      description="The current war: who still has attacks to use, and which base each member should hit."
      actions={<DataFreshness freshness={runs} canAdmin={isLeader(clan.role)} />}
    />
  );

  if (!war) {
    return (
      <main className="mx-auto max-w-5xl space-y-6 p-4 sm:p-8">
        {header}
        <section className="cb-panel space-y-3 rounded-lg border p-6">
          <h2 className="cb-title text-xl">No war right now</h2>
          {/* T9.10 — not being at war is the ordinary state, so this says what
              to do rather than apologising for an empty page. */}
          <p className="text-muted-foreground text-sm">
            {runs.level === "never"
              ? "The war sync has never run. It goes out hourly alongside the clan sync once the API key is configured."
              : "This board fills in by itself within an hour of a war being declared in game."}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm">
              <Link href={`${base}/war/lineup`}>Plan the next lineup</Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link href={`${base}/war/history`}>See past wars</Link>
            </Button>
          </div>
        </section>
      </main>
    );
  }

  const [members, attacks, targets, opponents, mine] = await Promise.all([
    membersOfWar(supabase, war.id),
    attacksForWar(supabase, war.id),
    targetsForWar(supabase, war.id),
    opponentsOfWar(supabase, war.id),
    myPlayers(supabase, userId),
  ]);

  const record = warRecord(members, attacks, targets);
  const outstanding = outstandingAttacks(record);
  const size = war.teamSize ?? members.length;
  const board = enemyBoard(size, opponents, attacks, members, targets);
  const baseByPosition = new Map(board.map((b) => [b.position, b]));

  const leadership = isLeadership(clan.role);
  const ended = war.state === "warEnded";
  const preparation = war.state === "preparation";

  // One member can hold two villages and be in the war twice, so this is a set.
  const myPlayerIds = new Set(mine.map((p) => p.id));
  const myRecord = record.filter((r) => myPlayerIds.has(r.playerId));
  const attacksAllowed = record.reduce((total, m) => total + m.attacksAllowed, 0);
  const attacksUsed = record.reduce((total, m) => total + m.attacksUsed, 0);
  const attacksLeft = attacksAllowed - attacksUsed;
  const freeBases = board.filter((b) => b.free);
  const noAttacks = outstanding.filter((m) => m.attacksUsed === 0);
  const oneLeft = outstanding.filter((m) => m.attacksUsed > 0);
  const targetLabel = (position: number) => {
    const b = baseByPosition.get(position);
    return `Base ${position}${b?.thLevel ? ` · TH ${b.thLevel}` : ""}`;
  };

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-4 sm:p-8">
      {header}

      {/* ── Scoreboard ───────────────────────────────────────────────────── */}
      <section className="cb-panel space-y-5 rounded-lg border p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <p className="text-muted-foreground text-sm">
              {size} vs {size} ·{" "}
              {preparation ? "Battle day starts " : ended ? "Ended " : "Battle day ends "}
              {/* The one timestamp here a member ACTS on, so it upgrades to their
                  real timezone rather than the clan default. */}
              <LocalTime iso={preparation ? war.startTime : war.endTime} style="weekday" />
            </p>
            <h2 className="cb-title text-2xl">
              {clan.name} <span className="text-muted-foreground font-normal">vs</span>{" "}
              {war.opponentName ?? "unknown opponent"}
            </h2>
          </div>
          {stateBadge(war)}
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Stat label="Stars" value={`${war.ourStars ?? 0} – ${war.theirStars ?? 0}`} hint="us – them" />
          <Stat
            label="Destruction"
            value={`${(war.ourDestruction ?? 0).toFixed(1)}%`}
            hint={`them ${(war.theirDestruction ?? 0).toFixed(1)}%`}
          />
          <div className="space-y-2">
            <p className="text-muted-foreground text-xs font-medium uppercase">Our attacks</p>
            <p className="text-2xl font-semibold tabular-nums">
              {attacksUsed} <span className="text-muted-foreground text-base font-normal">of {attacksAllowed} used</span>
            </p>
            <Progress
              value={attacksAllowed ? (attacksUsed / attacksAllowed) * 100 : 0}
              label={`${attacksUsed} of ${attacksAllowed} attacks used`}
            />
          </div>
        </div>

        {preparation && (
          <p className="text-muted-foreground text-sm">
            Preparation day — nobody can attack yet. This is the time to give everyone a
            base to hit, so the first hour of battle day is not spent deciding.
          </p>
        )}
      </section>

      {/* ── The member's own plan, before anything about anyone else ─────── */}
      {myRecord.length > 0 && (
        <section className="cb-panel space-y-4 rounded-lg border p-6">
          <div className="space-y-1">
            <h2 className="cb-title text-xl">Your attacks</h2>
            <p className="text-muted-foreground text-sm">
              {leadership
                ? "Your own villages in this war."
                : "Claim a free base so everyone knows it is taken. A leader can still reassign it."}
            </p>
          </div>

          {myRecord.map((m) => (
            <div key={m.playerId} className="bg-card space-y-3 rounded-md border p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium">
                  {m.name} <span className="text-muted-foreground text-sm font-normal">· our base {m.mapPosition ?? "?"}</span>
                </p>
                <Badge variant={m.attacksRemaining === 0 ? "success" : "outline"}>
                  {m.attacksUsed} of {m.attacksAllowed} attacks used
                </Badge>
              </div>

              {m.target ? (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm">
                    Your target: <span className="font-semibold">{targetLabel(m.target.targetPosition)}</span>
                    {m.target.note && <span className="text-muted-foreground"> — {m.target.note}</span>}
                    <span className="text-muted-foreground block text-xs">
                      {m.target.assignedBy === userId ? "You claimed this base." : "Assigned by your leader."}
                    </span>
                  </p>
                  {/* Only your own claim can be given back. A leader's assignment is
                      theirs to withdraw — 025 refuses, and the button is not offered. */}
                  {!ended && m.target.assignedBy === userId && (
                    <form action={mutate}>
                      <input type="hidden" name="clanTag" value={clan.tag} />
                      <input type="hidden" name="warId" value={war.id} />
                      <input type="hidden" name="action" value="release" />
                      <SubmitButton size="sm" variant="outline" pendingLabel="Releasing">
                        Give this base back
                      </SubmitButton>
                    </form>
                  )}
                </div>
              ) : ended ? (
                <p className="text-muted-foreground text-sm">No target was set for this war.</p>
              ) : leadership ? (
                <p className="text-muted-foreground text-sm">No target yet — set one in the lineup table below.</p>
              ) : freeBases.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  Every base is already assigned or attacked. Ask your leader where to hit.
                </p>
              ) : (
                <div className="space-y-2">
                  <p className="text-sm">Pick a free base to claim:</p>
                  {/* One button per free base: a tap on "Base 7 · TH 15" is a clearer
                      choice than a dropdown of bare numbers. */}
                  <div className="flex flex-wrap gap-2">
                    {freeBases.map((b) => (
                      <form key={b.position} action={mutate}>
                        <input type="hidden" name="clanTag" value={clan.tag} />
                        <input type="hidden" name="warId" value={war.id} />
                        <input type="hidden" name="action" value="claim" />
                        <input type="hidden" name="position" value={b.position} />
                        <SubmitButton
                          size="sm"
                          variant="outline"
                          pendingLabel="Claiming"
                          aria-label={`Claim base ${b.position}${b.name ? `, ${b.name}` : ""}`}
                        >
                          {targetLabel(b.position)}
                        </SubmitButton>
                      </form>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </section>
      )}

      {/* ── T6.3 — who still has attacks. Counts ATTACKS, not people. ─────── */}
      {!preparation && (
        <section className="cb-panel space-y-4 rounded-lg border p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="cb-title text-xl">Still to attack</h2>
            <Badge variant={attacksLeft === 0 ? "success" : "warning"}>
              {attacksLeft === 0 ? "All attacks used" : `${attacksLeft} attack${attacksLeft === 1 ? "" : "s"} left`}
            </Badge>
          </div>

          {outstanding.length === 0 ? (
            <p className="text-muted-foreground text-sm">Every member has used all their attacks.</p>
          ) : (
            <div className="grid gap-6 md:grid-cols-2">
              <ChaseList
                title="Has not attacked at all"
                empty="Everyone has attacked at least once."
                members={noAttacks}
                base={base}
                targetLabel={targetLabel}
              />
              <ChaseList
                title="One attack left"
                empty="Nobody is part-way through."
                members={oneLeft}
                base={base}
                targetLabel={targetLabel}
              />
            </div>
          )}
        </section>
      )}

      {/* ── T6.5 — the plan and the outcome, adjacent and never merged ───── */}
      <section className="cb-panel space-y-4 rounded-lg border p-6">
        <div className="space-y-1">
          <h2 className="cb-title text-xl">Our lineup: plan and result</h2>
          <p className="text-muted-foreground text-sm">
            <span className="text-foreground font-medium">Target</span> is the base a member
            was told to hit, or claimed. <span className="text-foreground font-medium">Attacked</span>{" "}
            is what they actually hit. They sit side by side so a change of plan is visible.
          </p>
        </div>

        <div className="-mx-6 overflow-x-auto px-6">
          <table className="w-full min-w-[40rem] text-sm">
            <thead className="text-muted-foreground border-b text-left text-xs uppercase">
              <tr>
                <th className="py-2 pr-3 font-medium">Our base</th>
                <th className="py-2 pr-3 font-medium">Member</th>
                <th className="py-2 pr-3 font-medium">Target</th>
                <th className="py-2 pr-3 font-medium">Attacked</th>
                <th className="py-2 pr-3 text-right font-medium">Stars</th>
              </tr>
            </thead>
            <tbody>
              {record.map((m) => (
                <tr key={m.playerId} className="border-b align-top last:border-0">
                  <td className="text-muted-foreground py-3 pr-3 tabular-nums">#{m.mapPosition ?? "?"}</td>
                  <td className="py-3 pr-3">
                    <Link
                      className="font-medium underline-offset-2 hover:underline"
                      href={`${base}/player/${encodeURIComponent(m.tag)}`}
                    >
                      {m.name}
                    </Link>
                    <span className="mt-1 flex flex-wrap items-center gap-2">
                      <TownHall level={m.thLevel} />
                      <span className="text-muted-foreground text-xs tabular-nums">
                        {m.attacksUsed} of {m.attacksAllowed} attacks
                      </span>
                    </span>
                  </td>

                  {/* THE PLAN */}
                  <td className="py-3 pr-3">
                    {m.target ? (
                      <span className="block">
                        <span className="font-medium">{targetLabel(m.target.targetPosition)}</span>
                        {m.target.note && (
                          <span className="text-muted-foreground block text-xs">{m.target.note}</span>
                        )}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">No target</span>
                    )}

                    {leadership && !ended && (
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <form action={mutate} className="flex items-center gap-1.5">
                          <input type="hidden" name="clanTag" value={clan.tag} />
                          <input type="hidden" name="warId" value={war.id} />
                          <input type="hidden" name="action" value="assign" />
                          <input type="hidden" name="playerId" value={m.playerId} />
                          <select
                            name="position"
                            aria-label={`Target for ${m.name}`}
                            className="border-input bg-background h-8 max-w-44 rounded-md border px-2 text-xs"
                            defaultValue={m.target?.targetPosition ?? ""}
                            required
                          >
                            <option value="" disabled>
                              Choose a base
                            </option>
                            {board.map((b) => (
                              <option key={b.position} value={b.position}>
                                {b.position}
                                {b.thLevel ? ` · TH ${b.thLevel}` : ""}
                                {b.free ? " · free" : b.assignedTo.length ? " · assigned" : ""}
                              </option>
                            ))}
                          </select>
                          <SubmitButton size="xs" variant="outline" pendingLabel="Saving">
                            {m.target ? "Change" : "Assign"}
                          </SubmitButton>
                        </form>
                        {m.target && (
                          <form action={mutate}>
                            <input type="hidden" name="clanTag" value={clan.tag} />
                            <input type="hidden" name="warId" value={war.id} />
                            <input type="hidden" name="action" value="clear" />
                            <input type="hidden" name="playerId" value={m.playerId} />
                            <SubmitButton size="xs" variant="ghost" pendingLabel="Removing">
                              Remove
                            </SubmitButton>
                          </form>
                        )}
                      </div>
                    )}
                  </td>

                  {/* THE OUTCOME. Deliberately the next column and not the same one:
                      the gap between them is what this page is for. */}
                  <td className="py-3 pr-3">
                    {m.attacks.length === 0 ? (
                      <span className="text-muted-foreground">{preparation ? "—" : "Not yet"}</span>
                    ) : (
                      <span className="block space-y-1">
                        {m.attacks.map((a) => (
                          <span key={a.attackOrder} className="block tabular-nums">
                            Base {a.defenderPosition ?? "?"}{" "}
                            <Stars stars={a.stars} />{" "}
                            <span className="text-muted-foreground text-xs">{a.destruction.toFixed(0)}%</span>
                          </span>
                        ))}
                        {m.followedTarget === false && (
                          <Badge variant="outline">Different from target</Badge>
                        )}
                      </span>
                    )}
                  </td>

                  <td className="py-3 pr-3 text-right font-medium tabular-nums">
                    {m.attacks.length ? m.stars : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {ended && (
          <p className="text-muted-foreground text-xs">
            This war has ended, so targets can no longer be changed — deliberately. A plan
            that stays editable after the result is known always agrees with it.
          </p>
        )}
      </section>

      {/* ── T6.3 — the other side ─────────────────────────────────────────── */}
      <section className="cb-panel space-y-4 rounded-lg border p-6">
        <div className="space-y-1">
          <h2 className="cb-title text-xl">Their bases: {war.opponentName ?? "the opposition"}</h2>
          <p className="text-muted-foreground text-sm">
            <span className="text-foreground font-medium">Free</span> means nobody is assigned
            to it and nobody has attacked it yet.
          </p>
        </div>

        {opponents.length === 0 && (
          <p className="text-muted-foreground text-sm">
            The opposing lineup was not captured for this war. Base numbers are still right;
            only names and Town Hall levels are missing.
          </p>
        )}

        <div className="-mx-6 overflow-x-auto px-6">
          <table className="w-full min-w-[36rem] text-sm">
            <thead className="text-muted-foreground border-b text-left text-xs uppercase">
              <tr>
                <th className="py-2 pr-3 font-medium">Base</th>
                <th className="py-2 pr-3 font-medium">Player</th>
                <th className="py-2 pr-3 font-medium">Assigned to</th>
                <th className="py-2 font-medium">Best attack so far</th>
              </tr>
            </thead>
            <tbody>
              {board.map((b) => (
                <tr key={b.position} className="border-b align-top last:border-0">
                  <td className="py-3 pr-3 font-medium tabular-nums">{b.position}</td>
                  <td className="py-3 pr-3">
                    <span className="block">{b.name ?? <span className="text-muted-foreground">Unknown</span>}</span>
                    <span className="mt-1 inline-block">
                      <TownHall level={b.thLevel} />
                    </span>
                  </td>
                  <td className="py-3 pr-3">
                    {b.assignedTo.length ? (
                      b.assignedTo.map((a) => a.name).join(", ")
                    ) : b.free ? (
                      <Badge variant="info">Free</Badge>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="py-3">
                    {b.bestStars === null ? (
                      // Not "0 stars", which would read as somebody having attacked
                      // and failed — a different and worse thing to tell a leader.
                      <span className="text-muted-foreground">Not attacked yet</span>
                    ) : (
                      <span className="block">
                        <Stars stars={b.bestStars} />{" "}
                        <span className="text-muted-foreground text-xs tabular-nums">
                          {b.bestDestruction?.toFixed(0)}%
                        </span>
                        <span className="text-muted-foreground block text-xs">
                          by {b.attackedBy.map((a) => a.name).join(", ")}
                        </span>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

function ChaseList({
  title,
  empty,
  members,
  base,
  targetLabel,
}: {
  title: string;
  empty: string;
  members: MemberWarRecord[];
  base: string;
  targetLabel: (position: number) => string;
}) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium">
        {title} <span className="text-muted-foreground tabular-nums">({members.length})</span>
      </h3>
      {members.length === 0 ? (
        <p className="text-muted-foreground text-sm">{empty}</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {members.map((m) => (
            <li key={m.playerId} className="flex items-center gap-3 px-3 py-2">
              <span className="text-muted-foreground w-8 text-xs tabular-nums">#{m.mapPosition ?? "?"}</span>
              <Link
                className="min-w-0 flex-1 truncate text-sm font-medium underline-offset-2 hover:underline"
                href={`${base}/player/${encodeURIComponent(m.tag)}`}
              >
                {m.name}
              </Link>
              <span className="text-muted-foreground shrink-0 text-xs">
                {m.target ? targetLabel(m.target.targetPosition) : "No target"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
