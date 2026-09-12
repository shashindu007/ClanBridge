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
// T4B.13 — the bonus order is the LEADER'S, not a formula's. The rule for this
// deployment is their final decision order, so the system lays out the evidence
// and then records what was decided. A ranking that can be recomputed answers
// "why did they get one and I did not" by re-running a sort, which is exactly
// the answer that starts the argument.

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
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
  if (action === "withdraw") {
    result = await withdrawBonus(supabase, seasonId, playerId);
  } else {
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
  redirect(here);
}

export default async function CwlSeasonReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ clanTag: string; season: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { clanTag, season: rawSeason } = await params;
  const { error } = await searchParams;
  const season = decodeURIComponent(rawSeason);
  const supabase = await createClient();

  const clan = await requireClanByTag(supabase, clanTag);
  const seasonRow = await seasonByName(supabase, clan.id, season);
  if (!seasonRow) notFound();

  const wars = await warsInSeason(supabase, seasonRow.id);
  const warData: SeasonWarData[] = await Promise.all(
    wars.map(async (war) => ({
      apiRoster: await rosterForWar(supabase, war.id),
      attacks: await attacksForWar(supabase, war.id),
    })),
  );

  const roster = await rosterFor(supabase, clan.id, season);
  const selected = roster ? await membersOfRoster(supabase, roster.id) : [];
  const bonuses = await bonusesForSeason(supabase, seasonRow.id);

  const comparison = planVsReality(selected, warData);
  const contributions = contributionReport(warData, bonuses);
  const { awarded, candidates } = allocationList(contributions);
  const leadership = isLeadership(clan.role);

  const absent = comparison.filter((r) => r.outcome === "absent");
  const unplanned = comparison.filter((r) => r.outcome === "unplanned");
  const played = comparison.filter((r) => r.outcome === "played");

  const base = `/${encodeURIComponent(clan.tag)}/cwl/${encodeURIComponent(season)}`;

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">CWL {season} report</h1>
        <p className="text-muted-foreground text-sm">
          {clan.name} · {wars.length} war day{wars.length === 1 ? "" : "s"} ·{" "}
          <Link className="underline" href={base}>
            Day detail
          </Link>
        </p>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertTitle>That did not work</AlertTitle>
          <AlertDescription>
            {error === "bad-order" ? "The order must be a whole number, 1 or more." : error}
          </AlertDescription>
        </Alert>
      )}

      {!roster && (
        <Alert>
          <AlertTitle>No roster was recorded for this season</AlertTitle>
          <AlertDescription>
            Without the leader&apos;s selection there is nothing to compare against, so
            everyone below shows as unplanned. Build a roster before CWL next month and
            this becomes the report that ends arguments.
          </AlertDescription>
        </Alert>
      )}

      {/* ── T4B.11 — plan versus reality ───────────────────────────────────── */}
      <section className="space-y-4 rounded-lg border p-6">
        <h2 className="font-medium">Plan versus reality</h2>
        <div className="grid grid-cols-3 gap-3 text-center">
          <div className="rounded-md border p-3">
            <div className="text-2xl font-semibold tabular-nums">{played.length}</div>
            <div className="text-muted-foreground text-xs">selected, played</div>
          </div>
          <div className="rounded-md border p-3">
            <div className="text-destructive text-2xl font-semibold tabular-nums">
              {absent.length}
            </div>
            <div className="text-muted-foreground text-xs">selected, absent</div>
          </div>
          <div className="rounded-md border p-3">
            <div className="text-2xl font-semibold tabular-nums">{unplanned.length}</div>
            <div className="text-muted-foreground text-xs">played, not selected</div>
          </div>
        </div>

        {absent.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-medium">Selected but never appeared</h3>
            <ul className="divide-y">
              {absent.map((r) => (
                <li key={r.playerId} className="flex items-center gap-3 py-2 text-sm">
                  <span className="flex-1">{r.name}</span>
                  <span className="text-muted-foreground font-mono text-xs">{r.tag}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {unplanned.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-medium">Played but was never selected</h3>
            <p className="text-muted-foreground text-xs">
              Added in game without being on the roster — each one took a slot somebody
              else was promised.
            </p>
            <ul className="divide-y">
              {unplanned.map((r) => (
                <li key={r.playerId} className="flex items-center gap-3 py-2 text-sm">
                  <span className="flex-1">{r.name}</span>
                  <span className="text-muted-foreground tabular-nums">
                    {r.warsPlayed} war{r.warsPlayed === 1 ? "" : "s"}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {absent.length === 0 && unplanned.length === 0 && wars.length > 0 && (
          <p className="text-muted-foreground text-sm">
            Everyone selected played, and nobody played who was not selected. The plan
            held exactly.
          </p>
        )}
      </section>

      {/* ── T4B.12 — contribution ──────────────────────────────────────────── */}
      <section className="space-y-4 rounded-lg border p-6">
        <h2 className="font-medium">Contribution</h2>
        {contributions.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No war data captured for this season.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Player</TableHead>
                  <TableHead className="text-right">Wars</TableHead>
                  <TableHead className="text-right">Attacks</TableHead>
                  <TableHead className="text-right">Missed</TableHead>
                  <TableHead className="text-right">Stars</TableHead>
                  <TableHead className="text-right">Avg %</TableHead>
                  <TableHead className="text-right">Bonus</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {contributions.map((c) => (
                  <TableRow key={c.playerId}>
                    <TableCell className="font-medium">
                      <Link
                        className="underline-offset-2 hover:underline"
                        href={`/${encodeURIComponent(clan.tag)}/player/${encodeURIComponent(c.tag)}`}
                      >
                        {c.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{c.warsPlayed}</TableCell>
                    <TableCell className="text-right tabular-nums">{c.attacksUsed}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {c.missed > 0 ? (
                        <span className="text-destructive">{c.missed}</span>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{c.stars}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {c.averageDestruction.toFixed(1)}
                    </TableCell>
                    <TableCell className="text-right">
                      {c.hasBonus ? <Badge>#{c.bonusOrder ?? "?"}</Badge> : "—"}
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
        <section className="space-y-4 rounded-lg border p-6">
          <div className="space-y-1">
            <h2 className="font-medium">Bonus medals</h2>
            <p className="text-muted-foreground text-sm">
              Your order, recorded with a note. The table above is the evidence; the
              decision is yours, and it is what gets kept.
            </p>
          </div>

          {awarded.length > 0 && (
            <ul className="divide-y">
              {awarded.map((a) => (
                <li key={a.playerId} className="flex flex-wrap items-center gap-3 py-3">
                  <Badge>#{a.bonusOrder ?? "?"}</Badge>
                  <span className="min-w-0 flex-1 text-sm font-medium">{a.name}</span>
                  <form action={bonusAction}>
                    <input type="hidden" name="clanTag" value={clanTag} />
                    <input type="hidden" name="season" value={season} />
                    <input type="hidden" name="seasonId" value={seasonRow.id} />
                    <input type="hidden" name="playerId" value={a.playerId} />
                    <input type="hidden" name="action" value="withdraw" />
                    <SubmitButton size="xs" variant="ghost">
                      Withdraw
                    </SubmitButton>
                  </form>
                </li>
              ))}
            </ul>
          )}

          <div className="space-y-3">
            <h3 className="text-muted-foreground text-sm font-medium">
              Award the next medal
            </h3>
            {candidates.length === 0 ? (
              <p className="text-muted-foreground text-sm">Everyone already has one.</p>
            ) : (
              <ul className="divide-y">
                {candidates.slice(0, 10).map((c) => (
                  <li key={c.playerId} className="flex flex-wrap items-center gap-2 py-2">
                    <span className="min-w-0 flex-1 text-sm">
                      {c.name}
                      <span className="text-muted-foreground">
                        {" "}
                        — {c.stars} stars, {c.missed} missed
                      </span>
                    </span>
                    <form action={bonusAction} className="flex items-center gap-2">
                      <input type="hidden" name="clanTag" value={clanTag} />
                      <input type="hidden" name="season" value={season} />
                      <input type="hidden" name="seasonId" value={seasonRow.id} />
                      <input type="hidden" name="playerId" value={c.playerId} />
                      <input type="hidden" name="action" value="award" />
                      <Input
                        name="awardOrder"
                        type="number"
                        min={1}
                        defaultValue={nextAwardOrder(awarded)}
                        className="w-16"
                        aria-label={`Order for ${c.name}`}
                      />
                      <Input
                        name="note"
                        placeholder="Why"
                        maxLength={200}
                        className="w-40"
                        aria-label={`Note for ${c.name}`}
                      />
                      <SubmitButton size="xs">
                        Award
                      </SubmitButton>
                    </form>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      )}
    </main>
  );
}
