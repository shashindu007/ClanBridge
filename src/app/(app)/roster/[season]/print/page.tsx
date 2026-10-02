// The final CWL lineups, as paper: one sheet per clan the leader runs, to save
// as a PDF (all clans) or as an image (one clan, for its WhatsApp group) — and,
// above them, every clan's list side by side on one image, the way the leader
// writes the month's lineups down in the notebook.
//
// CWL starts at the beginning of the month, so next month's lineups are due by
// the 2nd (lib/roster-view.ts lineupDeadline) — this is what gets sent out once
// they are.
//
// Leadership only: a draft is still the leader thinking out loud (011), and
// this sheet shows drafts, stamped as such. Anyone else is sent to the
// published lineups instead.

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { ClanBadge } from "@/components/game/clan-badge";
import { TownHall } from "@/components/game/town-hall";
import { HeroLevels, ThBreakdown, shortSeason } from "@/components/cwl-lineup";
import { DownloadImageButton } from "@/components/download-image-button";
import { PrintButton } from "@/components/print-button";
import { currentUserId } from "@/lib/auth";
import { visibleClans, type VisibleClan } from "@/lib/clans";
import { playerDetails, type PlayerDetail } from "@/lib/cwl-lineup-data";
import { formatDisplay } from "@/lib/display-time";
import { byWarOrder, lineupBreakdown, lineupDeadline, seasonLabel } from "@/lib/roster-view";
import { isLeadership } from "@/lib/visibility";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/server";
import { membersOfRoster, rostersForSeason, type Roster, type RosterMember } from "@/repositories/rosters";

export const dynamic = "force-dynamic";

