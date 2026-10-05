// T4.5 — CWL day detail.
//
// Roster, every attack, and a clear list of who has NOT attacked. That last list
// is the reason this page exists: it is the one a leader acts on, and it is the
// thing the WhatsApp-and-logbook workflow could never produce reliably. It comes
// BEFORE the full roster on the page for the same reason.
//
// The missed list is DERIVED, never stored (002_cwl.sql:76-78) — roster minus
// attacks, computed in services/cwl.ts. A stored miss is indistinguishable from
// a genuine zero-star attack, and CWL rows cannot be repaired later because the
// source data is deleted when the season ends.
//
// REDESIGNED (the CWL dashboard pass):
//
//   - One header for every page of the season (components/cwl-season-header):
//     league, group position, record and the week's coloured strip, then the
//     tabs Days · Standings · Medals · Report.
//   - Day tabs in colour: green won, red lost, yellow ongoing, blue preparation,
//     grey not started — the tab row is the week's results at a glance. The
//     word is still under each day; colour is never the only signal.
//   - The day being fought gets a live panel: Stars 23 vs 19, when it ends, and
//     a countdown that ticks.
//   - Top performers of the season so far.
//
// ATTACK AND DEFENCE, BASE BY BASE (services/cwl-day.ts):
//
//   - Every one of our bases with the attack its owner made AND the attacks the
//     enemy made on it. The page used to show our attacks only.
//   - Base numbers are the war map's, 1 to N. The API's mapPosition is not that
//     in CWL, which is how a 15-base war listed an attack on "#19".
//   - Attacks used are counted for BOTH clans, on the live panel and after.
//
// R1 — PostgreSQL only. R3 — the season is resolved under an explicit clan
// filter, so every war and attack below it is known to belong here.

import Link from "next/link";
import { notFound } from "next/navigation";
import { Swords, Trophy, UserX } from "lucide-react";
import { SyncBadge } from "@/components/sync-badge";
import { LocalTime } from "@/components/local-time";
import { TownHall } from "@/components/lineup-parts";
import { Stars } from "@/components/stars";
import { Disclosure, EmptyState, FactRow, Panel, SectionHeader } from "@/components/kit";
import { LiveDayPanel } from "@/components/cwl-parts";
import { CwlSeasonHeader } from "@/components/cwl-season-header";
import { WarScoreboard } from "@/components/war-scoreboard";
import { clanAccent } from "@/lib/clan-accent";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { requireClanByTag } from "@/lib/clans";
import { canPrintCwlReport, loadSeasonView } from "@/lib/cwl-season";
import { isLeader } from "@/lib/visibility";
import { DAY_TONE_CLASS, DAY_TONE_LABEL, dayTone } from "@/lib/war-status";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/server";
import { seasonByName } from "@/repositories/cwl";
import { lineupForWar } from "@/repositories/cwl-scouting";
import { latestRun } from "@/repositories/sync-log";
import { dayBoard, type BaseRef } from "@/services/cwl-day";

export const dynamic = "force-dynamic";

/** One attack's result: stars, a destruction gauge and the percentage. */
function HitResult({ stars, destruction, tone }: { stars: number; destruction: number; tone: string }) {
  return (
    <span className="flex items-center gap-2">
      <Stars stars={stars} />
      <span className="cb-gauge h-1.5 w-14" style={{ "--gauge": tone } as React.CSSProperties}>
        <span style={{ width: `${Math.min(100, destruction)}%` }} />
      </span>
      <span className="text-xs tabular-nums">{destruction.toFixed(0)}%</span>
    </span>
  );
}

/** An enemy base as the war map names it: "on #6 · TH18 · name". */
function EnemyBase({ lead, base }: { lead: string; base: BaseRef }) {
  return (
    <span className="text-muted-foreground flex items-center gap-1.5 text-xs">
      {lead}
      <span className="text-foreground font-semibold tabular-nums">#{base.base ?? "?"}</span>
      {base.thLevel !== null && <TownHall level={base.thLevel} />}
      {base.name && <span className="max-w-[10rem] truncate">{base.name}</span>}
    </span>
  );
}

