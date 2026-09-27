// The final CWL lineups, as paper: one sheet per clan the leader runs, to save
// as a PDF (all clans) or as an image (one clan, for its WhatsApp group).
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
import { HeroLevels } from "@/components/cwl-lineup";
import { DownloadImageButton } from "@/components/download-image-button";
import { PrintButton } from "@/components/print-button";
import { currentUserId } from "@/lib/auth";
import { visibleClans } from "@/lib/clans";
import { playerDetails } from "@/lib/cwl-lineup-data";
import { formatDisplay } from "@/lib/display-time";
import { lineupDeadline, seasonLabel } from "@/lib/roster-view";
import { isLeadership } from "@/lib/visibility";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/server";
import { membersOfRoster, rostersForSeason } from "@/repositories/rosters";

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
  if (rosters.length === 0) notFound();

  const members = await Promise.all(rosters.map(({ roster }) => membersOfRoster(supabase, roster.id)));
  const details = await playerDetails(supabase, members.flat().map((m) => m.playerId));
  const title = seasonLabel(season);
  const deadline = lineupDeadline(season);

  return (
    <main className="mx-auto max-w-[210mm] space-y-4 p-4 sm:p-6 print:max-w-none print:p-0">
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
        One page per clan. “Download PNG” saves a single clan as an image, ready to share.
      </p>

      {rosters.map(({ roster, clan }, i) => {
        const list = members[i] ?? [];
        const id = `lineup-${clan.tag.replace("#", "")}`;
        const published = roster.status === "published";
        return (
          <section key={roster.id} className={cn("space-y-2", i > 0 && "print-page-break")}>
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
                            <TownHall level={d?.thLevel ?? m.thLevel} />
                          </td>
                          <td className="px-2 py-1.5">
                            <HeroLevels heroes={d?.heroes ?? []} compact />
                          </td>
                          <td className="px-2 py-1.5 text-right tabular-nums">
                            {d?.maxPct !== null && d?.maxPct !== undefined ? `${Math.round(d.maxPct)}%` : "—"}
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
