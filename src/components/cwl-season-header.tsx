// The header every page of one CWL season shares — Days, Standings, Medals and
// Report — so moving between them feels like changing tabs, not pages: the same
// title, league art, running ribbon, record strip and tab row, in the same place.

import { Trophy } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Ribbon } from "@/components/game/ribbon";
import { LocalTime } from "@/components/local-time";
import { DayStrip, LeagueArt, SeasonNav, type SeasonTab } from "@/components/cwl-parts";
import type { SeasonView } from "@/lib/cwl-season";
import { seasonLabel } from "@/lib/roster-view";
import { ordinal } from "@/lib/war-status";

export function CwlSeasonHeader({
  clanName,
  clanBase,
  view,
  active,
  canPrint,
  description,
  actions,
}: {
  clanName: string;
  clanBase: string;
  view: SeasonView;
  active: SeasonTab;
  canPrint: boolean;
  description: string;
  actions?: React.ReactNode;
}) {
  const base = `${clanBase}/cwl/${encodeURIComponent(view.season.season)}`;
  const { totals, span, us, standings, league, running } = view;

  return (
    <div className="space-y-4">
      <PageHeader
        back={{ href: `${clanBase}/cwl`, label: "All CWL seasons" }}
        eyebrow={clanName}
        title={`CWL · ${seasonLabel(view.season.season)}`}
        art={<LeagueArt league={league} size={56} />}
        ribbons={
          running ? (
            <Ribbon tone="cwl" icon={Trophy}>
              Running now
            </Ribbon>
          ) : undefined
        }
        description={description}
        actions={actions}
      />

      {/* The season in one line: league, position, record, and the week. */}
      <div className="cb-panel flex flex-wrap items-center gap-x-6 gap-y-3 rounded-panel border px-5 py-3">
        <span className="text-sm">
          <span className="text-muted-foreground">League </span>
          <span className="font-semibold">{league ?? "not recorded"}</span>
        </span>
        {us && (
          <span className="text-sm">
            <span className="text-muted-foreground">Position </span>
            <span className="font-semibold">
              {ordinal(us.rank)} of {standings.length}
              {running ? " so far" : ""}
            </span>
          </span>
        )}
        <span className="text-sm">
          <span className="text-muted-foreground">W–L–D </span>
          <span className="font-semibold tabular-nums">
            {totals.wins}–{totals.losses}–{totals.ties}
          </span>
        </span>
        <span className="text-sm">
          <span className="text-muted-foreground">Stars </span>
          <span className="font-semibold tabular-nums">
            {totals.stars} – {totals.starsAgainst}
          </span>
        </span>
        {span && (
          <span className="text-muted-foreground text-sm">
            {running ? "Since " : "Ran from "}
            <LocalTime iso={span.from} style="date" />
            {span.to && !running && (
              <>
                {" to "}
                <LocalTime iso={span.to} style="date" />
              </>
            )}
          </span>
        )}
        <span className="ml-auto">
          <DayStrip wars={view.wars} size="sm" hrefFor={(w) => `${base}?day=${w.dayNumber ?? ""}`} />
        </span>
      </div>

      <SeasonNav base={base} active={active} canPrint={canPrint} />
    </div>
  );
}