export default async function LineupExportPage({
  params,
}: {
  params: Promise<{ season: string }>;
}) {
  const { season: rawSeason } = await params;
  const season = decodeURIComponent(rawSeason);
  if (!/^\d{4}-\d{2}$/.test(season)) notFound();

  const supabase = await createClient();
  const userId = await currentUserId(supabase);
  if (!userId) redirect("/login");

  const clans = await visibleClans(supabase, userId);
  const leads = clans.filter((c) => isLeadership(c.role));
  if (leads.length === 0) redirect(`/roster/${encodeURIComponent(season)}`);

  const rosters = (await rostersForSeason(supabase, season))
    .filter((r) => leads.some((c) => c.id === r.clanId))
    .map((r) => ({ roster: r, clan: leads.find((c) => c.id === r.clanId)! }))
    .sort((a, b) => a.clan.name.localeCompare(b.clan.name));
  if (rosters.length === 0) {
    return (
      <main className="mx-auto max-w-narrow space-y-4 p-4 sm:p-6">
        <Link
          href={`/roster/${encodeURIComponent(season)}`}
          className="text-muted-foreground inline-flex items-center gap-1 text-sm hover:underline"
        >
          <ArrowLeft aria-hidden className="size-4" />
          Back to the lineups
        </Link>
        <p className="cb-panel rounded-panel border p-6 text-sm">
          None of the clans you lead has a lineup for {seasonLabel(season)} yet, so there is
          nothing to export. Start one from the lineups page.
        </p>
      </main>
    );
  }

  const members = await Promise.all(rosters.map(({ roster }) => membersOfRoster(supabase, roster.id)));
  // As on the builder: the "last CWL" is the one before this season, not a
  // season still being played.
  const details = await playerDetails(supabase, members.flat().map((m) => m.playerId), { before: season });
  const title = seasonLabel(season);
  const deadline = lineupDeadline(season);
  // War order, as on the builder: the strongest base is #1.
  const lists = members.map((list) =>
    list
      .map((m) => {
        const d = details.get(m.playerId);
        return { ...m, thLevel: d?.thLevel ?? m.thLevel, maxPct: d?.maxPct ?? null, heroPct: d?.heroPct ?? null, offencePct: d?.offencePct ?? null };
      })
      .sort(byWarOrder),
  );

  return (
    <main className="mx-auto max-w-page space-y-4 p-4 sm:p-6 print:max-w-none print:p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link
          href={`/roster/${encodeURIComponent(season)}`}
          className="text-muted-foreground inline-flex items-center gap-1 text-sm hover:underline"
        >
          <ArrowLeft aria-hidden className="size-4" />
          Back to the lineups
        </Link>
        <PrintButton label="Download all as PDF" />
      </div>
      <p className="text-muted-foreground text-xs print:hidden">
        Every lineup side by side first, then one page per clan. “Download PNG” saves a sheet
        as an image, ready to share.
      </p>

      <AllLineupsSheet
        season={season}
        title={title}
        columns={rosters.map(({ roster, clan }, i) => ({ roster, clan, list: lists[i] ?? [] }))}
        details={details}
      />

      {rosters.map(({ roster, clan }, i) => {
        const list = lists[i] ?? [];
        const id = `lineup-${clan.tag.replace("#", "")}`;
        const published = roster.status === "published";
        return (
          <section
            key={roster.id}
            className={cn("mx-auto max-w-[210mm] space-y-2 print:max-w-none", i > 0 && "print-page-break")}
          >
            <div className="flex justify-end print:hidden">
              <DownloadImageButton
                targetId={id}
                fileName={`${clan.name} CWL lineup ${season}`}
              />
            </div>
            <article
              id={id}
              className="cb-sheet space-y-4 rounded-panel border p-6 shadow-lg print:rounded-none print:border-0 print:p-0 print:shadow-none"
            >
              <header
                className="flex items-center gap-4 border-b-4 pb-3"
                style={{ borderColor: "var(--ribbon-cwl)" }}
              >
                <ClanBadge src={clan.badgeUrl} name={clan.name} size="lg" tone="var(--primary)" sameOrigin />
                <div className="min-w-0 flex-1">
                  <p className="text-muted-foreground text-xs font-semibold tracking-widest uppercase">
                    Clan War League lineup
                  </p>
                  <h1 className="cb-title text-3xl leading-tight">{clan.name}</h1>
                  <p className="text-muted-foreground text-sm">
                    {title} · {list.length} of {roster.slotCount} players
                    {deadline ? ` · due ${formatDisplay(deadline.toISOString(), "date")}` : ""}
                  </p>
                </div>
                <span
                  className={cn(
                    "rotate-[-6deg] rounded-control border-2 px-3 py-1 text-sm font-black tracking-wider uppercase",
                    published ? "border-success text-success-ink" : "border-warning text-warning-ink",
                  )}
                >
                  {published ? "Final" : "Draft"}
                </span>
              </header>

              {list.length > 0 && <ThBreakdown breakdown={lineupBreakdown(list)} />}

              {list.length === 0 ? (
                <p className="text-muted-foreground text-sm">Nobody picked yet.</p>
              ) : (
                <table className="w-full border text-sm">
                  <thead className="bg-muted text-left text-xs uppercase">
                    <tr>
                      <th className="px-2 py-1.5">#</th>
                      <th className="px-2 py-1.5">Player</th>
                      <th className="px-2 py-1.5">TH</th>
                      <th className="px-2 py-1.5">Heroes</th>
                      <th className="px-2 py-1.5 text-right">Max</th>
                      <th className="px-2 py-1.5 text-right">Offence</th>
                      <th className="px-2 py-1.5 text-right">Last CWL</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((m, index) => {
                      const d = details.get(m.playerId);
                      const last = d?.history[0];
                      return (
                        <tr key={m.playerId} className="border-t align-middle">
                          <td className="px-2 py-1.5 font-bold tabular-nums">{index + 1}</td>
                          <td className="px-2 py-1.5">
                            <span className="block font-semibold">{m.name}</span>
                            <span className="text-muted-foreground font-mono text-[0.6875rem]">{m.tag}</span>
                          </td>
                          <td className="px-2 py-1.5">
                            <TownHall level={m.thLevel} />
                          </td>
                          <td className="px-2 py-1.5">
                            <HeroLevels heroes={d?.heroes ?? []} compact />
                          </td>
                          <td className="px-2 py-1.5 text-right tabular-nums">
                            {d?.maxPct !== null && d?.maxPct !== undefined ? `${Math.round(d.maxPct)}%` : "—"}
                          </td>
                          <td className="px-2 py-1.5 text-right tabular-nums">
                            {m.offencePct !== null ? `${Math.round(m.offencePct)}%` : "—"}
                          </td>
                          <td className="px-2 py-1.5 text-right text-xs tabular-nums">
                            {last ? (
                              <>
                                <span className="font-semibold">{last.stars}★</span>{" "}
                                {last.attacksUsed}/{last.warsRostered}
                              </>
                            ) : (
                              "—"
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}

              <footer className="text-muted-foreground flex justify-between border-t pt-2 text-[0.6875rem]">
                <span>Everyone on this list is expected to use all seven attacks.</span>
                <span>ClanBridge · {formatDisplay(new Date().toISOString(), "date")}</span>
              </footer>
            </article>
          </section>
        );
      })}
    </main>
  );
}

/**
 * Every clan's lineup side by side on one sheet — the notebook page: a column
 * per clan, numbered in war order, with each base's Town Hall, % of max and
 * last CWL. Too wide for an A4 page, so it is for the PNG and the screen; the
 * PDF stays one page per clan.
 */
function AllLineupsSheet({
  season,
  title,
  columns,
  details,
}: {
  season: string;
  title: string;
  columns: { roster: Roster; clan: VisibleClan; list: (RosterMember & { maxPct: number | null })[] }[];
  details: Map<string, PlayerDetail>;
}) {
  const total = columns.reduce((t, c) => t + c.list.length, 0);
  const slots = columns.reduce((t, c) => t + c.roster.slotCount, 0);
  return (
    <section className="space-y-2 print:hidden">
      <div className="flex justify-end">
        <DownloadImageButton targetId="lineup-all" fileName={`CWL lineups ${season}`} label="Download all lineups PNG" />
      </div>
      <div className="overflow-x-auto">
        <article id="lineup-all" className="cb-sheet min-w-fit space-y-4 rounded-panel border p-6 shadow-lg">
          <header className="border-b-4 pb-3" style={{ borderColor: "var(--ribbon-cwl)" }}>
            <p className="text-muted-foreground text-xs font-semibold tracking-widest uppercase">
              Clan War League lineups
            </p>
            <h1 className="cb-title text-3xl leading-tight">CWL · {title}</h1>
            <p className="text-muted-foreground text-sm">
              {columns.length} clan{columns.length === 1 ? "" : "s"} · {total} of {slots} players · war order,
              strongest base at #1
            </p>
          </header>

          <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(21rem, 1fr))` }}>
            {columns.map(({ roster, clan, list }) => (
              <div key={roster.id} className="flex min-w-0 flex-col overflow-hidden rounded-panel border">
                <div className="bg-muted flex items-center gap-2 border-b px-3 py-2">
                  <ClanBadge src={clan.badgeUrl} name={clan.name} size="sm" tone="var(--primary)" sameOrigin />
                  <div className="min-w-0 flex-1">
                    <p className="cb-title truncate text-lg leading-tight">{clan.name}</p>
                    <p className="text-muted-foreground text-xs tabular-nums">
                      {list.length} of {roster.slotCount} · {roster.status === "published" ? "Final" : "Draft"}
                    </p>
                  </div>
                </div>
                {list.length > 0 && (
                  <div className="border-b px-3 py-2">
                    <ThBreakdown breakdown={lineupBreakdown(list)} />
                  </div>
                )}
                {list.length === 0 ? (
                  <p className="text-muted-foreground p-3 text-sm">Nobody picked yet.</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="text-muted-foreground text-left text-[0.6875rem] uppercase">
                      <tr>
                        <th className="py-1.5 pr-1 pl-3 font-medium">#</th>
                        <th className="px-1 py-1.5 font-medium">Base</th>
                        <th className="px-1 py-1.5 font-medium">TH</th>
                        <th className="px-1 py-1.5 text-right font-medium">Max</th>
                        <th className="py-1.5 pr-3 pl-1 text-right font-medium">Last CWL</th>
                      </tr>
                    </thead>
                    <tbody>
                      {list.map((m, index) => {
                        const last = details.get(m.playerId)?.history[0];
                        const missed = last ? last.warsRostered - last.attacksUsed : 0;
                        return (
                          <tr key={m.playerId} className="border-t align-middle">
                            <td className="py-1 pr-1 pl-3 font-bold tabular-nums">{index + 1}</td>
                            <td className="max-w-36 truncate px-1 py-1 font-semibold" title={m.name}>
                              {m.name}
                            </td>
                            <td className="px-1 py-1">
                              <TownHall level={m.thLevel} />
                            </td>
                            <td className="px-1 py-1 text-right tabular-nums">
                              {m.maxPct !== null ? `${Math.round(m.maxPct)}%` : "—"}
                            </td>
                            <td className="py-1 pr-3 pl-1 text-right text-xs leading-tight tabular-nums">
                              {last ? (
                                <>
                                  <span className="font-semibold">{last.stars}★</span>{" "}
                                  <span className={missed > 0 ? "text-destructive font-semibold" : ""}>
                                    {last.attacksUsed}/{last.warsRostered}
                                  </span>
                                  <span
                                    className="text-muted-foreground ml-auto block max-w-28 truncate text-[0.625rem]"
                                    title={`${shortSeason(last.season)} in ${last.clanName}`}
                                  >
                                    {shortSeason(last.season)} · {last.clanName}
                                  </span>
                                </>
                              ) : (
                                <span className="text-muted-foreground">No CWL yet</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            ))}
          </div>

          <footer className="text-muted-foreground flex justify-between gap-4 border-t pt-2 text-[0.6875rem]">
            <span>Last CWL: stars, then attacks used of wars played, with the season and clan.</span>
            <span>ClanBridge · {formatDisplay(new Date().toISOString(), "date")}</span>
          </footer>
        </article>
      </div>
    </section>
  );
}
