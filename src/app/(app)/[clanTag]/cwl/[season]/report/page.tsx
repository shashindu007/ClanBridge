// T4B.11, T4B.12, T4B.13 — plan versus reality, contribution, and bonus medals.
//
// R12 IN PRACTICE. cwl_roster_members is who the leader CHOSE; cwl_war_members
// is who the API says PLAYED. Both are kept, and this page is the difference:
//
//   selected and played
//   selected but never appeared      <- the conversation to have
//   appeared but was never selected  <- the one nobody expects
//
// The third group is why this is a three-way split rather than a checklist. A
// co-leader adds someone in game who was not on the roster, and without this
// they are invisible in every report while consuming a slot somebody else was
// promised.
//
// REDESIGNED: the season as a month name; "Picked versus played" as three
// explained cards with the two lists that matter side by side; contribution
// columns that say "War days", "Attacks 6 of 7" and "Avg destruction"; and bonus
// medals as an awarded list beside one card per candidate with labelled "Place"
// and "Reason" fields, instead of two unlabelled inputs squeezed onto each row.
//
// T4B.13 — the bonus order is the LEADER'S, not a formula's. The rule for this
// deployment is their final decision order, so the system lays out the evidence
// and then records what was decided. A ranking that can be recomputed answers
// "why did they get one and I did not" by re-running a sort, which is exactly
// the answer that starts the argument.

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { CheckCircle2, CircleAlert, Medal, UserPlus, UserX } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { SubmitButton } from "@/components/submit-button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { requireClanByTag } from "@/lib/clans";
import { seasonLabel } from "@/lib/roster-view";
import { createClient } from "@/lib/supabase/server";
import { attacksForWar, rosterForWar, seasonByName, warsInSeason } from "@/repositories/cwl";
import {
  awardBonus,
  bonusesForSeason,
  membersOfRoster,
  rosterFor,
  withdrawBonus,
} from "@/repositories/rosters";
import {
  allocationList,
  contributionReport,
  nextAwardOrder,
  planVsReality,
  type SeasonWarData,
} from "@/services/rosters";

export const dynamic = "force-dynamic";

function isLeadership(role: string): boolean {
  return role === "leader" || role === "co-leader";
}

async function bonusAction(formData: FormData) {
  "use server";

  const supabase = await createClient();
  const clanTag = String(formData.get("clanTag") ?? "");
  const season = String(formData.get("season") ?? "");
  const clan = await requireClanByTag(supabase, clanTag);
  const here = `/${encodeURIComponent(clan.tag)}/cwl/${encodeURIComponent(season)}/report`;

  const seasonId = String(formData.get("seasonId") ?? "");
  const playerId = String(formData.get("playerId") ?? "");
  const action = String(formData.get("action") ?? "");

  let result: { error?: string };
  // The toast used to say "Bonus recorded." after taking a medal BACK.
  let done = "";
  if (action === "withdraw") {
    result = await withdrawBonus(supabase, seasonId, playerId);
    done = "bonus-withdrawn";
  } else {
    done = "bonus-awarded";
    const orderRaw = String(formData.get("awardOrder") ?? "").trim();
    const order = orderRaw ? Number(orderRaw) : null;
    if (order !== null && (!Number.isInteger(order) || order < 1)) {
      redirect(`${here}?error=bad-order`);
    }
    const note = String(formData.get("note") ?? "").trim() || null;
    result = await awardBonus(supabase, seasonId, playerId, order, note);
  }

  if (result.error) redirect(`${here}?error=${encodeURIComponent(result.error)}`);

  revalidatePath(here);
  redirect(`${here}?ok=${done}`);
}

