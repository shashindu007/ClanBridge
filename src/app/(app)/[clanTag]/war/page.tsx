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
// REDESIGNED FOR A FIRST-TIME VISITOR, then again for a phone. Top to bottom:
//
//   the header      both clans' state as a ribbon (BATTLE DAY · 6h)
//   the scoreboard  the game's own picture of a war: two badges, VS, stars,
//                   destruction; then size, deadline and attacks used in a line.
//                   First, because it is what the page is about.
//   your attacks    attacks left, how each one went (base, stars, %), and what
//                   YOU should do next, with free bases as buttons — the first
//                   one gold, the page's one call to action
//   still to attack split into "not at all" and "one left"
//   the lineup      plan beside result
//   their bases     a board of cards, one per base: free / assigned (named) /
//                   attacked / three-starred, each in colour and in words
//
// REDESIGNED AGAIN (047). One member per base, for leadership too, so the
// board can say plainly who holds each base. The per-row <select> of bare
// numbers became pickers (components/war-assign.tsx): from a base, "who hits
// this?"; from a member, "which base?" — with bases someone holds shown locked
// and named. The score gained a ticking countdown and a grid of labelled
// numbers: attacks used, three-star hits, stars and destruction per attack,
// and enemy bases cleared.
//
// The last three FOLD (kit Disclosure), with their counts visible while
// folded: a 30-row table is one line until someone wants it. They open by
// default for the people who work them — leadership — and stay folded for a
// member, whose question is answered by the time they reach them.
//
// Every column is labelled in words ("Our base", "Target", "Attacked") and the
// assign control says "Assign" and "Change". The page's error Alert is gone:
// the toast already shows every ?error=, and the page said it twice.
//
// R1 — PostgreSQL only, never the Clash of Clans API. R3 — the war is resolved
// under an explicit clan filter, so every roster, attack and target below it is
// known to belong here.

import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { CalendarClock, Crosshair, Flag, Gauge, Percent, Shield, Star, Swords, Target, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/submit-button";
import { ActionForm, type ActionResult } from "@/components/action-form";
import { SyncBadge } from "@/components/sync-badge";
import { TownHall } from "@/components/lineup-parts";
import { PageHeader } from "@/components/page-header";
import { Stars } from "@/components/stars";
import { Disclosure, EmptyState, Panel, SectionHeader, StatTile, Tile } from "@/components/kit";
import { ClanBadge } from "@/components/game/clan-badge";
import { Ribbon } from "@/components/game/ribbon";
import { WarScoreboard } from "@/components/war-scoreboard";
import { BaseCard, BaseStateLegend } from "@/components/war-board";
import { AssignBaseButton, AssignMemberButton, WarPlanProvider } from "@/components/war-assign";
import { Countdown } from "@/components/countdown";
import { DAY_TONE_CLASS, dayTone } from "@/lib/war-status";
import { clanAccent } from "@/lib/clan-accent";
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
  warSummary,
  type MemberWarRecord,
} from "@/services/war";
import { freshness } from "@/services/freshness";
import { LocalTime } from "@/components/local-time";

export const dynamic = "force-dynamic";

/**
 * The war's state in words, as a ribbon under the title: game state, not status.
 * The time left ticks (Countdown) — it used to be computed once on the server
 * and then sat unchanged in an open tab for hours.
 */
function stateRibbon(war: WarRow) {
  if (war.state === "preparation") {
    return (
      <Ribbon tone="prep" icon={CalendarClock}>
        Preparation{war.startTime && <> · <Countdown iso={war.startTime} /></>}
      </Ribbon>
    );
  }
  if (war.state === "inWar") {
    return (
      <Ribbon tone="war" icon={Swords}>
        Battle day{war.endTime && <> · <Countdown iso={war.endTime} /></>}
      </Ribbon>
    );
  }
  const word =
    war.result === "win" ? "Won" : war.result === "lose" ? "Lost" : war.result === "tie" ? "Draw" : "Ended";
  return (
    <Ribbon tone="neutral" icon={Flag}>
      {word}
    </Ribbon>
  );
}

