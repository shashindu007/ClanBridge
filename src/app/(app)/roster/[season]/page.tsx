// T4B.7, T4B.8, T4B.9 — the availability pool, the roster builder, and publish.
//
// This is the screen the decision is actually made on, so everything needed to
// decide has to be on it: poll answer, current clan, Town Hall, and last
// season's CWL record. A leader who has to open three other pages to check one
// player will do it for the first five and guess for the rest.
//
// Spans every clan the leader runs, which is why it lives outside [clanTag]. The
// double-booking guard in migration 011 is what makes that safe: assigning
// someone already picked elsewhere raises, and the message names the clan they
// are in.
//
// Saved continuously as a draft. There is no "save" button because there is
// nothing to lose — each add and remove is its own write.
//
// ─────────────────────────────────────────────────────────────────────────────
// REDESIGNED FOR A LEADER USING IT THE FIRST TIME
//
// The first version put every clan's lineup in a row across the top and the
// player list underneath, with a button PER CLAN on every player row — four clans
// and eighty players was three hundred and twenty buttons, and the result of a
// press landed in a panel scrolled out of view. Nothing said what "draft" meant,
// a bare "18" was a Town Hall level only to whoever wrote it, and there was no
// way to find one player among eighty.
//
// Now:
//   - ONE LINEUP AT A TIME, chosen with tabs that still show every clan's count
//     and status. Each player row has a single "Add", and it is unambiguous where
//     it goes because the lineup being filled sits beside the list.
//   - THE LIST FILTERS AND SEARCHES, and hides players already picked by default.
//     Filters live in the URL (lib/roster-view.ts), so an add or a remove puts
//     the leader back exactly where they were.
//   - A "How this works" panel, open until the first player is picked.
//   - Someone without a leadership role gets the published lineups, read-only,
//     rather than an empty builder telling them to run a sync.
//
// AND AGAIN (the CWL dashboard pass). The list-beside-lineup halves left each
// too narrow to read: the lineup is now the page, full width, as a grid of
// cards — Town Hall, heroes, % of max and the last CWLs on every one — and the
// player list moved into an "Add players" dialog with room for those same
// columns. The dialog's open state is in the URL (?pick=1), so it stays open
// through every Add. A deadline banner counts down to the 2nd, when lineups
// are due, and the export sheet (./print) turns the final lineups into a PDF or
// an image for each clan.
// ─────────────────────────────────────────────────────────────────────────────

import { PageHeader } from "@/components/page-header";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { CalendarClock, CircleAlert, FileDown, UserPlus } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/submit-button";
import {
  AvailabilityBadge,
  AvailabilityChips,
  HowItWorks,
  LineupPanel,
  LineupStatus,
  PoolSearch,
  SlotMeter,
  Step,
  TownHall,
} from "@/components/lineup-parts";
import { CwlHistoryChips, HeroLevels, LineupCard, MaxPct } from "@/components/cwl-lineup";
import { PickerDialog } from "@/components/picker-dialog";
import { Countdown } from "@/components/countdown";
import { LocalTime } from "@/components/local-time";
import { playerDetails, type PlayerDetail } from "@/lib/cwl-lineup-data";
import { currentUserId } from "@/lib/auth";
import { visibleClans, type VisibleClan } from "@/lib/clans";
import { isLeadership } from "@/lib/visibility";
import {
  DEFAULT_QUERY,
  availabilityCounts,
  builderSearch,
  filterPool,
  lineupDeadline,
  parseBuilderQuery,
  seasonLabel,
} from "@/lib/roster-view";
import { createClient } from "@/lib/supabase/server";
import { membersForClan } from "@/repositories/members";
import {
  optionsForPoll,
  pollsForClan,
  responsesForPoll,
  type PollResponse,
} from "@/repositories/polls";
import {
  addToRoster,
  membersOfRoster,
  publishRoster,
  removeFromRoster,
  rostersForSeason,
  unpublishRoster,
  type RosterMember,
} from "@/repositories/rosters";