export default async function CwlDayDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ clanTag: string; season: string }>;
  searchParams: Promise<{ day?: string; war?: string }>;
}) {
  const { clanTag, season: seasonName } = await params;
  const { day, war: warParam } = await searchParams;
  const supabase = await createClient();

  const clan = await requireClanByTag(supabase, clanTag);
  const season = await seasonByName(supabase, clan.id, decodeURIComponent(seasonName));
  if (!season) notFound();

  const [view, run, canPrint] = await Promise.all([
    loadSeasonView(supabase, clan, season, { withPlayers: true }),
    latestRun(supabase, "cwl", clan.id),
    canPrintCwlReport(supabase, clan.role),
  ]);
  const { wars } = view;

  // Default to the latest day that has STARTED. During CWL the last day with
  // data is usually tomorrow's preparation day — a roster with no attacks
  // possible yet — and opening on it showed the whole lineup under "Did not
  // attack". The day being fought is the one a leader is chasing.
  const started = [...wars].reverse().find((w) => w.state !== "preparation");
  const selected =
    wars.find((w) => w.dayNumber !== null && String(w.dayNumber) === day) ??
    wars.find((w) => w.id === warParam) ??
    started ??
    wars[wars.length - 1] ??
    null;
  const selectedIndex = selected ? wars.indexOf(selected) : -1;

  // The loader already read every day's roster and attacks; the selected day's
  // are among them.
  const roster = selectedIndex >= 0 ? (view.warData[selectedIndex]?.apiRoster ?? []) : [];
  const attacks = selectedIndex >= 0 ? (view.warData[selectedIndex]?.attacks ?? []) : [];
  // Both lineups of this one war (057): the enemy's bases, and their attacks on
  // ours. Read after the day is chosen — which war it is is not known before.
  const lineup = selected ? await lineupForWar(supabase, season.id, selected.warTag) : [];
  const board = dayBoard({
    roster,
    attacks,
    lineup,
    ourTag: clan.tag,
    teamSize: selected?.teamSize ?? null,
    groupWar: selected ? view.groupWars.find((w) => w.warTag === selected.warTag) : null,
  });
  // "Missed" means the day is OVER and no attack came. On a battle day still
  // running it only means "not yet", and on a preparation day nobody can have
  // attacked at all — counting either as a miss is how 15 of 15 got listed
  // as having failed a war that had not started.
  const dayState = selected?.state ?? null;
  const dayOver = dayState !== "preparation" && dayState !== "inWar";
  const missed = board.bases.filter((b) => !b.attack);
  const selectedTone = selected ? dayTone(selected.result, selected.state) : "pending";
  const opponentName = selected?.opponentName ?? selected?.opponentTag ?? "the opponent";

  const clanBase = `/${encodeURIComponent(clan.tag)}`;
  const base = `${clanBase}/cwl/${encodeURIComponent(season.season)}`;
  const top = view.starsSoFar.filter((c) => c.attacksUsed > 0).slice(0, 5);

  return (
    <main className="mx-auto max-w-page space-y-6 p-4 sm:p-6">
      <CwlSeasonHeader
        clanName={clan.name}
        clanBase={clanBase}
        view={view}
        active="days"
        canPrint={canPrint}
        description="Each war day's result, and who did not use their attack."
        actions={<SyncBadge run={run} clanTag={clan.tag} target="cwl" canAdmin={isLeader(clan.role)} />}
      />

      {wars.length === 0 ? (
        <Panel>
          <EmptyState
            icon={Trophy}
            title="No war days recorded for this season"
            body="The season exists but no wars were captured. If CWL has already run, the sync was not working that week."
          />
        </Panel>
      ) : (
        <>
          {/* The week as tabs, each in its result's colour. */}
          <nav aria-label="War days" className="grid grid-cols-4 gap-2 sm:grid-cols-7">
            {wars.map((war) => {
              const active = selected?.id === war.id;
              const tone = dayTone(war.result, war.state);
              const scored = tone !== "prep" && tone !== "pending";
              return (
                <Link
                  key={war.id}
                  // A war stored without a day number is linked by id instead, or
                  // every such tab would fall back to the default day.
                  href={war.dayNumber !== null ? `${base}?day=${war.dayNumber}` : `${base}?war=${war.id}`}
                  aria-current={active ? "page" : undefined}
                  aria-label={`Day ${war.dayNumber ?? "?"}: ${DAY_TONE_LABEL[tone]}`}
                  className={cn(
                    "flex flex-col items-center gap-0.5 rounded-control border-2 px-2 py-2 text-center transition-transform hover:-translate-y-0.5",
                    DAY_TONE_CLASS[tone].soft,
                    active && "ring-foreground/80 ring-offset-background ring-2 ring-offset-2",
                  )}
                >
                  <span className="flex items-center gap-1 text-sm font-bold">
                    {tone === "live" && (
                      <span aria-hidden className={cn("size-2 animate-pulse rounded-full", DAY_TONE_CLASS[tone].dot)} />
                    )}
                    Day {war.dayNumber ?? "?"}
                  </span>
                  <span className="text-xs font-semibold">{DAY_TONE_LABEL[tone]}</span>
                  {scored && (
                    <span className="text-[0.6875rem] tabular-nums opacity-90">
                      {war.ourStars ?? 0}★ – {war.theirStars ?? 0}★
                    </span>
                  )}
                  {/* Which day of the month this was. A preserved season opened
                      a year later has no other way to place it. */}
                  {war.startTime && (
                    <span className="text-[0.6875rem] opacity-75">
                      <LocalTime iso={war.startTime} style="date" />
                    </span>
                  )}
                </Link>
              );
            })}
          </nav>

          {selected && selected.state === "inWar" && (
            <LiveDayPanel war={selected} clanName={clan.name} ours={board.ours} theirs={board.theirs} />
          )}

          {selected && selected.state !== "inWar" && (
            <section className="cb-panel space-y-4 rounded-panel border p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-lg font-semibold">
                  Day {selected.dayNumber ?? "?"}{" "}
                  <span className="text-muted-foreground font-normal">vs</span>{" "}
                  {selected.opponentName ?? selected.opponentTag ?? "unknown opponent"}
                </h2>
                <span
                  className={cn(
                    "rounded-full border px-3 py-0.5 text-sm font-semibold",
                    DAY_TONE_CLASS[selectedTone].soft,
                  )}
                >
                  {DAY_TONE_LABEL[selectedTone]}
                </span>
              </div>
              {(selected.startTime || selected.endTime) && (
                <p className="text-muted-foreground text-sm">
                  {selected.state === "preparation" ? (
                    <>
                      Battle day starts <LocalTime iso={selected.startTime} style="weekday" />
                    </>
                  ) : (
                    <>
                      Ran <LocalTime iso={selected.startTime} style="datetime" /> to{" "}
                      <LocalTime iso={selected.endTime} style="datetime" />
                    </>
                  )}
                </p>
              )}
              <WarScoreboard
                size="compact"
                us={{
                  name: clan.name,
                  stars: selected.ourStars,
                  destruction: selected.ourDestruction,
                  badgeUrl: clan.badgeUrl,
                }}
                them={{
                  name: selected.opponentName ?? selected.opponentTag,
                  stars: selected.theirStars,
                  destruction: selected.theirDestruction,
                  badgeUrl: selected.opponentBadgeUrl,
                }}
                accent={clanAccent(clan.id).color}
              />
              {selected.state !== "preparation" && (
                <FactRow
                  items={[
                    {
                      label: `attacks used by ${clan.name}`,
                      value: `${board.ours.used ?? "—"} of ${board.ours.of ?? "?"}`,
                      icon: Swords,
                    },
                    {
                      label: `attacks used by ${opponentName}`,
                      value: board.theirs.used === null ? "—" : `${board.theirs.used} of ${board.theirs.of ?? "?"}`,
                      icon: Swords,
                      title: board.theirs.used === null ? "Not recorded for this day" : undefined,
                    },
                  ]}
                />
              )}
            </section>
          )}

          <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <section className="cb-panel space-y-4 rounded-panel border p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="flex items-center gap-2 text-lg font-semibold">
                  <UserX aria-hidden className="text-muted-foreground size-4.5" />
                  {dayOver ? "Did not attack" : "Yet to attack"}
                </h2>
                {roster.length > 0 && dayState !== "preparation" && (
                  <Badge variant={missed.length === 0 ? "success" : dayOver ? "warning" : "info"}>
                    {missed.length === 0
                      ? "Everyone attacked"
                      : dayOver
                        ? `${missed.length} of ${roster.length} missed`
                        : `${missed.length} of ${roster.length} still to attack`}
                  </Badge>
                )}
              </div>
              {roster.length === 0 ? (
                <p className="text-muted-foreground text-sm">No roster was captured for this day.</p>
              ) : dayState === "preparation" ? (
                <p className="text-muted-foreground text-sm">
                  Battle day has not started. Attacks open when it does.
                </p>
              ) : missed.length === 0 ? (
                <p className="text-muted-foreground text-sm">Everyone in the lineup used their attack.</p>
              ) : (
                <ul className="divide-y rounded-control border">
                  {missed.map((m) => (
                    <li key={m.playerId} className="flex items-center gap-3 px-3 py-2">
                      <span className="text-muted-foreground w-8 text-xs tabular-nums">#{m.base ?? "?"}</span>
                      <Link
                        className="min-w-0 flex-1 truncate text-sm font-medium underline-offset-2 hover:underline"
                        href={`${clanBase}/player/${encodeURIComponent(m.tag)}`}
                      >
                        {m.name}
                      </Link>
                      <TownHall level={m.thLevel} />
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="cb-panel space-y-3 rounded-panel border p-5" aria-labelledby="top-title">
              <SectionHeader id="top-title" icon={Trophy} title="Top performers" />
              {top.length === 0 ? (
                <p className="text-muted-foreground text-sm">Nobody has attacked yet this season.</p>
              ) : (
                <ol className="space-y-2">
                  {top.map((c, index) => (
                    <li key={c.playerId} className="flex items-center gap-3">
                      <span
                        className={cn(
                          "cb-title inline-flex size-7 shrink-0 items-center justify-center rounded-full text-sm",
                          index === 0 ? "bg-gold text-gold-ink" : "bg-muted",
                        )}
                      >
                        {index + 1}
                      </span>
                      <Link
                        href={`${clanBase}/player/${encodeURIComponent(c.tag)}`}
                        className="min-w-0 flex-1 truncate text-sm font-medium hover:underline"
                      >
                        {c.name}
                      </Link>
                      <span className="text-sm tabular-nums">
                        <span className="font-semibold">{c.stars}</span>
                        <span className="text-trim"> ★</span>
                        <span className="text-muted-foreground text-xs">
                          {" "}
                          · {c.attacksUsed}/{c.warsPlayed} · {c.averageDestruction.toFixed(0)}%
                        </span>
                      </span>
                    </li>
                  ))}
                </ol>
              )}
              <Link href={`${base}/medals`} className="text-primary block text-sm font-medium hover:underline">
                What this week pays in medals →
              </Link>
            </section>
          </div>

          {roster.length > 0 && (
            <Disclosure
              title="Attack and defence, base by base"
              icon={Swords}
              count={roster.length}
              defaultOpen={dayState !== "preparation"}
            >
              <div className="space-y-4">
                {dayState !== "preparation" && (
                  <FactRow
                    items={[
                      { label: "of our attacks used", value: `${board.ours.used ?? "—"} of ${board.ours.of ?? "?"}` },
                      ...(board.enemyKnown
                        ? [
                            {
                              label: "of their attacks used",
                              value: `${board.theirs.used ?? "—"} of ${board.theirs.of ?? "?"}`,
                            },
                            { label: "of our bases attacked", value: `${board.basesHit} of ${roster.length}` },
                            { label: "of our bases 3-starred", value: `${board.basesTripled} of ${roster.length}` },
                          ]
                        : []),
                    ]}
                  />
                )}
                <div className="-mx-5 overflow-x-auto px-5">
                  <Table className="min-w-[44rem]">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-14">Base</TableHead>
                        <TableHead>Member</TableHead>
                        <TableHead>Attack — their base we hit</TableHead>
                        <TableHead>Defence — enemy attacks on this base</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {board.bases.map((b) => (
                        <TableRow key={b.playerId}>
                          <TableCell className="cb-title align-top text-base tabular-nums">#{b.base ?? "?"}</TableCell>
                          <TableCell className="align-top">
                            <span className="flex items-center gap-2">
                              <TownHall level={b.thLevel} />
                              <Link
                                className="font-medium underline-offset-2 hover:underline"
                                href={`${clanBase}/player/${encodeURIComponent(b.tag)}`}
                              >
                                {b.name}
                              </Link>
                            </span>
                          </TableCell>
                          <TableCell className="align-top">
                            {b.attack ? (
                              <div className="space-y-1">
                                <HitResult
                                  stars={b.attack.stars}
                                  destruction={b.attack.destruction}
                                  tone={b.attack.stars === 3 ? "var(--success)" : "var(--warning)"}
                                />
                                {board.enemyKnown && b.attack.target && <EnemyBase lead="on" base={b.attack.target} />}
                              </div>
                            ) : dayState === "preparation" ? (
                              <span className="text-muted-foreground">—</span>
                            ) : dayOver ? (
                              <Badge variant="warning">Did not attack</Badge>
                            ) : (
                              <Badge variant="outline">Not yet</Badge>
                            )}
                          </TableCell>
                          <TableCell className="align-top">
                            {dayState === "preparation" || !board.enemyKnown ? (
                              <span className="text-muted-foreground">—</span>
                            ) : b.defences.length === 0 ? (
                              <Badge variant={dayOver ? "success" : "outline"}>
                                {dayOver ? "Not attacked" : "Not attacked yet"}
                              </Badge>
                            ) : (
                              <div className="space-y-2">
                                {b.defences.map((d) => (
                                  <div key={d.by.tag} className="space-y-1">
                                    <HitResult stars={d.stars} destruction={d.destruction} tone="var(--foe)" />
                                    <EnemyBase lead="by" base={d.by} />
                                  </div>
                                ))}
                              </div>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <p className="text-muted-foreground text-xs">
                  {board.enemyKnown
                    ? `Base numbers are the ones on the war map, 1 to ${roster.length}. A base attacked more than once lists its best hit first — that is the one that scores.`
                    : "The enemy lineup was not recorded for this day, so their base numbers and their attacks on our bases cannot be shown."}
                </p>
              </div>
            </Disclosure>
          )}
        </>
      )}
    </main>
  );
}
