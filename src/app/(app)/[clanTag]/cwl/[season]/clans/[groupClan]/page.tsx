// 057 — one clan of the CWL group, scouted: who it registered, who it fields,
// how far along their villages are against their own Town Hall's max, how
// they attack and defend, and the players worth planning around.
//
// Reached from the Standings table. Everything here was written by the sync
// (R1): the lineups and attacks by sync:cwl, the village readings by
// sync:cwl-scout, our own villages by sync:players.

import Link from "next/link";
import { notFound } from "next/navigation";
import { Crosshair, Info, Shield, Swords, Target, Users } from "lucide-react";
import { ClanBadge } from "@/components/game/clan-badge";
import { TownHall } from "@/components/game/town-hall";
import { EmptyState, Panel, SectionHeader, StatTile } from "@/components/kit";
import { HeroLevels, MaxPct, ThBreakdown } from "@/components/cwl-lineup";
import { LocalTime } from "@/components/local-time";
import { PageHeader } from "@/components/page-header";
import { requireClanByTag } from "@/lib/clans";
import { loadSeasonView } from "@/lib/cwl-season";
import { fieldedScouting, loadScouting } from "@/lib/cwl-scouting-view";
import { seasonLabel } from "@/lib/roster-view";
import { createClient } from "@/lib/supabase/server";
import { decodeTag, InvalidTagError } from "@/lib/tags";
import { cn } from "@/lib/utils";
import { seasonByName } from "@/repositories/cwl";
import {
  HERO_PCT_FLAG,
  LOW_STARS_FLAG,
  TRIPLED_FLAG,
  clanScout,
  nextLineup,
  type LineupSlot,
  type ScoutedPlayer,
  type WeakPointKind,
} from "@/services/cwl-scouting";

export const dynamic = "force-dynamic";

const FLAG_TONE: Record<WeakPointKind, string> = {
  heroes: "var(--warning)",
  missed: "var(--destructive)",
  lowStars: "var(--warning)",
  tripled: "var(--destructive)",
  lowTh: "var(--info)",
};

