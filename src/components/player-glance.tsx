// A player at a glance: their rank, then the game's facts about them.
//
// Sits directly under the header on both profile pages, so the page answers "who
// is this and how are they doing" before the season tables start.
//
// THIS IS THE SUMMARY EVERY CLAN MEMBER SEES. Heroes and % of max are already on
// every CWL lineup. The troop-by-troop list stays behind Base details.

import { Crown } from "lucide-react";
import { HeroLevels, MaxPct } from "@/components/cwl-lineup";
import { FactRow, Panel, type Fact } from "@/components/kit";
import { RankSummary } from "@/components/player-rank";
import type { PlayerGlanceData } from "@/lib/player-rank-data";
import type { PlayerProfileRow } from "@/repositories/profiles";
import type { Standing } from "@/services/player-rank";

const count = (value: number) => value.toLocaleString("en-GB");

export function PlayerGlance({
  standing,
  tag,
  showClan,
  glance,
  profile,
  thLevel,
}: {
  standing: Standing;
  tag: string;
  showClan: boolean;
  glance: PlayerGlanceData;
  profile: PlayerProfileRow | null;
  thLevel: number | null;
}) {
  const { progress, trophies } = glance;
  const hall = progress?.thLevel ?? thLevel;

  const facts: Fact[] = [
    ...(hall !== null
      ? [
          {
            label: progress?.thWeaponLevel ? `Town Hall, weapon ${progress.thWeaponLevel}` : "Town Hall",
            value: hall,
          },
        ]
      : []),
    ...(trophies !== null
      ? [{ label: "trophies", value: count(trophies) }]
      : profile?.bestTrophies !== null && profile?.bestTrophies !== undefined
        ? [{ label: "best trophies", value: count(profile.bestTrophies) }]
        : []),
    ...(profile?.warStars !== null && profile?.warStars !== undefined
      ? [{ label: "war stars", value: count(profile.warStars) }]
      : []),
  ];

  return (
    <Panel aria-label="Player summary" className="space-y-4">
      <RankSummary standing={standing} tag={tag} showClan={showClan} />

      <div className="space-y-3 border-t pt-4">
        {facts.length > 0 && <FactRow items={facts} />}

        {progress ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm">
              <Crown aria-hidden className="text-muted-foreground size-4" />
              <span className="font-medium">Heroes</span>
            </div>
            <HeroLevels heroes={progress.heroes} />
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
              <span className="flex items-center gap-2 text-xs">
                <span className="text-muted-foreground">Base maxed</span>
                <MaxPct pct={progress.maxPct} />
              </span>
              <span className="flex items-center gap-2 text-xs">
                <span className="text-muted-foreground">Heroes maxed</span>
                <MaxPct pct={progress.heroPct} label="of hero max" />
              </span>
            </div>
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">
            Hero levels appear after the next daily read of this village.
          </p>
        )}
      </div>
    </Panel>
  );
}