export const dynamic = "force-dynamic";

async function mutate(formData: FormData) {
  "use server";

  const supabase = await createClient();
  const userId = await currentUserId(supabase);
  if (!userId) redirect("/login");

  const season = String(formData.get("season") ?? "");
  if (!/^\d{4}-\d{2}$/.test(season)) redirect("/roster");
  const action = String(formData.get("action") ?? "");
  const rosterId = String(formData.get("rosterId") ?? "");
  const playerId = String(formData.get("playerId") ?? "");

  // Back to the same lineup, filters and search. The field is user input like any
  // other, so it goes through the same allow-list the page reads its URL with.
  const view = builderSearch(parseBuilderQuery(new URLSearchParams(String(formData.get("view") ?? ""))));
  const here = `/roster/${encodeURIComponent(season)}${view}`;
  const join = view ? "&" : "?";

  let result: { error?: string } = {};
  // The code the toast shows on the way back out. Paired with the call rather
  // than derived from `action` afterwards, so adding a fifth action here cannot
  // silently inherit the fourth one's wording.
  let done = "";
  if (action === "add") {
    result = await addToRoster(supabase, rosterId, playerId, userId);
    done = "roster-added";
  } else if (action === "remove") {
    result = await removeFromRoster(supabase, rosterId, playerId);
    done = "roster-dropped";
  } else if (action === "publish") {
    result = await publishRoster(supabase, rosterId);
    done = "roster-published";
  } else if (action === "unpublish") {
    result = await unpublishRoster(supabase, rosterId);
    done = "roster-unpublished";
  } else {
    redirect(`${here}${join}error=unknown-action`);
  }

  // The double-booking guard's message names the clashing clan, so it is passed
  // through verbatim. "Already in the Clan B roster" is actionable; a generic
  // "constraint violation" sends the leader hunting through three rosters.
  // lib/feedback.ts shows an unrecognised code as itself for exactly this.
  if (result.error) redirect(`${here}${join}error=${encodeURIComponent(result.error)}`);

  revalidatePath(`/roster/${encodeURIComponent(season)}`);
  redirect(`${here}${join}ok=${done}`);
}

interface PoolPlayer {
  playerId: string;
  tag: string;
  name: string;
  thLevel: number | null;
  clanId: string;
  clanName: string;
  answer: string | null;
  answerNote: string | null;
  /** Heroes, % of max and the last three CWLs (T11C.4: from any family clan). */
  detail: PlayerDetail | null;
  assignedTo: string | null;
}