const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v)}%`);

export default async function CwlGroupClanPage({
  params,
}: {
  params: Promise<{ clanTag: string; season: string; groupClan: string }>;
}) {
  const { clanTag, season: seasonName, groupClan } = await params;
  const supabase = await createClient();

  const clan = await requireClanByTag(supabase, clanTag);
  const season = await seasonByName(supabase, clan.id, decodeURIComponent(seasonName));
  if (!season) notFound();

  let tag: string;
  try {
    tag = decodeTag(groupClan);
  } catch (error) {
    if (error instanceof InvalidTagError) notFound();
    throw error;
  }

  const [view, recorded] = await Promise.all([
    loadSeasonView(supabase, clan, season),
    loadScouting(supabase, season.id, clan.tag),
  ]);
  const standing = view.standings.find((s) => s.tag === tag);
  if (!standing) notFound();

  const scouting = fieldedScouting(recorded, view.groupWars);
  const scout = clanScout(tag, scouting, view.groupWars);
  const next = nextLineup(clan.tag, view.groupWars, scouting.lineups);
  const facing = next && next.enemyTag === tag ? next : null;

  const clanBase = `/${encodeURIComponent(clan.tag)}`;
  const standingsHref = `${clanBase}/cwl/${encodeURIComponent(season.season)}/standings`;
  const isUs = standing.isUs;
  const nothing = scout.roster.total === 0 && scout.players.length === 0;

  return (
    <main className="mx-auto max-w-page space-y-6 p-4 sm:p-6">
      <PageHeader
        back={{ href: standingsHref, label: "Standings" }}
        eyebrow={`${clan.name} · CWL ${seasonLabel(season.season)}`}
        title={standing.name}
        art={<ClanBadge src={standing.badgeUrl} name={standing.name} size="lg" tone={isUs ? "var(--primary)" : "var(--foe)"} />}
        description={
          isUs
            ? "Your own clan, measured the same way as the rest of the group."
            : "Who they field, how far along their villages are, and where they are weak."
        }
      />

      {nothing ? (
        <Panel>
          <EmptyState
            icon={Users}
            title="Nothing scouted for this clan yet"
            body="Rosters and lineups are recorded by the CWL sync, and village levels by the scout that runs after it — both every two hours during the week. Seasons before scouting began cannot be filled in."
          />
        </Panel>
      ) : (
        <>
          <section aria-label="At a glance" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <StatTile
              label="Position"
              value={`#${standing.rank}`}
              sub={`${standing.wins}–${standing.losses}–${standing.ties} · ${standing.stars}★`}
            />
            <StatTile
              label="Registered"
              value={scout.roster.total}
              sub={scout.roster.avgTh === null ? undefined : `avg TH ${scout.roster.avgTh.toFixed(1)}`}
            />
            <StatTile
              label="Avg heroes"
              value={pct(scout.avgHeroPct)}
              sub={`${scout.scouted} of ${scout.players.length} read`}
            >
              <MaxPct pct={scout.avgHeroPct} label="of hero max, averaged" />
            </StatTile>
            <StatTile
              label="Three-star hits"
              value={pct(scout.threeStarRate)}
              sub={scout.attacks ? `${scout.threeStars} of ${scout.attacks} · ${scout.avgStars?.toFixed(1)}★ avg` : "no attacks yet"}
            />
            <StatTile
              label="Missed attacks"
              value={scout.missed}
              tone={scout.missed > 0 ? "var(--destructive)" : undefined}
            />
            <StatTile
              label="Defence"
              value={pct(scout.avgDestructionAgainst)}
              sub={
                scout.defences
                  ? `${scout.avgStarsAgainst?.toFixed(1)}★ per hit · ${scout.tripledAgainst} of ${scout.defences} 3★`
                  : "not attacked yet"
              }
            />
          </section>

          <Panel className="space-y-4">
            <SectionHeader title="Town Halls" icon={Users} />
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <span className="text-muted-foreground w-24 shrink-0 text-sm">Registered</span>
                <ThBreakdown breakdown={scout.roster} />
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <span className="text-muted-foreground w-24 shrink-0 text-sm">Fielded</span>
                {scout.fielded.total > 0 ? (
                  <ThBreakdown breakdown={scout.fielded} />
                ) : (
                  <span className="text-muted-foreground text-xs">No day has started yet</span>
                )}
              </div>
            </div>
          </Panel>

          {facing && (
            <Panel className="space-y-4">
              <SectionHeader
                title={`Day ${facing.day ?? "?"} lineup — ${facing.state === "preparation" ? "preparation" : "battle day"}`}
                icon={Swords}
              />
              <LineupVersus theirs={facing.theirs} ours={facing.ours} players={scout.players} ourName={clan.name} theirName={standing.name} />
            </Panel>
          )}

          {!isUs && (
            <Panel className="space-y-4">
              <SectionHeader title="Weak points" count={scout.weakPoints.length} icon={Target} />
              {scout.weakPoints.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  Nothing stands out yet. Weak points appear as villages are read and days are played.
                </p>
              ) : (
                <ul className="divide-y">
                  {scout.weakPoints.map((p) => (
                    <li key={p.tag} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2.5">
                      <TownHall level={p.thLevel} size="sm" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{p.name}</span>
                        <span className="text-muted-foreground font-mono text-xs">{p.tag}</span>
                      </span>
                      <span className="flex flex-wrap gap-1.5">
                        {p.flags.map((f) => (
                          <span
                            key={f.kind}
                            className="rounded-chip border px-2 py-0.5 text-xs font-medium"
                            style={{ borderColor: FLAG_TONE[f.kind], color: "var(--foreground)" }}
                          >
                            {f.label}
                          </span>
                        ))}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-muted-foreground flex items-start gap-2 text-xs">
                <Info aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                <span>
                  Flagged: heroes under {HERO_PCT_FLAG}% of their Town Hall&apos;s max, any missed
                  attack, {LOW_STARS_FLAG}★ or less on average over two or more attacks, a base
                  3-starred {TRIPLED_FLAG} or more times, and a Town Hall two or more below the top of
                  their lineup.
                </span>
              </p>
            </Panel>
          )}

          <Panel className="space-y-4">
            <SectionHeader title="Players" count={scout.players.length} icon={Crosshair} />
            <PlayersTable players={scout.players} days={scout.players[0]?.byDay.map((d) => d.day) ?? []} />
            <p className="text-muted-foreground flex items-start gap-2 text-xs">
              <Shield aria-hidden className="mt-0.5 size-3.5 shrink-0" />
              <span>
                Strongest base first. Percentages are against each village&apos;s own Town Hall max.
                Defence is the destruction each attack on the base took — the game reports no
                building levels, so how a base holds up in war is the measure there is.{" "}
                {scout.capturedAt ? (
                  <>
                    Villages last read <LocalTime iso={scout.capturedAt} />
                    {isUs ? " by the daily base-progress sync." : "; each is read once a day during the week."}
                  </>
                ) : (
                  "No village has been read yet."
                )}
              </span>
            </p>
          </Panel>

          <p className="text-center text-sm">
            <Link href={standingsHref} className="text-primary font-medium hover:underline">
              Back to the standings
            </Link>
          </p>
        </>
      )}
    </main>
  );
}