export default async function CwlSeasonReportPage({
  params,
}: {
  params: Promise<{ clanTag: string; season: string }>;
}) {
  const { clanTag, season: rawSeason } = await params;
  const season = decodeURIComponent(rawSeason);
  const supabase = await createClient();

  const clan = await requireClanByTag(supabase, clanTag);
  const seasonRow = await seasonByName(supabase, clan.id, season);
  if (!seasonRow) notFound();

  // ── TWO WAVES, NOT SIX ────────────────────────────────────────────────────
  //
  // These five reads were issued one after another, and only two of the
  // dependencies were real: warData needs the war list, and membersOfRoster
  // needs the roster's id. Everything else was queued behind work it had no use
  // for — the season's wars, the leader's roster and the bonus awards are three
  // independent reads off ids already in hand.
  //
  // The fan-out inside warData was sequential too: `await` then `await` for two
  // reads of the same war that do not depend on each other, so a seven-war
  // season paid two full waves of latency where it needed one.
  const [wars, roster, bonuses] = await Promise.all([
    warsInSeason(supabase, seasonRow.id),
    rosterFor(supabase, clan.id, season),
    bonusesForSeason(supabase, seasonRow.id),
  ]);

  const [warData, selected] = await Promise.all([
    Promise.all(
      wars.map(async (war): Promise<SeasonWarData> => {
        const [apiRoster, attacks] = await Promise.all([
          rosterForWar(supabase, war.id),
          attacksForWar(supabase, war.id),
        ]);
        return { apiRoster, attacks };
      }),
    ),
    roster ? membersOfRoster(supabase, roster.id) : [],
  ]);

  const comparison = planVsReality(selected, warData);
  const contributions = contributionReport(warData, bonuses);
  const { awarded, candidates } = allocationList(contributions);
  const leadership = isLeadership(clan.role);

  const absent = comparison.filter((r) => r.outcome === "absent");
  const unplanned = comparison.filter((r) => r.outcome === "unplanned");
  const played = comparison.filter((r) => r.outcome === "played");

  const clanBase = `/${encodeURIComponent(clan.tag)}`;
  const base = `${clanBase}/cwl/${encodeURIComponent(season)}`;
  const nextOrder = nextAwardOrder(awarded);

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-4 sm:p-8">
      <PageHeader
        back={{ href: base, label: "Day by day" }}
        eyebrow={clan.name}
        title={`CWL report · ${seasonLabel(season)}`}
        description={`Who you picked compared with who played, what each player contributed over ${wars.length} war day${wars.length === 1 ? "" : "s"}, and the bonus medals.`}
      />

      {!roster && (
        <Alert variant="warning">
          <CircleAlert aria-hidden />
          <AlertTitle>No lineup was picked for this season</AlertTitle>
          <AlertDescription className="space-y-3">
            <p>
              There is nothing to compare with, so everyone who played shows as &ldquo;not
              picked&rdquo;. Pick next season&apos;s lineup in the roster builder and this
              report shows who followed the plan.
            </p>
            {leadership && (
              <Button asChild size="sm" variant="outline">
                <Link href="/roster">Open CWL lineups</Link>
              </Button>
            )}
          </AlertDescription>
        </Alert>
      )}

      {/* ── T4B.11 — plan versus reality ───────────────────────────────────── */}
      <section className="cb-panel space-y-5 rounded-lg border p-6">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">Picked versus played</h2>
          <p className="text-muted-foreground text-sm">
            Your lineup compared with the players the game actually put in the wars.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <OutcomeCard
            icon={<CheckCircle2 aria-hidden className="text-success size-5" />}
            count={played.length}
            label="Picked and played"
            hint="The plan worked for these."
          />
          <OutcomeCard
            icon={<UserX aria-hidden className="text-destructive size-5" />}
            count={absent.length}
            label="Picked but did not play"
            hint="Worth a conversation."
          />
          <OutcomeCard
            icon={<UserPlus aria-hidden className="text-warning-ink size-5" />}
            count={unplanned.length}
            label="Played without being picked"
            hint="Each took a spot someone else was promised."
          />
        </div>

        {(absent.length > 0 || unplanned.length > 0) && (
          <div className="grid gap-6 md:grid-cols-2">
            <NameList
              title="Picked but did not play"
              empty="Everyone picked played."
              rows={absent.map((r) => ({ id: r.playerId, name: r.name, tag: r.tag, detail: null }))}
              clanBase={clanBase}
            />
            <NameList
              title="Played without being picked"
              empty="Nobody played who was not picked."
              rows={unplanned.map((r) => ({
                id: r.playerId,
                name: r.name,
                tag: r.tag,
                detail: `${r.warsPlayed} war day${r.warsPlayed === 1 ? "" : "s"}`,
              }))}
              clanBase={clanBase}
            />
          </div>
        )}

        {absent.length === 0 && unplanned.length === 0 && wars.length > 0 && roster && (
          <p className="text-sm">
            <CheckCircle2 aria-hidden className="text-success mr-1 inline size-4" />
            The plan held exactly: everyone picked played, and nobody else did.
          </p>
        )}
      </section>

      {/* ── T4B.12 — contribution ──────────────────────────────────────────── */}
      <section className="cb-panel space-y-4 rounded-lg border p-6">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">What each player contributed</h2>
          <p className="text-muted-foreground text-sm">
            <span className="text-foreground font-medium">Missed</span> counts war days a
            player was in and did not attack — not days they were left out of.
          </p>
        </div>
        {contributions.length === 0 ? (
          <p className="text-muted-foreground text-sm">No war data was captured for this season.</p>
        ) : (
          <div className="-mx-6 overflow-x-auto px-6">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Player</TableHead>
                  <TableHead className="text-right">War days</TableHead>
                  <TableHead className="text-right">Attacks</TableHead>
                  <TableHead className="text-right">Missed</TableHead>
                  <TableHead className="text-right">Stars</TableHead>
                  <TableHead className="text-right">Avg destruction</TableHead>
                  <TableHead className="text-right">Medal</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {contributions.map((c) => (
                  <TableRow key={c.playerId}>
                    <TableCell className="font-medium">
                      <Link
                        className="underline-offset-2 hover:underline"
                        href={`${clanBase}/player/${encodeURIComponent(c.tag)}`}
                      >
                        {c.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{c.warsPlayed}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {c.attacksUsed} of {c.warsPlayed}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {c.missed > 0 ? <span className="text-destructive font-medium">{c.missed}</span> : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{c.stars}</TableCell>
                    <TableCell className="text-right tabular-nums">{c.averageDestruction.toFixed(1)}%</TableCell>
                    <TableCell className="text-right">
                      {c.hasBonus ? (
                        <Badge variant="success">
                          <Medal aria-hidden />#{c.bonusOrder ?? "?"}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      {/* ── T4B.13 — the leader's bonus order ──────────────────────────────── */}
      {leadership && contributions.length > 0 && (
        <section className="cb-panel space-y-5 rounded-lg border p-6">
          <div className="space-y-1">
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <Medal aria-hidden className="size-5" />
              Bonus medals
            </h2>
            <p className="text-muted-foreground text-sm">
              You decide who gets a medal and in what order; the table above is the evidence.
              Add a reason so the decision can be explained later.
            </p>
          </div>

          <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
            <div className="space-y-2">
              <h3 className="text-sm font-medium">
                Awarded <span className="text-muted-foreground tabular-nums">({awarded.length})</span>
              </h3>
              {awarded.length === 0 ? (
                <p className="text-muted-foreground rounded-md border border-dashed p-4 text-sm">
                  No medals awarded yet. Award the first from the list of players.
                </p>
              ) : (
                <ol className="divide-y rounded-md border">
                  {awarded.map((a) => (
                    <li key={a.playerId} className="flex items-center gap-3 px-3 py-2">
                      <Badge variant="success">#{a.bonusOrder ?? "?"}</Badge>
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">{a.name}</span>
                      <form action={bonusAction}>
                        <input type="hidden" name="clanTag" value={clanTag} />
                        <input type="hidden" name="season" value={season} />
                        <input type="hidden" name="seasonId" value={seasonRow.id} />
                        <input type="hidden" name="playerId" value={a.playerId} />
                        <input type="hidden" name="action" value="withdraw" />
                        <SubmitButton
                          size="xs"
                          variant="ghost"
                          pendingLabel="Removing"
                          aria-label={`Take back ${a.name}'s medal`}
                        >
                          Take back
                        </SubmitButton>
                      </form>
                    </li>
                  ))}
                </ol>
              )}
            </div>

            <div className="space-y-2">
              <h3 className="text-sm font-medium">Award a medal</h3>
              {candidates.length === 0 ? (
                <p className="text-muted-foreground text-sm">Every player already has a medal.</p>
              ) : (
                <ul className="space-y-2">
                  {candidates.slice(0, 10).map((c) => (
                    <li key={c.playerId} className="bg-card space-y-2 rounded-md border p-3">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <span className="text-sm font-medium">{c.name}</span>
                        <span className="text-muted-foreground text-xs tabular-nums">
                          {c.stars} stars · {c.attacksUsed} of {c.warsPlayed} attacks
                          {c.missed > 0 ? ` · ${c.missed} missed` : ""}
                        </span>
                      </div>
                      <form action={bonusAction} className="flex flex-wrap items-end gap-2">
                        <input type="hidden" name="clanTag" value={clanTag} />
                        <input type="hidden" name="season" value={season} />
                        <input type="hidden" name="seasonId" value={seasonRow.id} />
                        <input type="hidden" name="playerId" value={c.playerId} />
                        <input type="hidden" name="action" value="award" />
                        <label className="space-y-1">
                          <span className="text-muted-foreground block text-xs">Place</span>
                          <Input name="awardOrder" type="number" min={1} defaultValue={nextOrder} className="h-9 w-20" />
                        </label>
                        <label className="min-w-40 flex-1 space-y-1">
                          <span className="text-muted-foreground block text-xs">Reason (optional)</span>
                          <Input name="note" placeholder="e.g. Most stars, no misses" maxLength={200} className="h-9" />
                        </label>
                        <SubmitButton size="sm" pendingLabel="Awarding">
                          Award medal
                        </SubmitButton>
                      </form>
                    </li>
                  ))}
                </ul>
              )}
              {candidates.length > 10 && (
                <p className="text-muted-foreground text-xs">
                  Showing the top 10 of {candidates.length} players without a medal.
                </p>
              )}
            </div>
          </div>
        </section>
      )}
    </main>
  );
}

function OutcomeCard({
  icon,
  count,
  label,
  hint,
}: {
  icon: React.ReactNode;
  count: number;
  label: string;
  hint: string;
}) {
  return (
    <div className="bg-card space-y-1 rounded-md border p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-3xl font-semibold tabular-nums">{count}</span>
        {icon}
      </div>
      <p className="text-sm font-medium">{label}</p>
      <p className="text-muted-foreground text-xs">{hint}</p>
    </div>
  );
}

function NameList({
  title,
  empty,
  rows,
  clanBase,
}: {
  title: string;
  empty: string;
  rows: Array<{ id: string; name: string; tag: string; detail: string | null }>;
  clanBase: string;
}) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium">
        {title} <span className="text-muted-foreground tabular-nums">({rows.length})</span>
      </h3>
      {rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">{empty}</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <Link className="min-w-0 truncate underline-offset-2 hover:underline" href={`${clanBase}/player/${encodeURIComponent(r.tag)}`}>
                {r.name}
              </Link>
              <span className="text-muted-foreground shrink-0 text-xs tabular-nums">{r.detail ?? r.tag}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