/**
 * Every write on this page, through the definer functions (050 is the latest).
 *
 * Those functions are the authority — not this action, and not the buttons it
 * renders. They check the role, the clan, whether the player is in the war,
 * whether the base is free, whether the member has an attack left to plan, and
 * whether the war has ended, and they write audit_log in the same statement.
 * This only routes and reports.
 *
 * The ONE thing it does check is the base number, because nothing else does.
 * 003's war_targets has no range CHECK and no definer function validates the
 * position, so the range is unowned — and an unowned check is not a second
 * opinion, it is the only one. See parseBasePosition.
 *
 * It RETURNS its result rather than redirecting (components/action-form.tsx):
 * a redirect remounted the board, folding every section back to its default
 * and jumping to the top after each assignment.
 */
async function mutate(formData: FormData): Promise<ActionResult> {
  "use server";

  const supabase = await createClient();
  const userId = await currentUserId(supabase);
  if (!userId) redirect("/login");

  const clanTag = String(formData.get("clanTag") ?? "");
  const warId = String(formData.get("warId") ?? "");
  const action = String(formData.get("action") ?? "");
  const playerId = String(formData.get("playerId") ?? "");
  const note = String(formData.get("note") ?? "").trim() || null;

  // Positions are checked against the war's own size. Resolving the war costs
  // two queries, so only the actions that carry a position pay for it.
  const needsWar = ["assign", "claim", "clear", "release"].includes(action) && formData.get("position") !== null;
  let teamSize: number | null = null;
  if (needsWar) {
    const clan = await requireClanByTag(supabase, clanTag);
    teamSize = (await warById(supabase, clan.id, warId))?.teamSize ?? null;
  }
  const position = (name: string) =>
    formData.get(name) === null || formData.get(name) === ""
      ? null
      : parseBasePosition(formData.get(name), teamSize);

  let result: { error?: string } = {};
  let done = "";
  if (action === "assign") {
    const base = position("position");
    if (base === null) return { error: "pick-a-base" };
    result = await assignTarget(supabase, warId, playerId, base, note, position("replace"));
    done = "target-assigned";
  } else if (action === "clear") {
    result = await clearTarget(supabase, warId, playerId, position("position"));
    done = "target-cleared";
  } else if (action === "claim") {
    const base = position("position");
    if (base === null) return { error: "pick-a-base" };
    result = await claimTarget(supabase, warId, base, note, playerId || null);
    done = "target-claimed";
  } else if (action === "release") {
    result = await releaseTarget(supabase, warId, playerId || null, position("position"));
    done = "target-released";
  } else {
    return { error: "unknown-action" };
  }

  // The functions' own messages name the reason — "base 4 is already assigned
  // to Kasun", "Ravi has no attacks left to plan". Passed through verbatim,
  // because each of those is actionable and "could not save" is not.
  if (result.error) return { error: result.error };

  // The route pattern, not the encoded URL: "#TAG" segments are easy to get
  // subtly wrong, and any revalidation makes Next return this page fresh.
  revalidatePath("/[clanTag]/war", "page");
  return { ok: done };
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
  const run = await latestRun(supabase, "war", clan.id);
  const runs = freshness(run);

  // R3 — warById filters by clan, so a war id from another clan pasted into the
  // URL resolves to nothing and falls through to "no war", not to their data.
  const war = requestedWar
    ? await warById(supabase, clan.id, requestedWar)
    : await currentWar(supabase, clan.id);

  const accent = clanAccent(clan.id).color;
  const header = (
    <PageHeader
      eyebrow={clan.name}
      title="War board"
      art={<ClanBadge src={clan.badgeUrl} name={clan.name} size="lg" tone={accent} priority />}
      ribbons={war ? stateRibbon(war) : <Ribbon tone="neutral">No war</Ribbon>}
      description="Who still has attacks to use, and which base each member should hit."
      actions={
        <SyncBadge run={run} clanTag={clan.tag} target="war" canAdmin={isLeader(clan.role)} />
      }
    />
  );

  if (!war) {
    return (
      <main className="mx-auto max-w-page space-y-6 p-4 sm:p-6">
        {header}
        {/* T9.10 — not being at war is the ordinary state, so this says what
            to do rather than apologising for an empty page. Past wars are one
            tab away (War → History), so they are not linked again here. */}
        <Tile accent={accent}>
          <EmptyState
            icon={Swords}
            title="No war right now"
            body={
              runs.level === "never"
                ? "The war sync has never run. It goes out hourly alongside the clan sync once the API key is configured."
                : "This board fills in by itself within an hour of a war being declared in game."
            }
            action={
              <Button asChild variant="gold">
                <Link href={`${base}/war/lineup`}>Plan the next lineup</Link>
              </Button>
            }
          />
        </Tile>
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
  const summary = warSummary(record, board);
  const { attacksAllowed, attacksUsed, attacksLeft } = summary;
  const freeBases = board.filter((b) => b.free);
  const noAttacks = outstanding.filter((m) => m.attacksUsed === 0);
  const oneLeft = outstanding.filter((m) => m.attacksUsed > 0);
  const targetLabel = (position: number) => {
    const b = baseByPosition.get(position);
    return `Base ${position}${b?.thLevel ? ` · TH ${b.thLevel}` : ""}`;
  };
  // The page's ONE gold button: the first free base you could claim, on the
  // first of your villages that still has an attack without a base.
  const claimsOpen = !ended && !leadership && freeBases.length > 0;
  const goldFor = claimsOpen ? myRecord.find((m) => m.targetSlotsLeft > 0)?.playerId ?? null : null;
  const hidden = { clanTag: clan.tag, warId: war.id };

  // The war's state as a coloured chip, in the same vocabulary the CWL day
  // tabs use, so "live" is the same yellow on both pages.
  const tone = dayTone(war.result, war.state);
  const toneClass = DAY_TONE_CLASS[tone];
  const stateWord = preparation
    ? "Preparation day"
    : ended
      ? war.result === "win"
        ? "Victory"
        : war.result === "lose"
          ? "Defeat"
          : war.result === "tie"
            ? "Draw"
            : "War ended"
      : "Battle day";

  const scoreboard = (
    <Panel banner aria-label="Score" className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm font-semibold ${toneClass.soft}`}
          >
            <span aria-hidden className={`size-2 rounded-full ${toneClass.dot} ${tone === "live" ? "animate-pulse" : ""}`} />
            {stateWord}
          </span>
          <span className="text-muted-foreground inline-flex items-center gap-1 text-sm">
            <Users aria-hidden className="size-4" />
            {size} vs {size}
          </span>
        </div>
        {/* The one timestamp here a member ACTS on: how long is left, ticking,
            and when that is in their own timezone. */}
        {ended ? (
          <p className="text-muted-foreground text-sm">
            Ended <LocalTime iso={war.endTime} style="weekday" />
          </p>
        ) : (
          <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
            <span className="text-muted-foreground">{preparation ? "Battle day starts in" : "Ends in"}</span>
            <Countdown
              iso={preparation ? war.startTime : war.endTime}
              className="cb-title text-lg"
            />
            <span className="text-muted-foreground">
              · <LocalTime iso={preparation ? war.startTime : war.endTime} style="weekday" />
            </span>
          </p>
        )}
      </div>

      <WarScoreboard
        us={{
          name: clan.name,
          stars: war.ourStars,
          destruction: war.ourDestruction,
          badgeUrl: clan.badgeUrl,
        }}
        them={{
          name: war.opponentName,
          stars: war.theirStars,
          destruction: war.theirDestruction,
          badgeUrl: war.opponentBadgeUrl,
        }}
        accent={accent}
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatTile
          label="Attacks used"
          icon={Target}
          value={`${attacksUsed} / ${attacksAllowed}`}
          sub={attacksLeft === 0 ? "all used" : `${attacksLeft} left`}
        >
          <div
            className="cb-gauge mt-1 h-1.5"
            role="img"
            aria-label={`${attacksUsed} of ${attacksAllowed} attacks used`}
            style={{ "--gauge": accent } as React.CSSProperties}
          >
            <span style={{ width: `${attacksAllowed ? (attacksUsed / attacksAllowed) * 100 : 0}%` }} />
          </div>
        </StatTile>
        <StatTile
          label="Three-star hits"
          icon={Star}
          value={summary.threeStars}
          sub={attacksUsed ? `of ${attacksUsed} attacks` : "no attacks yet"}
        />
        <StatTile
          label="Stars per attack"
          icon={Gauge}
          value={summary.averageStars === null ? "—" : summary.averageStars.toFixed(2)}
          sub="average"
        />
        <StatTile
          label="Destruction per attack"
          icon={Percent}
          value={summary.averageDestruction === null ? "—" : `${summary.averageDestruction.toFixed(1)}%`}
          sub="average"
        />
        <StatTile
          label="Enemy bases"
          icon={Shield}
          value={`${summary.basesCleared} / ${board.length}`}
          sub={`three-starred · ${summary.basesFree} free`}
          className="col-span-2 sm:col-span-1"
        />
      </div>

      {preparation && (
        <p className="text-muted-foreground text-sm">
          Preparation day — nobody can attack yet. This is the time to give everyone a
          base to hit, so the first hour of battle day is not spent deciding.
        </p>
      )}
    </Panel>
  );

  // The plan, sent to the pickers once (components/war-assign.tsx). Only
  // leadership during a live war gets pickers at all.
  const canPlan = leadership && !ended;
  const plan = {
    action: mutate,
    clanTag: clan.tag,
    warId: war.id,
    members: record.map((m) => ({
      playerId: m.playerId,
      name: m.name,
      mapPosition: m.mapPosition,
      thLevel: m.thLevel,
      attacksUsed: m.attacksUsed,
      attacksAllowed: m.attacksAllowed,
      targets: m.targets.map((t) => t.targetPosition),
      slotsLeft: m.targetSlotsLeft,
    })),
    bases: board.map((b) => ({
      position: b.position,
      name: b.name,
      thLevel: b.thLevel,
      bestStars: b.bestStars,
      assignedTo: b.assignedTo,
    })),
  };

  return (
    <WarPlanProvider plan={plan}>
    <main className="mx-auto max-w-page space-y-6 p-4 sm:p-6">
      {header}

      {/* ── The war itself first: the score, the clock, the numbers ─────────── */}
      {scoreboard}

      {/* ── Then the member's own: attacks left, how they went, the plan ──── */}
      {myRecord.length > 0 && (
        <Tile as="section" accent={accent} className="space-y-4">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold">Your attacks</h2>
            <p className="text-muted-foreground text-sm">
              {leadership
                ? "Your own villages in this war."
                : "Claim a free base so everyone knows it is taken. A leader can still reassign it."}
            </p>
          </div>

          {myRecord.map((m) => (
            <div key={m.playerId} className="cb-sunken space-y-3 rounded-panel p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium">
                  {m.name} <span className="text-muted-foreground text-sm font-normal">· our base {m.mapPosition ?? "?"}</span>
                </p>
                <span className="flex flex-wrap items-center gap-2">
                  {m.attacksRemaining > 0 && !ended && (
                    <Badge variant="warning">
                      {m.attacksRemaining} attack{m.attacksRemaining === 1 ? "" : "s"} left
                    </Badge>
                  )}
                  <Badge variant={m.attacksRemaining === 0 ? "success" : "outline"}>
                    {m.attacksUsed} of {m.attacksAllowed} attacks used
                  </Badge>
                </span>
              </div>

              {/* How it went, as the lineup table's "Attacked" column shows it. */}
              {m.attacks.length > 0 && (
                <ul className="space-y-1 text-sm">
                  {/* Numbered 1, 2 for this member: attackOrder counts across the
                      whole war, so it would read "Attack 57". */}
                  {m.attacks.map((a, i) => (
                    <li key={a.attackOrder} className="flex flex-wrap items-center gap-2 tabular-nums">
                      <span className="text-muted-foreground">Attack {i + 1}</span>
                      <span className="font-medium">Base {a.defenderPosition ?? "?"}</span>
                      <Stars stars={a.stars} />
                      <span className="text-muted-foreground text-xs">{a.destruction.toFixed(0)}%</span>
                    </li>
                  ))}
                </ul>
              )}

              {m.targets.length > 0 && (
                <ul className="space-y-2">
                  {m.targets.map((t) => {
                    const done = !m.openTargets.includes(t);
                    return (
                      <li key={t.targetPosition} className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm">
                          <span className="bg-gold text-gold-ink inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold">
                            <Crosshair aria-hidden className="size-3" />
                            {targetLabel(t.targetPosition)}
                          </span>
                          {done && <span className="text-success-ink ml-2 text-xs font-medium">attacked</span>}
                          {t.note && <span className="text-muted-foreground"> — {t.note}</span>}
                          <span className="text-muted-foreground block text-xs">
                            {t.assignedBy === userId ? "You claimed this base." : "Assigned by your leader."}
                          </span>
                        </p>
                        {/* Only your own claim can be given back. A leader's assignment is
                            theirs to withdraw — 050 refuses, and the button is not offered. */}
                        {!ended && !done && t.assignedBy === userId && (
                          <ActionForm
                            action={mutate}
                            hidden={{ ...hidden, action: "release", playerId: m.playerId, position: String(t.targetPosition) }}
                          >
                            <SubmitButton size="xs" variant="ghost" pendingLabel="Releasing">
                              Give back
                            </SubmitButton>
                          </ActionForm>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}

              {ended ? (
                m.targets.length === 0 && (
                  <p className="text-muted-foreground text-sm">No target was set for this war.</p>
                )
              ) : m.targetSlotsLeft === 0 ? (
                m.attacksRemaining > 0 && (
                  <p className="text-muted-foreground text-sm">Every attack you have left has a base.</p>
                )
              ) : leadership ? (
                <p className="text-muted-foreground text-sm">
                  {m.targetSlotsLeft} attack{m.targetSlotsLeft === 1 ? "" : "s"} without a base — set it in the
                  lineup table below.
                </p>
              ) : freeBases.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  Every base is already assigned or attacked. Ask your leader where to hit.
                </p>
              ) : (
                <div className="space-y-2">
                  <p className="text-sm">
                    Pick a free base to claim
                    {m.targetSlotsLeft > 1 ? ` — you can claim ${m.targetSlotsLeft}` : ""}:
                  </p>
                  {/* One button per free base: a tap on "Base 7 · TH 15" is a clearer
                      choice than a dropdown of bare numbers. */}
                  <div className="flex flex-wrap gap-2">
                    {freeBases.map((b, i) => (
                      <ActionForm
                        key={b.position}
                        action={mutate}
                        // Which of your villages is claiming. Without it 025 picked
                        // one of them arbitrarily — the wrong one, for anyone with two.
                        hidden={{ ...hidden, action: "claim", position: String(b.position), playerId: m.playerId }}
                      >
                        <SubmitButton
                          size="sm"
                          variant={goldFor === m.playerId && i === 0 ? "gold" : "outline"}
                          pendingLabel="Claiming"
                          aria-label={`Claim base ${b.position}${b.name ? `, ${b.name}` : ""}`}
                        >
                          {targetLabel(b.position)}
                        </SubmitButton>
                      </ActionForm>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </Tile>
      )}

      {/* ── T6.3 — who still has attacks. Counts ATTACKS, not people. ─────── */}
      {!preparation && (
        <Disclosure
          title="Still to attack"
          count={outstanding.length}
          defaultOpen={leadership}
          summary={
            <Badge variant={attacksLeft === 0 ? "success" : "warning"}>
              {attacksLeft === 0 ? "All attacks used" : `${attacksLeft} attack${attacksLeft === 1 ? "" : "s"} left`}
            </Badge>
          }
        >

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
        </Disclosure>
      )}

      {/* ── T6.5 — the plan and the outcome, adjacent and never merged ───── */}
      <Disclosure
        title="Our lineup: plan and result"
        count={record.length}
        defaultOpen={leadership && !ended}
      >
        <div className="space-y-4">
          <p className="text-muted-foreground text-sm">
            <span className="text-foreground font-medium">Target</span> is the base a member
            was told to hit, or claimed. <span className="text-foreground font-medium">Attacked</span>{" "}
            is what they actually hit. They sit side by side so a change of plan is visible.
          </p>

          <div className="-mx-5 overflow-x-auto px-5">
            <table className="cb-stack w-full sm:min-w-[40rem] text-sm">
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
                    <td data-cell="corner" className="text-muted-foreground py-3 pr-3 tabular-nums">#{m.mapPosition ?? "?"}</td>
                    <td data-cell="title" className="py-3 pr-3">
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
                    <td data-cell="wide" data-label="Target" className="py-3 pr-3">
                      {m.targets.length === 0 ? (
                        <span className="text-muted-foreground">No target</span>
                      ) : (
                        <ul className="space-y-1.5">
                          {m.targets.map((t) => {
                            const open = m.openTargets.includes(t);
                            return (
                              <li key={t.targetPosition} className="flex flex-wrap items-center gap-1.5">
                                <span
                                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${
                                    open ? "bg-gold text-gold-ink" : "bg-success-tint text-success-ink"
                                  }`}
                                  title={open ? "Planned" : "Attacked"}
                                >
                                  <Crosshair aria-hidden className="size-3" />
                                  {targetLabel(t.targetPosition)}
                                  {!open && " ✓"}
                                </span>
                                {canPlan && open && (
                                  <>
                                    {/* Keyed on the plan, so a save remounts it closed. */}
                                    <AssignMemberButton
                                      key={`move:${m.playerId}:${m.targets.map((x) => x.targetPosition).join(",")}`}
                                      playerId={m.playerId}
                                      replace={t.targetPosition}
                                    />
                                    <ActionForm
                                      action={mutate}
                                      hidden={{
                                        ...hidden,
                                        action: "clear",
                                        playerId: m.playerId,
                                        position: String(t.targetPosition),
                                      }}
                                    >
                                      <SubmitButton
                                        size="xs"
                                        variant="ghost"
                                        pendingLabel="Removing"
                                        aria-label={`Remove base ${t.targetPosition} from ${m.name}`}
                                      >
                                        Remove
                                      </SubmitButton>
                                    </ActionForm>
                                  </>
                                )}
                                {t.note && <span className="text-muted-foreground block w-full text-xs">{t.note}</span>}
                              </li>
                            );
                          })}
                        </ul>
                      )}

                      {canPlan && m.targetSlotsLeft > 0 && (
                        <div className="mt-2">
                          <AssignMemberButton
                            key={`add:${m.playerId}:${m.targets.map((x) => x.targetPosition).join(",")}`}
                            playerId={m.playerId}
                          />
                        </div>
                      )}
                    </td>

                    {/* THE OUTCOME. Deliberately the next column and not the same one:
                        the gap between them is what this page is for. */}
                    <td data-cell="wide" data-label="Attacked" className="py-3 pr-3">
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

                    <td data-cell="row" data-label="Stars" className="py-3 pr-3 text-right font-medium tabular-nums">
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
        </div>
      </Disclosure>

      {/* ── T6.3 — the other side, as a board of bases ───────────────────── */}
      <Panel className="space-y-4" aria-labelledby="bases-title">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SectionHeader
            id="bases-title"
            icon={Crosshair}
            title={`Their bases · ${war.opponentName ?? "the opposition"}`}
            count={board.length}
          />
          <BaseStateLegend />
        </div>
        <p className="text-muted-foreground text-sm">
          {canPlan
            ? "Each base takes one member. Press Assign on a base to choose who hits it; a base someone holds is locked until you move or remove them."
            : "Who is on each base, and what has happened to it so far."}
        </p>

        {opponents.length === 0 && (
          <p className="text-muted-foreground text-sm">
            The opposing lineup was not captured for this war. Base numbers are still right;
            only names and Town Hall levels are missing.
          </p>
        )}

        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {board.map((b) => (
            <BaseCard
              key={b.position}
              base={b}
              action={
                canPlan ? (
                  <AssignBaseButton
                    key={`${b.position}:${b.assignedTo.map((a) => a.playerId).join(",")}`}
                    position={b.position}
                  />
                ) : undefined
              }
            />
          ))}
        </ul>
      </Panel>
    </main>
    </WarPlanProvider>
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
        <ul className="divide-y rounded-control border">
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
                {m.openTargets.length
                  ? m.openTargets.map((t) => targetLabel(t.targetPosition)).join(", ")
                  : "No target"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
