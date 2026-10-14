// The month's CWL results as one picture, for the family's Facebook page: each
// clan's group table and its three best players by CWL rating. Drawn by
// rating/cwl/share, which exports it with DownloadImageButton.
//
// THE SIZE IS FIXED. The sheet is 540×675 CSS px, exported at pixel ratio 2 —
// 1080×1350, the portrait shape the Facebook feed shows largest on a phone.
// Every size inside it is in px, not rem: phones and laptops have different
// root font sizes (globals.css), and the image must come out the same from
// either. For the same reason there is no `.cb-stack` table in it.

import { ClanBadge } from "@/components/game/clan-badge";
import { LeagueArt } from "@/components/cwl-parts";
import { clanAccent } from "@/lib/clan-accent";
import type { LatestCwlEntry } from "@/lib/cwl-latest";
import { formatDisplay } from "@/lib/display-time";
import { seasonLabel } from "@/lib/roster-view";
import { cn } from "@/lib/utils";
import { ordinal } from "@/lib/war-status";
import { oneDecimal } from "@/services/cwl-rating";

/** Gold, silver, bronze, as on CWL rating. */
const MEDAL = ["#f5c542", "#c0c7d1", "#cd8a4b"];

/**
 * One group-table row, in px. Eight of them and the clan's header must fit a
 * third of the sheet, or the bottom row — sometimes our own — is cut off.
 */
const ROW = 16;

export function CwlResultsSheet({
  id,
  month,
  entries,
}: {
  id: string;
  month: string;
  entries: LatestCwlEntry[];
}) {
  const running = entries.some((e) => e.view.running);
  const day = Math.max(
    0,
    ...entries.map((e) => e.view.wars.filter((w) => w.state === "inWar" || w.state === "warEnded").length),
  );

  return (
    <article
      id={id}
      className="cb-sheet flex flex-col overflow-hidden rounded-panel border shadow-lg"
      style={{ width: 540, height: 675, padding: 16, gap: 10, fontSize: 12, lineHeight: "16px" }}
    >
      <header
        className="flex items-end justify-between"
        style={{ borderBottom: "3px solid var(--ribbon-cwl)", paddingBottom: 8, gap: 12 }}
      >
        <div className="min-w-0">
          <p
            className="text-muted-foreground font-semibold uppercase"
            style={{ fontSize: 10, letterSpacing: "0.12em" }}
          >
            Clan War League results
          </p>
          <h1 className="cb-title" style={{ fontSize: 28, lineHeight: "32px", textShadow: "none" }}>
            CWL · {seasonLabel(month)}
          </h1>
        </div>
        <span
          className={cn(
            "shrink-0 rotate-[-6deg] border-2 font-black uppercase",
            running ? "border-warning text-warning-ink" : "border-success text-success-ink",
          )}
          style={{ fontSize: 12, padding: "2px 10px", borderRadius: 6, letterSpacing: "0.08em" }}
        >
          {running ? `Live · day ${day} of 7` : "Final"}
        </span>
      </header>

      <div className="flex min-h-0 flex-1 flex-col justify-center" style={{ gap: 8 }}>
        {entries.map((entry) => (
          <ClanBlock key={entry.clan.id} entry={entry} />
        ))}
      </div>

      <footer
        className="text-muted-foreground flex justify-between border-t"
        style={{ fontSize: 9, lineHeight: "12px", paddingTop: 6, gap: 12 }}
      >
        <span>★ includes +10 for each war won · Rating: share of the clan&apos;s marks, day by day.</span>
        <span className="shrink-0">ClanBridge · {formatDisplay(new Date().toISOString(), "date")}</span>
      </footer>
    </article>
  );
}