function PlayersTable({ players, days }: { players: ScoutedPlayer[]; days: number[] }) {
  return (
    <div className="-mx-5 overflow-x-auto px-5">
      <table className="w-full min-w-[52rem] text-sm">
        <thead className="text-muted-foreground border-b text-left text-xs uppercase">
          <tr>
            <th className="py-2 pr-3 font-medium">#</th>
            <th className="py-2 pr-3 font-medium">Player</th>
            <th className="py-2 pr-3 font-medium">Heroes</th>
            <th className="py-2 pr-3 font-medium">Hero %</th>
            <th className="py-2 pr-3 font-medium">Pets</th>
            <th className="py-2 pr-3 font-medium">Equipment</th>
            {days.map((d) => (
              <th key={d} className="px-1 py-2 text-center font-medium">
                D{d}
              </th>
            ))}
            <th
              className="py-2 text-right font-medium"
              title="How the base held up: average destruction and stars each attack took, and how many were 3-starred"
            >
              Defence
            </th>
          </tr>
        </thead>
        <tbody>
          {players.map((p, i) => (
            <tr key={p.tag} className="border-b align-middle last:border-0">
              <td className="text-muted-foreground py-2 pr-3 tabular-nums">{i + 1}</td>
              <td className="py-2 pr-3">
                <span className="flex min-w-0 items-center gap-2">
                  <TownHall level={p.thLevel} size="sm" />
                  <span className="min-w-0">
                    <span className="block max-w-[12rem] truncate font-medium" title={p.name}>
                      {p.name}
                    </span>
                    <span className="text-muted-foreground font-mono text-xs">{p.tag}</span>
                    {p.thWeaponCap !== null && p.thWeaponLevel !== null && (
                      <span
                        className={cn(
                          "ml-1.5 rounded-chip border px-1 text-[0.625rem] font-semibold tabular-nums",
                          p.thWeaponLevel >= p.thWeaponCap && "border-gold/60 bg-gold/15",
                        )}
                        title={`Town Hall weapon level ${p.thWeaponLevel} of ${p.thWeaponCap}`}
                      >
                        Weapon {p.thWeaponLevel}/{p.thWeaponCap}
                      </span>
                    )}
                  </span>
                </span>
              </td>
              <td className="py-2 pr-3">
                {p.scouted ? (
                  <HeroLevels heroes={p.heroes} compact />
                ) : (
                  <span className="text-muted-foreground text-xs">Not read yet</span>
                )}
              </td>
              <td className="py-2 pr-3">
                <MaxPct pct={p.heroPct} label="of hero max" />
              </td>
              <td className="py-2 pr-3">
                <MaxPct pct={p.petPct} label="of pet max" />
              </td>
              <td className="py-2 pr-3">
                <MaxPct pct={p.equipmentPct} label="of equipment max" />
              </td>
              {p.byDay.map((d) => (
                <td key={d.day} className="px-1 py-2 text-center tabular-nums">
                  {!d.fielded ? (
                    <span className="text-muted-foreground/50">·</span>
                  ) : d.stars === null ? (
                    <span className="text-destructive text-xs font-semibold" title="No attack">
                      —
                    </span>
                  ) : (
                    <span className={cn("font-semibold", d.stars === 3 && "text-gold")}>{d.stars}★</span>
                  )}
                </td>
              ))}
              <td className="py-2 text-right tabular-nums">
                {p.defences && p.avgDestructionAgainst !== null ? (
                  <span className="inline-flex flex-col items-end">
                    <span className="flex items-center gap-2">
                      <DefenceBar pct={p.avgDestructionAgainst} />
                      <span className="text-xs font-semibold">{Math.round(p.avgDestructionAgainst)}%</span>
                    </span>
                    <span
                      className={cn(
                        "text-[0.6875rem]",
                        p.tripled >= TRIPLED_FLAG ? "text-destructive font-semibold" : "text-muted-foreground",
                      )}
                    >
                      {p.avgStarsAgainst?.toFixed(1)}★ · 3★ {p.tripled}/{p.defences}
                    </span>
                  </span>
                ) : (
                  <span className="text-muted-foreground text-xs" title="Not attacked yet in a started day">
                    —
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Destruction a base TOOK per attack. Reversed from the max-% gauges: here a
 * low number is the strong base, so it is green and a 100% is red.
 */
function DefenceBar({ pct }: { pct: number }) {
  const tone = pct >= 90 ? "var(--destructive)" : pct >= 60 ? "var(--warning)" : "var(--success)";
  return (
    <span className="cb-gauge h-1.5 w-12" style={{ "--gauge": tone } as React.CSSProperties} aria-hidden>
      <span style={{ width: `${Math.min(100, pct)}%` }} />
    </span>
  );
}

/** Their bases against ours, position by position, with each enemy's heroes. */
function LineupVersus({
  theirs,
  ours,
  players,
  ourName,
  theirName,
}: {
  theirs: LineupSlot[];
  ours: LineupSlot[];
  players: ScoutedPlayer[];
  ourName: string;
  theirName: string;
}) {
  const byTag = new Map(players.map((p) => [p.tag, p]));
  const rows = Math.max(theirs.length, ours.length);
  if (rows === 0) {
    return <p className="text-muted-foreground text-sm">The lineups are not recorded yet — they appear with the next sync.</p>;
  }
  return (
    <div className="-mx-5 overflow-x-auto px-5">
      <table className="w-full min-w-[36rem] text-sm">
        <thead className="text-muted-foreground border-b text-left text-xs uppercase">
          <tr>
            <th className="py-2 pr-3 font-medium">#</th>
            <th className="py-2 pr-3 font-medium">{theirName}</th>
            <th className="py-2 pr-3 font-medium">Heroes</th>
            <th className="py-2 font-medium">{ourName}</th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }, (_, i) => {
            const them = theirs[i];
            const us = ours[i];
            const enemy = them ? byTag.get(them.tag) : undefined;
            const gap = them?.thLevel && us?.thLevel ? us.thLevel - them.thLevel : 0;
            return (
              <tr key={i} className="border-b last:border-0">
                <td className="text-muted-foreground py-2 pr-3 tabular-nums">{them?.position ?? us?.position ?? i + 1}</td>
                <td className="py-2 pr-3">
                  {them ? (
                    <span className="flex items-center gap-2">
                      <TownHall level={them.thLevel} size="sm" />
                      <span className="max-w-[10rem] truncate">{them.name}</span>
                    </span>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="py-2 pr-3">
                  {enemy?.scouted ? <HeroLevels heroes={enemy.heroes} compact /> : <span className="text-muted-foreground text-xs">—</span>}
                </td>
                <td className="py-2">
                  {us ? (
                    <span className="flex items-center gap-2">
                      <TownHall level={us.thLevel} size="sm" />
                      <span className="max-w-[10rem] truncate">{us.name}</span>
                      {gap !== 0 && (
                        <span
                          className={cn("text-xs font-semibold tabular-nums", gap > 0 ? "text-success-ink" : "text-destructive")}
                          title={gap > 0 ? "Our base is the higher Town Hall" : "Their base is the higher Town Hall"}
                        >
                          {gap > 0 ? `+${gap}` : gap} TH
                        </span>
                      )}
                    </span>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