export default async function RosterBuilderPage({
  params,
  searchParams,
}: {
  params: Promise<{ season: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ season: rawSeason }, search] = await Promise.all([params, searchParams]);
  const season = decodeURIComponent(rawSeason);
  const query = parseBuilderQuery(search);
  const supabase = await createClient();

  const userId = await currentUserId(supabase);
  if (!userId) redirect("/login");

  const clans = await visibleClans(supabase, userId);
  const clanById = new Map<string, VisibleClan>(clans.map((c) => [c.id, c]));
  const leads = clans.filter((c) => isLeadership(c.role));

  const rosters = await rostersForSeason(supabase, season);
  if (rosters.length === 0) notFound();

  const byClanName = (a: { clanId: string }, b: { clanId: string }) =>
    (clanById.get(a.clanId)?.name ?? "").localeCompare(clanById.get(b.clanId)?.name ?? "");

  // Rosters this caller may actually edit. RLS already restricts what came back;
  // this is the mechanism to the policy's net (R3).
  const editable = rosters.filter((r) => leads.some((c) => c.id === r.clanId)).sort(byClanName);

  const memberLists = await Promise.all(rosters.map((roster) => membersOfRoster(supabase, roster.id)));
  const rosterMembers = new Map<string, RosterMember[]>(
    rosters.map((roster, index) => [roster.id, memberLists[index]!]),
  );

  const base = `/roster/${encodeURIComponent(season)}`;
  const title = seasonLabel(season);

  // ── Not leadership: the published lineups, read-only ─────────────────────
  if (editable.length === 0) {
    const visible = rosters.filter((r) => r.status === "published").sort(byClanName);
    return (
      <main className="mx-auto max-w-page space-y-6 p-4 sm:p-6">
        <RosterHeader title={title} />
        <Alert variant="info">
          <CircleAlert aria-hidden />
          <AlertTitle>Only leaders and co-leaders pick lineups</AlertTitle>
          <AlertDescription>
            You can see the lineups that have been published for {title}. If yours is not
            here yet, your leader has not published it.
          </AlertDescription>
        </Alert>
        {visible.length === 0 ? (
          <p className="text-muted-foreground text-sm">No lineup has been published for this season yet.</p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {visible.map((roster) => (
              <LineupPanel
                key={roster.id}
                title={clanById.get(roster.clanId)?.name ?? "Clan"}
                status={roster.status}
                slots={roster.slotCount}
                members={rosterMembers.get(roster.id) ?? []}
              />
            ))}
          </div>
        )}
      </main>
    );
  }

  // Which lineup is being filled. A tag in the URL that is not one of the
  // caller's lineups falls back to the first rather than 404ing a shared link.
  const selected =
    editable.find((r) => clanById.get(r.clanId)?.tag === query.clan) ?? editable[0]!;
  const selectedClan = clanById.get(selected.clanId)!;
  const selectedMembers = rosterMembers.get(selected.id) ?? [];
  const selectedFull = selectedMembers.length >= selected.slotCount;
  const current = { ...query, clan: selectedClan.tag };

  const assignment = new Map<string, string>(); // playerId -> rosterId
  for (const [rosterId, members] of rosterMembers) {
    for (const m of members) assignment.set(m.playerId, rosterId);
  }

  // The season's availability poll, if one was opened. Family-scoped, so any
  // clan's list finds it.
  const polls = await pollsForClan(supabase, leads[0]!.id);
  const availabilityPoll = polls.find(
    (p) => p.pollType === "cwl_availability" && (p.season === season || p.season === null),
  );
  let answers = new Map<string, PollResponse>();
  let optionLabel = new Map<string, string>();
  if (availabilityPoll) {
    const [responses, options] = await Promise.all([
      responsesForPoll(supabase, availabilityPoll.id),
      optionsForPoll(supabase, availabilityPoll.id),
    ]);
    answers = new Map(responses.map((r) => [r.playerId, r]));
    optionLabel = new Map(options.map((o) => [o.id, o.label]));
  }

  // ONE read for the whole pool, from every clan in the family (T11C.4). It used
  // to be a per-player walk of each clan's CWL tree — thousands of round trips —
  // and then a per-clan one that could not see CWL played in DH CWL ONLY.
  const perClan = await Promise.all(
    leads.map(async (clan) => ({ clan, members: await membersForClan(supabase, clan.id) })),
  );
  // Picked players are included even if they have since left the clans in the
  // pool, so every card in the lineup has its details.
  const details = await playerDetails(supabase, [
    ...perClan.flatMap(({ members }) => members.map((m) => m.playerId)),
    ...selectedMembers.map((m) => m.playerId),
  ]);

  const pool: PoolPlayer[] = [];
  for (const { clan, members } of perClan) {
    for (const member of members) {
      const answer = answers.get(member.playerId);
      pool.push({
        playerId: member.playerId,
        tag: member.tag,
        name: member.name,
        thLevel: member.thLevel,
        clanId: clan.id,
        clanName: clan.name,
        answer: answer ? (optionLabel.get(answer.optionId) ?? null) : null,
        answerNote: answer?.note ?? null,
        detail: details.get(member.playerId) ?? null,
        assignedTo: assignment.get(member.playerId) ?? null,
      });
    }
  }

  // In first, then Maybe, then unanswered, then Out — the order a leader works
  // down. Within a band, the highest Town Hall first.
  const answerRank = (a: string | null): number => {
    const label = a?.toLowerCase() ?? null;
    return label === "in" ? 0 : label === "maybe" ? 1 : label === null ? 2 : 3;
  };
  pool.sort(
    (a, b) =>
      answerRank(a.answer) - answerRank(b.answer) ||
      (b.thLevel ?? 0) - (a.thLevel ?? 0) ||
      a.name.localeCompare(b.name),
  );

  const shown = filterPool(pool, current);
  const counts = availabilityCounts(pool, current);
  const everyone = availabilityCounts(pool, { ...DEFAULT_QUERY, picked: "show" });
  const pickedCount = pool.filter((p) => p.assignedTo !== null).length;
  const nobodyPickedYet = editable.every((r) => (rosterMembers.get(r.id) ?? []).length === 0);
  const filtersActive = current.show !== "all" || current.q !== "" || current.from !== null;
  const rosterClanName = (rosterId: string) =>
    clanById.get(rosters.find((r) => r.id === rosterId)?.clanId ?? "")?.name ?? "another";
  const pollClanTag = encodeURIComponent(leads[0]!.tag);
  const view = builderSearch(current);
  const pickerHref = `${base}${builderSearch(current, { pick: true })}`;
  const closeHref = `${base}${builderSearch(current, { pick: false })}`;

  // The lineup as cards. The pool knows each player's clan; a picked player who
  // has since left the clans in the pool falls back to what the roster knows.
  const poolById = new Map(pool.map((p) => [p.playerId, p]));
  const cards = selectedMembers.map((m) => {
    const inPool = poolById.get(m.playerId);
    const detail = details.get(m.playerId);
    return {
      playerId: m.playerId,
      tag: m.tag,
      name: m.name,
      clanName: inPool?.clanName ?? null,
      thLevel: detail?.thLevel ?? m.thLevel,
      heroes: detail?.heroes ?? [],
      maxPct: detail?.maxPct ?? null,
      heroPct: detail?.heroPct ?? null,
      history: detail?.history ?? [],
    };
  });
  const deadline = lineupDeadline(season);
  const beforeDeadline = deadline !== null && deadline.getTime() > Date.now();

  return (
    <main className="mx-auto max-w-page space-y-6 p-4 sm:p-6">
      <RosterHeader title={title} exportHref={`${base}/print`} />

      <HowItWorks open={nobodyPickedYet}>
        <Step n={1} title="Check who is available">
          Members answer the CWL availability poll with In, Maybe or Out. Their answers show
          in the player list.
        </Step>
        <Step n={2} title="Pick each clan's lineup">
          Choose a clan in the tabs, press Add players, and Add beside each player. Up to{" "}
          {selected.slotCount} per clan. Everything saves as you go.
        </Step>
        <Step n={3} title="Publish">
          Drafts are private to leaders. Publish a lineup when it is ready and that
          clan&apos;s members can see it.
        </Step>
      </HowItWorks>

      {deadline && (
        <div
          className={`flex flex-wrap items-center justify-between gap-3 rounded-panel border-2 px-5 py-3 text-sm ${
            beforeDeadline ? "border-warning/60 bg-warning-tint" : "bg-muted border-border"
          }`}
        >
          <p className="flex flex-wrap items-center gap-2">
            <CalendarClock aria-hidden className="size-4" />
            <span className="font-semibold">
              {beforeDeadline ? "Lineups due by" : "Lineups were due"}{" "}
              <LocalTime iso={deadline.toISOString()} style="date" />
            </span>
            {beforeDeadline && (
              <span className="text-warning-ink">
                · <Countdown iso={deadline.toISOString()} refreshOnDone={false} /> left
              </span>
            )}
          </p>
          <span className="text-muted-foreground">
            CWL starts at the beginning of the month — finish and publish before the 2nd.
          </span>
        </div>
      )}

      {availabilityPoll ? (
        <div className="cb-panel flex flex-wrap items-center justify-between gap-3 rounded-panel border px-5 py-3 text-sm">
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-medium">Availability poll</span>
            <span className="tabular-nums">{everyone.in} In</span>
            <span className="tabular-nums">{everyone.maybe} Maybe</span>
            <span className="tabular-nums">{everyone.out} Out</span>
            <span className="text-muted-foreground tabular-nums">{everyone.none} not answered</span>
          </p>
          <Button asChild variant="outline" size="sm">
            <Link href={`/${pollClanTag}/polls/${availabilityPoll.id}`}>View poll</Link>
          </Button>
        </div>
      ) : (
        <Alert variant="warning">
          <CircleAlert aria-hidden />
          <AlertTitle>No availability poll for this season yet</AlertTitle>
          <AlertDescription className="space-y-3">
            <p>
              You can still pick players, but you will not know who can play. Create a poll
              and members&apos; answers will appear in the list below.
            </p>
            <Button asChild size="sm">
              <Link href={`/${pollClanTag}/polls/new?type=cwl_availability`}>
                Create availability poll
              </Link>
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {editable.length > 1 && (
        <nav aria-label="Choose a clan's lineup" className="flex flex-wrap gap-2">
          {editable.map((roster) => {
            const clan = clanById.get(roster.clanId)!;
            const filled = (rosterMembers.get(roster.id) ?? []).length;
            const active = roster.id === selected.id;
            return (
              <Link
                key={roster.id}
                href={`${base}${builderSearch(current, { clan: clan.tag })}`}
                aria-current={active ? "page" : undefined}
                className={`flex min-w-40 flex-col gap-1 rounded-control border px-4 py-2.5 text-left transition-colors ${
                  active
                    ? "border-primary bg-primary text-primary-foreground"
                    : "bg-card hover:bg-accent"
                }`}
              >
                <span className="font-medium">{clan.name}</span>
                <span className={`text-xs tabular-nums ${active ? "" : "text-muted-foreground"}`}>
                  {filled} of {roster.slotCount} · {roster.status === "published" ? "Published" : "Draft"}
                </span>
              </Link>
            );
          })}
        </nav>
      )}

      {/* ── The lineup being built, full width ──────────────────────────── */}
      <section aria-label={`${selectedClan.name} lineup`} className="cb-panel space-y-5 rounded-panel border p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <h2 className="flex flex-wrap items-center gap-2 text-xl font-semibold">
              {selectedClan.name}
              <LineupStatus status={selected.status} />
            </h2>
            <p className="text-muted-foreground text-xs">
              {selected.status === "published"
                ? "Published — members of this clan can see this lineup."
                : "Draft — only leaders and co-leaders can see it until you publish."}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant={selectedFull ? "outline" : "gold"}>
              <Link href={pickerHref} scroll={false}>
                <UserPlus aria-hidden />
                Add players
              </Link>
            </Button>
            <form action={mutate}>
              <input type="hidden" name="season" value={season} />
              <input type="hidden" name="view" value={view} />
              <input type="hidden" name="rosterId" value={selected.id} />
              <input
                type="hidden"
                name="action"
                value={selected.status === "published" ? "unpublish" : "publish"}
              />
              <SubmitButton
                variant="outline"
                disabled={selected.status !== "published" && selectedMembers.length === 0}
                pendingLabel={selected.status === "published" ? "Unpublishing" : "Publishing"}
              >
                {selected.status === "published" ? "Unpublish" : "Publish to members"}
              </SubmitButton>
            </form>
          </div>
        </div>

        <SlotMeter filled={selectedMembers.length} slots={selected.slotCount} />

        {cards.length === 0 ? (
          <p className="text-muted-foreground rounded-panel border border-dashed p-6 text-center text-sm">
            Nobody picked yet. Press <span className="text-foreground font-medium">Add players</span>{" "}
            to open the player list.
          </p>
        ) : (
          <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {cards.map((player, index) => (
              <LineupCard
                key={player.playerId}
                index={index + 1}
                player={player}
                remove={{ action: mutate, hidden: { season, view, rosterId: selected.id } }}
              />
            ))}
          </ol>
        )}
      </section>

      {/* ── The player list, in a dialog with room for every column ───────── */}
      <PickerDialog
        open={current.pick}
        closeHref={closeHref}
        title={`Add players to ${selectedClan.name}`}
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="text-foreground font-medium tabular-nums">
              {selectedMembers.length} of {selected.slotCount} picked
            </span>
            <span>
              Everyone in the clans you lead. Said In first, then the highest Town Hall.
            </span>
          </span>
        }
        toolbar={
          <>
            <AvailabilityChips
              active={current.show}
              counts={counts}
              hrefFor={(show) => `${base}${builderSearch(current, { show })}`}
            />
            {/* A plain GET form: the filters are URL state, so no client code.
                pick=1 rides along so the dialog is still open afterwards. */}
            <PoolSearch
              action={base}
              hidden={{
                clan: selectedClan.tag,
                pick: "1",
                ...(current.show !== "all" ? { show: current.show } : {}),
                ...(current.picked !== "hide" ? { picked: current.picked } : {}),
              }}
              q={current.q}
              clans={leads}
              from={current.from}
              clearHref={
                filtersActive
                  ? `${base}${builderSearch({ ...DEFAULT_QUERY, clan: selectedClan.tag, picked: current.picked, pick: true })}`
                  : null
              }
            />
            <p className="text-muted-foreground text-sm">
              Showing {shown.length} player{shown.length === 1 ? "" : "s"}
              {pickedCount > 0 && (
                <>
                  {" · "}
                  {pickedCount} already in a lineup{" "}
                  <Link
                    className="text-foreground underline underline-offset-2"
                    href={`${base}${builderSearch(current, { picked: current.picked === "hide" ? "show" : "hide" })}`}
                    scroll={false}
                  >
                    {current.picked === "hide" ? "show them" : "hide them"}
                  </Link>
                </>
              )}
            </p>
          </>
        }
      >
        {pool.length === 0 ? (
          <p className="text-muted-foreground rounded-panel border border-dashed p-6 text-center text-sm">
            No players found in the clans you lead. They appear after the clan sync has
            run once.
          </p>
        ) : shown.length === 0 ? (
          <p className="text-muted-foreground rounded-panel border border-dashed p-6 text-center text-sm">
            No players match these filters.{" "}
            <Link
              className="text-foreground underline underline-offset-2"
              href={`${base}${builderSearch({ ...DEFAULT_QUERY, clan: selectedClan.tag, picked: "show", pick: true })}`}
              scroll={false}
            >
              Show everyone
            </Link>
          </p>
        ) : (
          <table className="w-full min-w-[52rem] text-sm">
            <thead className="bg-card text-muted-foreground sticky top-0 z-10 border-b text-left text-xs uppercase">
              <tr>
                <th className="py-2 pr-3 font-medium">Player</th>
                <th className="py-2 pr-3 font-medium">TH</th>
                <th className="py-2 pr-3 font-medium">Heroes</th>
                <th className="py-2 pr-3 font-medium">Max</th>
                <th className="py-2 pr-3 font-medium">Last CWLs (stars · attacks)</th>
                <th className="py-2 pr-3 font-medium">Availability</th>
                <th className="py-2 text-right font-medium">
                  <span className="sr-only">Action</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((p) => (
                <tr
                  key={p.playerId}
                  className={`border-b align-middle last:border-0 ${p.assignedTo === selected.id ? "bg-success-tint/50" : ""}`}
                >
                  <td className="py-2.5 pr-3">
                    <span className="block font-medium">{p.name}</span>
                    <span className="text-muted-foreground block text-xs">
                      {p.clanName} · <span className="font-mono">{p.tag}</span>
                    </span>
                    {p.answerNote && (
                      <span className="text-muted-foreground mt-0.5 block text-xs italic">
                        “{p.answerNote}”
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 pr-3">
                    <TownHall level={p.detail?.thLevel ?? p.thLevel} />
                  </td>
                  <td className="max-w-56 py-2.5 pr-3">
                    <HeroLevels heroes={p.detail?.heroes ?? []} compact />
                  </td>
                  <td className="py-2.5 pr-3">
                    <MaxPct pct={p.detail?.maxPct ?? null} />
                  </td>
                  <td className="py-2.5 pr-3">
                    <CwlHistoryChips seasons={p.detail?.history ?? []} ownClanName={p.clanName} />
                  </td>
                  <td className="py-2.5 pr-3">
                    <AvailabilityBadge answer={p.answer} />
                  </td>
                  <td className="py-2.5 text-right">
                    {p.assignedTo === selected.id ? (
                      <form action={mutate} className="flex items-center justify-end gap-2">
                        <Badge variant="success">Selected ✓</Badge>
                        <input type="hidden" name="season" value={season} />
                        <input type="hidden" name="view" value={builderSearch(current, { pick: true })} />
                        <input type="hidden" name="action" value="remove" />
                        <input type="hidden" name="rosterId" value={selected.id} />
                        <input type="hidden" name="playerId" value={p.playerId} />
                        <SubmitButton size="xs" variant="ghost" pendingLabel="Removing" aria-label={`Remove ${p.name}`}>
                          Undo
                        </SubmitButton>
                      </form>
                    ) : p.assignedTo ? (
                      <span className="text-muted-foreground text-xs">
                        In {rosterClanName(p.assignedTo)}
                      </span>
                    ) : selectedFull ? (
                      <span className="text-muted-foreground text-xs">Lineup full</span>
                    ) : (
                      <form action={mutate}>
                        <input type="hidden" name="season" value={season} />
                        <input type="hidden" name="view" value={builderSearch(current, { pick: true })} />
                        <input type="hidden" name="action" value="add" />
                        <input type="hidden" name="rosterId" value={selected.id} />
                        <input type="hidden" name="playerId" value={p.playerId} />
                        {/* Each button owns its own form, so useFormStatus
                            reports only THIS add as pending. */}
                        <SubmitButton
                          size="sm"
                          variant={p.answer?.toLowerCase() === "in" ? "default" : "outline"}
                          pendingLabel="Adding"
                          aria-label={`Add ${p.name} to the ${selectedClan.name} lineup`}
                        >
                          Add
                        </SubmitButton>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </PickerDialog>

      {editable.length > 1 && (
        <p className="text-muted-foreground flex flex-wrap items-center gap-2 text-sm">
          Other lineups:
          {editable
            .filter((r) => r.id !== selected.id)
            .map((r) => (
              <span key={r.id} className="inline-flex items-center gap-1">
                {clanById.get(r.clanId)?.name}
                <LineupStatus status={r.status} />
              </span>
            ))}
        </p>
      )}
    </main>
  );
}

/**
 * The builder's header. It used to be a local component ALSO called
 * PageHeader, shadowing the shared one with a hand-built copy of it; now it is
 * the shared one, with the back link it always had.
 */
function RosterHeader({ title, exportHref }: { title: string; exportHref?: string }) {
  return (
    <PageHeader
      back={{ href: "/roster", label: "All CWL seasons" }}
      title={`CWL lineups · ${title}`}
      description="Pick who plays Clan War League for each clan this season."
      actions={
        exportHref ? (
          <Button asChild variant="outline" size="sm">
            <Link href={exportHref}>
              <FileDown aria-hidden />
              Export lineups
            </Link>
          </Button>
        ) : undefined
      }
    />
  );
}