/** One clan: its place in the group, the group table, and its top three. */
function ClanBlock({ entry }: { entry: LatestCwlEntry }) {
  const { clan, view, rating } = entry;
  const accent = clanAccent(clan.id).color;
  const { standings, us, league } = view;
  const stats = new Map(view.contributions.map((c) => [c.playerId, c]));
  const top = rating.players.filter((p) => rating.started || p.provisional).slice(0, 3);

  return (
    <section
      className="flex shrink-0 flex-col overflow-hidden border"
      style={{ borderRadius: 8, borderTop: `3px solid ${accent}` }}
    >
      <div className="bg-muted flex items-center border-b" style={{ gap: 8, padding: "4px 8px" }}>
        <ClanBadge src={clan.badgeUrl} name={clan.name} size="sm" tone={accent} sameOrigin />
        <p className="cb-title min-w-0 flex-1 truncate" style={{ fontSize: 16, lineHeight: "20px", textShadow: "none" }}>
          {clan.name}
        </p>
        {league && (
          <span className="text-muted-foreground flex shrink-0 items-center" style={{ gap: 4, fontSize: 10 }}>
            <LeagueArt league={league} size={18} />
            {league}
          </span>
        )}
        {us && (
          <span className="shrink-0 font-bold tabular-nums" style={{ fontSize: 13 }}>
            {ordinal(us.rank)} <span className="text-muted-foreground font-normal">of {standings.length}</span>
          </span>
        )}
      </div>

      <div className="flex">
        {/* The group, as the game ranks it. */}
        <div className="min-w-0 border-r" style={{ width: 300, padding: "2px 0" }}>
          {standings.length === 0 ? (
            <p className="text-muted-foreground" style={{ padding: 8, fontSize: 11 }}>
              The group was not recorded.
            </p>
          ) : (
            <table className="w-full table-fixed" style={{ fontSize: 11, lineHeight: "14px" }}>
              <colgroup>
                <col style={{ width: 20 }} />
                <col style={{ width: 20 }} />
                <col />
                <col style={{ width: 42 }} />
                <col style={{ width: 46 }} />
              </colgroup>
              <tbody>
                {standings.map((s) => (
                  <tr
                    key={s.tag}
                    className={cn("align-middle", s.isUs && "font-bold")}
                    style={{
                      height: ROW,
                      background: s.isUs ? `color-mix(in oklch, ${accent} 18%, transparent)` : undefined,
                    }}
                  >
                    <td className="text-right tabular-nums" style={{ padding: "0 2px" }}>
                      {s.rank}
                    </td>
                    <td style={{ padding: "0 2px", lineHeight: 0 }}>
                      <ClanBadge src={s.badgeUrl} name={s.name} size="xs" tone="var(--foe)" sameOrigin />
                    </td>
                    <td className="truncate" style={{ padding: "0 2px" }}>
                      {s.name}
                    </td>
                    <td className="text-right tabular-nums" style={{ padding: "0 2px" }}>
                      ★{s.stars}
                    </td>
                    <td className="text-muted-foreground text-right tabular-nums" style={{ padding: "0 6px 0 2px" }}>
                      {Math.round(s.destruction)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Its three best by CWL rating. */}
        <div className="flex min-w-0 flex-1 flex-col" style={{ padding: "4px 8px", gap: 4 }}>
          <p
            className="text-muted-foreground font-semibold uppercase"
            style={{ fontSize: 9, lineHeight: "12px", letterSpacing: "0.1em" }}
          >
            Top players
          </p>
          {top.length === 0 ? (
            <p className="text-muted-foreground" style={{ fontSize: 11 }}>
              No attacks rated yet.
            </p>
          ) : (
            top.map((player, index) => {
              const c = stats.get(player.playerId);
              return (
                <div key={player.playerId} className="flex items-center" style={{ gap: 6 }}>
                  <span
                    className="inline-flex shrink-0 items-center justify-center rounded-full font-bold text-black"
                    style={{ width: 18, height: 18, fontSize: 10, background: MEDAL[index] }}
                  >
                    {index + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold" style={{ fontSize: 12, lineHeight: "15px" }}>
                      {player.name}
                    </p>
                    <p className="text-muted-foreground tabular-nums" style={{ fontSize: 10, lineHeight: "12px" }}>
                      {player.thLevel ? `TH${player.thLevel}` : "TH ?"}
                      {c ? ` · ${c.stars}★ · ${c.attacksUsed}/${c.warsPlayed}` : ""}
                    </p>
                  </div>
                  <span className="shrink-0 font-bold tabular-nums" style={{ fontSize: 13 }}>
                    {rating.started ? oneDecimal(player.rating) : "—"}
                  </span>
                </div>
              );
            })
          )}
        </div>
      </div>
    </section>
  );
}
