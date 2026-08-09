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
// R1 — PostgreSQL only, never the Clash of Clans API. R3 — the war is resolved
// under an explicit clan filter, so every roster, attack and target below it is
// known to belong here.

import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataFreshness } from "@/components/data-freshness";
import { currentUserId } from "@/lib/auth";
import { requireClanByTag } from "@/lib/clans";
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
} from "@/services/war";
import { freshness, type Freshness } from "@/services/freshness";

export const dynamic = "force-dynamic";

function isLeadership(role: string): boolean {
  return role === "leader" || role === "co-leader";
}

/** UTC in the database, local in the browser (T9.9). */
function when(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function stateBadge(war: WarRow) {
  if (war.state === "preparation") return <Badge variant="secondary">Preparation</Badge>;
  if (war.state === "inWar") return <Badge>Battle day</Badge>;
  if (war.result === "win") return <Badge>Won</Badge>;
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
  if (action === "assign") {
    result = await assignTarget(supabase, warId, playerId, position, note);
  } else if (action === "clear") {
    result = await clearTarget(supabase, warId, playerId);
  } else if (action === "claim") {
    result = await claimTarget(supabase, warId, position, note);
  } else if (action === "release") {
    result = await releaseTarget(supabase, warId);
  } else {
    redirect(`${here}&error=unknown-action`);
  }

  // The functions' own messages name the reason — "base 4 is already taken",
  // "that player is not in this war", "this war has ended". Passed through
  // verbatim, because each of those is actionable and "could not save" is not.
  if (result.error) redirect(`${here}&error=${encodeURIComponent(result.error)}`);

  revalidatePath(here);
  redirect(here);
}

export default async function WarBoardPage({
  params,
  searchParams,
}: {
  params: Promise<{ clanTag: string }>;
  searchParams: Promise<{ war?: string; error?: string }>;
}) {
  const { clanTag } = await params;
  const { war: requestedWar, error } = await searchParams;
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

  if (!war) {
    return (
      <main className="mx-auto max-w-4xl space-y-6 p-8">
        <BoardHeader clanName={clan.name} base={base} runs={runs} />
        <section className="space-y-3 rounded-lg border p-6">
          <h2 className="font-medium">No war recorded</h2>
          {/* T9.10 — not being at war is the ordinary state, so this says what
              to do rather than apologising for an empty page. */}
          <p className="text-muted-foreground text-sm">
            {runs.level === "never"
              ? "The war sync has never run. It goes out hourly alongside the clan sync once the API key is configured."
              : "Nobody is at war right now. The board fills in automatically within the hour of a war being declared in game."}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm" variant="outline">
              <Link href={`${base}/war/lineup`}>Plan the next lineup</Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link href={`${base}/war/history`}>Past wars</Link>
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

  const leadership = isLeadership(clan.role);
  const ended = war.state === "warEnded";

  // Which of these war members is the caller. One member can hold two villages
  // and be in the war twice, so this is a set — and the claim control only
  // appears for rows that are actually theirs.
  const myPlayerIds = new Set(mine.map((p) => p.id));
  const myRecord = record.filter((r) => myPlayerIds.has(r.playerId));
  const attacksLeft = record.reduce((total, m) => total + m.attacksRemaining, 0);
  const positions = Array.from({ length: size }, (_, i) => i + 1);

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-8">
      <BoardHeader clanName={clan.name} base={base} runs={runs} />

      {error && (
        <Alert variant="destructive">
          <AlertTitle>That did not work</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* ── Scoreboard ───────────────────────────────────────────────────── */}
      <section className="space-y-3 rounded-lg border p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-medium">
            {clan.name} vs {war.opponentName ?? "unknown"}
          </h2>
          {stateBadge(war)}
        </div>

        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
          <p className="text-2xl font-semibold tabular-nums">
            {war.ourStars ?? 0} <span className="text-muted-foreground text-base">–</span>{" "}
            {war.theirStars ?? 0}
          </p>
          <p className="text-muted-foreground text-sm tabular-nums">
            {(war.ourDestruction ?? 0).toFixed(1)}% vs {(war.theirDestruction ?? 0).toFixed(1)}%
          </p>
          <p className="text-muted-foreground text-sm">
            {size}v{size} · {war.state === "preparation" ? "starts" : "ends"}{" "}
            {when(war.state === "preparation" ? war.startTime : war.endTime)}
          </p>
        </div>
      </section>

      {/* ── T6.3 — the list that is the point ────────────────────────────── */}
      <section className="space-y-4 rounded-lg border p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-medium">
            Attacks not used{" "}
            <span className="text-muted-foreground font-normal tabular-nums">
              ({attacksLeft})
            </span>
          </h2>
          {attacksLeft === 0 && <Badge>All used</Badge>}
        </div>

        {war.state === "preparation" ? (
          <p className="text-muted-foreground text-sm">
            Preparation day — nobody can attack yet. Assign targets below so the
            first hour of battle day is not spent deciding.
          </p>
        ) : outstanding.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            Every member has used both attacks. This is rarer than it should be.
          </p>
        ) : (
          <ul className="divide-y">
            {outstanding.map((m) => (
              <li key={m.playerId} className="flex items-center gap-3 py-2">
                <span className="text-muted-foreground w-6 text-sm tabular-nums">
                  {m.mapPosition ?? "—"}
                </span>
                <Link
                  className="min-w-0 flex-1 truncate text-sm underline-offset-2 hover:underline"
                  href={`${base}/player/${encodeURIComponent(m.tag)}`}
                >
                  {m.name}
                </Link>
                {/* "1 of 2" — the distinction a boolean would erase. */}
                <Badge variant={m.missedEntirely ? "destructive" : "secondary"}>
                  {m.attacksUsed} of {m.attacksAllowed} used
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── T6.4, the member's half: claim a free base ───────────────────── */}
      {!leadership && myRecord.length > 0 && !ended && (
        <section className="space-y-3 rounded-lg border p-6">
          <h2 className="font-medium">Your target</h2>
          {myRecord.map((m) => (
            <div key={m.playerId} className="space-y-2">
              {myRecord.length > 1 && <p className="text-sm font-medium">{m.name}</p>}
              {m.target ? (
                <div className="flex flex-wrap items-center gap-3">
                  <p className="text-sm">
                    Base {m.target.targetPosition}
                    {m.target.note && (
                      <span className="text-muted-foreground"> — {m.target.note}</span>
                    )}
                  </p>
                  {/* Only your own claim can be given back. A target leadership
                      assigned is theirs to withdraw — 025 refuses, and the
                      button is not offered either. */}
                  {m.target.assignedBy === userId && (
                    <form action={mutate}>
                      <input type="hidden" name="clanTag" value={clan.tag} />
                      <input type="hidden" name="warId" value={war.id} />
                      <input type="hidden" name="action" value="release" />
                      <Button type="submit" size="xs" variant="ghost">
                        Give it back
                      </Button>
                    </form>
                  )}
                </div>
              ) : (
                <form action={mutate} className="flex flex-wrap items-end gap-2">
                  <input type="hidden" name="clanTag" value={clan.tag} />
                  <input type="hidden" name="warId" value={war.id} />
                  <input type="hidden" name="action" value="claim" />
                  <label className="text-sm">
                    <span className="text-muted-foreground block text-xs">Free base</span>
                    <select
                      name="position"
                      className="border-input bg-background h-9 rounded-md border px-2 text-sm"
                      defaultValue=""
                      required
                    >
                      <option value="" disabled>
                        Choose
                      </option>
                      {board
                        .filter((b) => b.free)
                        .map((b) => (
                          <option key={b.position} value={b.position}>
                            {b.position}
                            {b.thLevel ? ` — TH${b.thLevel}` : ""}
                          </option>
                        ))}
                    </select>
                  </label>
                  <Button type="submit" size="sm">
                    Claim it
                  </Button>
                </form>
              )}
            </div>
          ))}
          <p className="text-muted-foreground text-xs">
            Claiming tells everyone else the base is spoken for. It does not stop a
            leader reassigning it.
          </p>
        </section>
      )}

      {/* ── T6.5 — the plan and the outcome, adjacent and never merged ───── */}
      <section className="space-y-4 rounded-lg border p-6">
        <h2 className="font-medium">Our roster</h2>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-muted-foreground border-b text-left">
              <tr>
                <th className="py-2 pr-3 text-right font-medium">#</th>
                <th className="py-2 pr-3 font-medium">Member</th>
                <th className="py-2 pr-3 text-right font-medium">TH</th>
                <th className="py-2 pr-3 font-medium">Told to hit</th>
                <th className="py-2 pr-3 font-medium">Actually hit</th>
                <th className="py-2 pr-3 text-right font-medium">Stars</th>
                {leadership && !ended && <th className="py-2 font-medium">Assign</th>}
              </tr>
            </thead>
            <tbody>
              {record.map((m) => (
                <tr key={m.playerId} className="border-b last:border-0">
                  <td className="text-muted-foreground py-2 pr-3 text-right tabular-nums">
                    {m.mapPosition ?? "—"}
                  </td>
                  <td className="py-2 pr-3">
                    <Link
                      className="underline-offset-2 hover:underline"
                      href={`${base}/player/${encodeURIComponent(m.tag)}`}
                    >
                      {m.name}
                    </Link>
                    <span className="text-muted-foreground block text-xs tabular-nums">
                      {m.attacksUsed} of {m.attacksAllowed} attacks
                    </span>
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">{m.thLevel ?? "—"}</td>

                  {/* THE PLAN */}
                  <td className="py-2 pr-3">
                    {m.target ? (
                      <span className="tabular-nums">
                        {m.target.targetPosition}
                        {m.target.note && (
                          <span className="text-muted-foreground block text-xs">
                            {m.target.note}
                          </span>
                        )}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>

                  {/* THE OUTCOME. Deliberately the next column and not the same
                      one: the gap between them is what this page is for. */}
                  <td className="py-2 pr-3">
                    {m.attacks.length === 0 ? (
                      <span className="text-muted-foreground">nothing yet</span>
                    ) : (
                      <span className="tabular-nums">
                        {m.attacks.map((a) => a.defenderPosition ?? "?").join(", ")}
                        {m.followedTarget === false && (
                          <Badge variant="outline" className="ml-2">
                            off plan
                          </Badge>
                        )}
                      </span>
                    )}
                  </td>

                  <td className="py-2 pr-3 text-right tabular-nums">
                    {m.attacks.length ? m.stars : "—"}
                  </td>

                  {leadership && !ended && (
                    <td className="py-2">
                      <div className="flex items-center gap-1">
                        <form action={mutate} className="flex items-center gap-1">
                          <input type="hidden" name="clanTag" value={clan.tag} />
                          <input type="hidden" name="warId" value={war.id} />
                          <input type="hidden" name="action" value="assign" />
                          <input type="hidden" name="playerId" value={m.playerId} />
                          <select
                            name="position"
                            className="border-input bg-background h-6 rounded-md border px-1 text-xs"
                            defaultValue={m.target?.targetPosition ?? ""}
                            required
                          >
                            <option value="" disabled>
                              —
                            </option>
                            {positions.map((p) => (
                              <option key={p} value={p}>
                                {p}
                              </option>
                            ))}
                          </select>
                          <Button type="submit" size="xs" variant="outline">
                            Set
                          </Button>
                        </form>
                        {m.target && (
                          <form action={mutate}>
                            <input type="hidden" name="clanTag" value={clan.tag} />
                            <input type="hidden" name="warId" value={war.id} />
                            <input type="hidden" name="action" value="clear" />
                            <input type="hidden" name="playerId" value={m.playerId} />
                            <Button type="submit" size="xs" variant="ghost">
                              Clear
                            </Button>
                          </form>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {ended && (
          <p className="text-muted-foreground text-xs">
            This war has ended, so its plan can no longer be changed — deliberately.
            A plan that stays editable after the result is known is one that always
            agrees with it.
          </p>
        )}
      </section>

      {/* ── T6.3 — the other roster ──────────────────────────────────────── */}
      <section className="space-y-4 rounded-lg border p-6">
        <h2 className="font-medium">{war.opponentName ?? "The opposition"}</h2>

        {opponents.length === 0 && (
          <p className="text-muted-foreground text-sm">
            The opposing lineup was not captured for this war. Base numbers below
            are still correct; only the names and Town Hall levels are missing.
          </p>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-muted-foreground border-b text-left">
              <tr>
                <th className="py-2 pr-3 text-right font-medium">#</th>
                <th className="py-2 pr-3 font-medium">Base</th>
                <th className="py-2 pr-3 text-right font-medium">TH</th>
                <th className="py-2 pr-3 font-medium">Assigned</th>
                <th className="py-2 font-medium">Result</th>
              </tr>
            </thead>
            <tbody>
              {board.map((b) => (
                <tr key={b.position} className="border-b last:border-0">
                  <td className="text-muted-foreground py-2 pr-3 text-right tabular-nums">
                    {b.position}
                  </td>
                  <td className="py-2 pr-3">
                    {b.name ?? <span className="text-muted-foreground">unknown</span>}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">{b.thLevel ?? "—"}</td>
                  <td className="text-muted-foreground py-2 pr-3">
                    {b.assignedTo.length
                      ? b.assignedTo.map((a) => a.name).join(", ")
                      : b.free
                        ? "free"
                        : "—"}
                  </td>
                  <td className="py-2">
                    {b.bestStars === null ? (
                      // Not "0 stars", which would read as somebody having
                      // attacked and failed — a different and worse thing to
                      // tell a leader mid-war.
                      <span className="text-muted-foreground">not hit</span>
                    ) : (
                      <span className="tabular-nums">
                        {"★".repeat(b.bestStars)}
                        {"☆".repeat(3 - b.bestStars)}{" "}
                        <span className="text-muted-foreground">
                          {b.bestDestruction?.toFixed(0)}%
                        </span>
                        <span className="text-muted-foreground block text-xs">
                          {b.attackedBy.map((a) => a.name).join(", ")}
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

function BoardHeader({
  clanName,
  base,
  runs,
}: {
  clanName: string;
  base: string;
  runs: Freshness;
}) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">War board</h1>
        <DataFreshness freshness={runs} />
      </div>
      <p className="text-muted-foreground text-sm">
        {clanName} ·{" "}
        <Link className="underline" href={`${base}/war/lineup`}>
          lineup
        </Link>{" "}
        ·{" "}
        <Link className="underline" href={`${base}/war/history`}>
          history
        </Link>{" "}
        ·{" "}
        <Link className="underline" href={`${base}/war/report`}>
          contribution
        </Link>
      </p>
    </div>
  );
}
