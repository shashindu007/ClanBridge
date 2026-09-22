// T6.7 — War availability poll.
// T6.8 — War lineup selection.
//
// The API cannot say who WILL be in a war, only who is. This page is entirely
// human-decision data (R11), which is why it needs a backend at all and why no
// sync job may write anything it produces — migration 024 revokes those grants
// rather than trusting a comment.
//
// ─────────────────────────────────────────────────────────────────────────────
// T6.7 IS THE STRIP AT THE TOP, NOT A SEPARATE SCREEN
//
// "Leader opens a poll before declaring war. The leader sees the count before
// choosing the war size." The count appears WHERE THE SIZE IS CHOSEN. A count on
// the polls page and a size box on this one is two tabs and a memory test, and the
// leader will guess rather than switch.
//
// A DRAFT IS INVISIBLE TO MEMBERS, and the policy in 024 enforces that, not this
// page.
// ─────────────────────────────────────────────────────────────────────────────
//
// REDESIGNED ALONGSIDE THE CWL ROSTER BUILDER, and built from the same parts
// (components/lineup-parts.tsx), because a leader who has learned one lineup page
// should already know the other. What changed for a first-time leader:
//
//   - The lineup sits BESIDE the player list and stays in view, instead of above
//     a list that scrolled it away; "Pick" and "Drop" are "Add" and "Remove".
//   - Availability is a labelled badge with an icon, Town Hall says "TH", and the
//     list can be filtered by answer and searched.
//   - Several planned lineups are tabs at the top, not a row of date buttons at
//     the bottom of the page; starting another is one of those tabs.
//   - Choosing a war size says what the poll answers support, next to the choice.
//   - "How this works" explains poll → pick → publish → link, until it is used.
//
// Saved on every click. There is no save button because there is nothing to lose.

import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { CircleAlert, Link2, Plus } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/submit-button";
import {
  AvailabilityBadge,
  AvailabilityChips,
  HowItWorks,
  LineupPanel,
  PoolSearch,
  Step,
  TownHall,
} from "@/components/lineup-parts";
import { PageHeader } from "@/components/page-header";
import { currentUserId } from "@/lib/auth";
import { requireClanByTag } from "@/lib/clans";
import { isLeadership } from "@/lib/visibility";
import { formatDisplay } from "@/lib/display-time";
import {
  DEFAULT_QUERY,
  availabilityCounts,
  builderSearch,
  filterPool,
  parseBuilderQuery,
  type BuilderQuery,
} from "@/lib/roster-view";
import { createClient } from "@/lib/supabase/server";
import { membersForClan } from "@/repositories/members";
import { countsForPoll, pollsForClan, responsesForPoll } from "@/repositories/polls";
import {
  addToLineup,
  attachLineupToWar,
  createLineup,
  currentWar,
  lineupById,
  lineupsForClan,
  membersOfLineup,
  publishLineup,
  removeFromLineup,
  unpublishLineup,
  type Lineup,
} from "@/repositories/war";
import { openWarAvailabilityPoll } from "@/services/polls";

export const dynamic = "force-dynamic";

/** 5v5 to 50v50, the sizes the game actually offers. 024's CHECK allows 5–50. */
const WAR_SIZES = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50];

const UUID = /^[0-9a-f-]{36}$/i;

/** The largest war the "In" answers can fill, or null below 5. */
function supportedSize(inCount: number): number | null {
  return WAR_SIZES.filter((s) => s <= inCount).at(-1) ?? null;
}

/** This page's URL state: which lineup, plus the shared list filters. */
function lineupSearch(query: BuilderQuery, lineupId: string | null, extra: Partial<BuilderQuery> = {}) {
  const filters = builderSearch({ ...query, clan: null, from: null, picked: "hide" }, extra);
  const params = new URLSearchParams(filters.slice(1));
  if (lineupId) params.set("lineup", lineupId);
  const text = params.toString();
  return text ? `?${text}` : "";
}

async function mutate(formData: FormData) {
  "use server";

  const supabase = await createClient();
  const userId = await currentUserId(supabase);
  if (!userId) redirect("/login");

  const clanTag = String(formData.get("clanTag") ?? "");
  const clanId = String(formData.get("clanId") ?? "");
  const action = String(formData.get("action") ?? "");
  let lineupId = String(formData.get("lineupId") ?? "");
  const playerId = String(formData.get("playerId") ?? "");
  const path = `/${encodeURIComponent(clanTag)}/war/lineup`;

  // Back to the same lineup and filters. Allow-listed like the page's own URL.
  const query = parseBuilderQuery(new URLSearchParams(String(formData.get("view") ?? "")));
  const back = () => `${path}${lineupSearch(query, UUID.test(lineupId) ? lineupId : null)}`;
  const join = () => (back().includes("?") ? "&" : "?");

  let result: { error?: string } = {};
  // Paired with each call, so the toast says what actually happened.
  let done = "";

  if (action === "create") {
    const size = Number(formData.get("size") ?? 15);
    const created = await createLineup(supabase, clanId, size, userId);
    if ("error" in created) result = { error: created.error };
    else lineupId = created.id;
    done = "lineup-started";
  } else if (action === "add") {
    result = await addToLineup(supabase, lineupId, playerId, userId);
    done = "lineup-added";
  } else if (action === "remove") {
    result = await removeFromLineup(supabase, lineupId, playerId);
    done = "lineup-removed";
  } else if (action === "publish") {
    result = await publishLineup(supabase, lineupId);
    done = "lineup-published";
  } else if (action === "unpublish") {
    result = await unpublishLineup(supabase, lineupId);
    done = "lineup-unpublished";
  } else if (action === "attach") {
    // T6.10 needs this link and cannot be computed without it: until somebody
    // says "this plan was for that war", the plan and the outcome are two
    // unrelated lists.
    result = await attachLineupToWar(supabase, lineupId, String(formData.get("warId") ?? ""));
    done = "lineup-linked";
  } else {
    redirect(`${back()}${join()}error=unknown-action`);
  }

  if (result.error) redirect(`${back()}${join()}error=${encodeURIComponent(result.error)}`);

  revalidatePath(path);
  redirect(`${back()}${join()}ok=${done}`);
}

export default async function WarLineupPage({
  params,
  searchParams,
}: {
  params: Promise<{ clanTag: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ clanTag }, search] = await Promise.all([params, searchParams]);
  const query = parseBuilderQuery(search);
  const requested = typeof search.lineup === "string" && UUID.test(search.lineup) ? search.lineup : null;
  const planningNew = search.new === "1";
  const supabase = await createClient();

  const clan = await requireClanByTag(supabase, clanTag);
  const userId = await currentUserId(supabase);
  if (!userId) redirect("/login");

  const base = `/${encodeURIComponent(clan.tag)}`;
  const path = `${base}/war/lineup`;
  const leadership = isLeadership(clan.role);

  // RLS returns drafts to leadership and published ones to everybody, so this
  // one call serves both views (024).
  const lineups = await lineupsForClan(supabase, clan.id);
  const selected: Lineup | null = planningNew
    ? null
    : requested
      ? await lineupById(supabase, clan.id, requested)
      : (lineups[0] ?? null);
  const picked = selected ? await membersOfLineup(supabase, selected.id) : [];

  // OPEN polls only — the newest war poll is usually last war's, closed days ago,
  // and every number below would then describe a war that already happened.
  const polls = await pollsForClan(supabase, clan.id);
  const availabilityPoll = openWarAvailabilityPoll(polls);
  const counts = availabilityPoll ? await countsForPoll(supabase, availabilityPoll.id) : [];
  const inCount = counts.find((c) => c.label.toLowerCase() === "in")?.votes ?? 0;
  const pollHref = availabilityPoll ? `${base}/polls/${encodeURIComponent(availabilityPoll.id)}` : null;

  // ── Member view: the published lineup, and nothing else ──────────────────
  if (!leadership) {
    const published = lineups.find((l) => l.status === "published") ?? null;
    const publishedMembers = published ? await membersOfLineup(supabase, published.id) : [];

    return (
      <main className="mx-auto max-w-3xl space-y-6 p-4 sm:p-8">
        <PageHeader
          eyebrow={clan.name}
          title="War lineup"
          description="Who your leaders have picked for the next war."
        />

        {pollHref && (
          <Alert variant="info">
            <CircleAlert aria-hidden />
            <AlertTitle>Can you play in the next war?</AlertTitle>
            <AlertDescription className="space-y-3">
              <p>Your answer tells your leader how big a war to declare.</p>
              <Button asChild size="sm">
                <Link href={pollHref}>Answer the poll</Link>
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {!published ? (
          <section className="cb-panel space-y-2 rounded-lg border p-6">
            <h2 className="font-medium">No lineup published yet</h2>
            {/* Honest about WHY it is empty: a leader mid-decision has a draft this
                page genuinely cannot see. */}
            <p className="text-muted-foreground text-sm">
              It appears here as soon as your leader publishes it. If they are still
              deciding, it is deliberately hidden until then.
            </p>
          </section>
        ) : (
          <>
            <LineupPanel
              title={`${published.size}v${published.size} war`}
              status="published"
              slots={published.size}
              members={publishedMembers}
              audience="everyone in the clan"
            />
            <p className="text-muted-foreground text-sm">
              If you are on this list you are expected to use both attacks. If you cannot,
              tell your leader now rather than in the last hour.
            </p>
          </>
        )}
      </main>
    );
  }

  // ── Leadership view ───────────────────────────────────────────────────────
  const [roster, answers, war] = await Promise.all([
    membersForClan(supabase, clan.id),
    availabilityPoll ? responsesForPoll(supabase, availabilityPoll.id) : Promise.resolve([]),
    currentWar(supabase, clan.id),
  ]);
  const answerByPlayer = new Map(answers.map((a) => [a.playerId, a]));
  const optionLabel = new Map(counts.map((c) => [c.optionId, c.label]));
  const pickedIds = new Set(picked.map((m) => m.playerId));

  const answerRank = (a: string | null) => {
    const label = a?.toLowerCase() ?? null;
    return label === "in" ? 0 : label === "maybe" ? 1 : label === null ? 2 : 3;
  };

  const pool = roster
    .filter((m) => !pickedIds.has(m.playerId))
    .map((m) => {
      const answer = answerByPlayer.get(m.playerId);
      return {
        ...m,
        clanId: clan.id,
        answer: answer ? (optionLabel.get(answer.optionId) ?? null) : null,
        note: answer?.note ?? null,
        assignedTo: null as string | null,
      };
    })
    // In first, then Maybe, then unanswered, then Out; highest Town Hall first.
    .sort(
      (a, b) =>
        answerRank(a.answer) - answerRank(b.answer) ||
        (b.thLevel ?? 0) - (a.thLevel ?? 0) ||
        a.name.localeCompare(b.name),
    );

  const current: BuilderQuery = { ...DEFAULT_QUERY, show: query.show, q: query.q };
  const shown = filterPool(pool, current);
  const chipCounts = availabilityCounts(pool, current);
  const view = lineupSearch(current, selected?.id ?? null);
  const full = selected ? picked.length >= selected.size : false;
  const supports = supportedSize(inCount);
  const notAnswered = Math.max(0, roster.length - answers.length);
  const filtersActive = current.show !== "all" || current.q !== "";

  return (
    <main className="mx-auto max-w-7xl space-y-6 p-4 sm:p-8">
      <PageHeader
        eyebrow={clan.name}
        title="War lineup"
        description="Plan who plays in the next war. Members only see a lineup after you publish it."
      />

      <HowItWorks open={lineups.length === 0 || (selected !== null && picked.length === 0)}>
        <Step n={1} title="Ask who can play">
          Open a war availability poll. The answers show here, with the largest war they
          can fill.
        </Step>
        <Step n={2} title="Pick the size and the players">
          Start a lineup at the size you will declare in game, then press Add beside each
          player.
        </Step>
        <Step n={3} title="Publish, then link it">
          Publish so members know who is in. Once the war starts, link the lineup to it to
          compare the plan with who actually played.
        </Step>
      </HowItWorks>

      {availabilityPoll ? (
        <div className="cb-panel flex flex-wrap items-center justify-between gap-3 rounded-lg border px-5 py-3 text-sm">
          <div className="space-y-0.5">
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="font-medium">War availability poll</span>
              {counts.map((c) => (
                <span key={c.optionId} className="tabular-nums">
                  {c.votes} {c.label}
                </span>
              ))}
              <span className="text-muted-foreground tabular-nums">{notAnswered} not answered</span>
            </p>
            <p className="text-muted-foreground text-xs">
              {supports
                ? `The In answers can fill a ${supports}v${supports} war.`
                : "Fewer than 5 have said In — not enough for even a 5v5 yet."}
            </p>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link href={pollHref!}>See who has not answered</Link>
          </Button>
        </div>
      ) : (
        <Alert variant="warning">
          <CircleAlert aria-hidden />
          <AlertTitle>No war availability poll is open</AlertTitle>
          <AlertDescription className="space-y-3">
            <p>
              You can still plan a lineup, but you will not know who can play — and the war
              size cannot be changed once matchmaking starts.
            </p>
            <Button asChild size="sm">
              <Link href={`${base}/polls/new?type=war_availability`}>Open a war availability poll</Link>
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {lineups.length > 0 && (
        <nav aria-label="Planned lineups" className="flex flex-wrap gap-2">
          {lineups.map((l) => {
            const active = l.id === selected?.id;
            return (
              <Link
                key={l.id}
                href={`${path}${lineupSearch(current, l.id)}`}
                aria-current={active ? "page" : undefined}
                className={`flex min-w-40 flex-col gap-1 rounded-lg border px-4 py-2.5 transition-colors ${
                  active ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-accent"
                }`}
              >
                <span className="font-medium">
                  {l.size}v{l.size} war
                </span>
                <span className={`text-xs ${active ? "" : "text-muted-foreground"}`}>
                  {formatDisplay(l.plannedFor, "date")} · {l.status === "published" ? "Published" : "Draft"}
                  {l.warId ? " · linked" : ""}
                </span>
              </Link>
            );
          })}
          <Link
            href={`${path}?new=1`}
            aria-current={planningNew ? "page" : undefined}
            className={`flex items-center gap-2 rounded-lg border border-dashed px-4 py-2.5 text-sm transition-colors ${
              planningNew || !selected ? "border-primary bg-accent" : "hover:bg-accent"
            }`}
          >
            <Plus aria-hidden className="size-4" />
            Plan another war
          </Link>
        </nav>
      )}

      {!selected ? (
        <form action={mutate} className="cb-panel max-w-xl space-y-4 rounded-lg border p-6">
          <input type="hidden" name="clanTag" value={clan.tag} />
          <input type="hidden" name="clanId" value={clan.id} />
          <input type="hidden" name="action" value="create" />
          <div className="space-y-1">
            <h2 className="cb-title text-xl">Start a lineup</h2>
            <p className="text-muted-foreground text-sm">
              Choose the size you will declare in game. The lineup saves as you go and stays
              private until you publish it.
            </p>
          </div>
          <label className="block space-y-1.5">
            <span className="block text-sm font-medium">War size</span>
            <select
              name="size"
              defaultValue={supports ?? 15}
              className="border-input bg-background h-10 w-full rounded-md border px-3 text-sm sm:w-56"
            >
              {WAR_SIZES.map((s) => (
                <option key={s} value={s}>
                  {s} vs {s}
                  {s === supports ? " (fits the In answers)" : ""}
                </option>
              ))}
            </select>
          </label>
          <SubmitButton pendingLabel="Starting">Start lineup</SubmitButton>
        </form>
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
          <aside className="order-first lg:sticky lg:top-4 lg:order-last">
            <LineupPanel
              title={`${selected.size}v${selected.size} war`}
              status={selected.status}
              slots={selected.size}
              members={picked}
              action={mutate}
              audience="everyone in the clan"
              hidden={{ clanTag: clan.tag, clanId: clan.id, lineupId: selected.id, view }}
            >
              {/* T6.10's prerequisite. Offered, not automatic: only a human knows
                  which war a plan was made for. */}
              {war && !selected.warId && selected.status === "published" && (
                <form action={mutate} className="space-y-2 border-t pt-4">
                  <input type="hidden" name="clanTag" value={clan.tag} />
                  <input type="hidden" name="clanId" value={clan.id} />
                  <input type="hidden" name="action" value="attach" />
                  <input type="hidden" name="lineupId" value={selected.id} />
                  <input type="hidden" name="warId" value={war.id} />
                  <input type="hidden" name="view" value={view} />
                  <p className="text-sm">
                    Was this lineup for the war against{" "}
                    <span className="font-medium">{war.opponentName ?? "the current opponent"}</span>?
                  </p>
                  <SubmitButton size="sm" variant="outline" className="w-full" pendingLabel="Linking">
                    <Link2 aria-hidden />
                    Link it to this war
                  </SubmitButton>
                  <p className="text-muted-foreground text-xs">
                    Linking lets the war report compare who you picked with who played.
                  </p>
                </form>
              )}
              {selected.warId && (
                <p className="text-muted-foreground border-t pt-4 text-sm">
                  Linked to a war.{" "}
                  <Link
                    className="text-foreground underline underline-offset-2"
                    href={`${base}/war/report?war=${encodeURIComponent(selected.warId)}`}
                  >
                    Compare picked with played
                  </Link>
                </p>
              )}
            </LineupPanel>
          </aside>

          <section className="cb-panel min-w-0 space-y-4 rounded-lg border p-5">
            <div className="space-y-1">
              <h2 className="cb-title text-xl">Add players</h2>
              <p className="text-muted-foreground text-sm">
                Everyone in {clan.name} not yet in this lineup. Players who said In come
                first, then the highest Town Hall.
              </p>
            </div>

            <AvailabilityChips
              active={current.show}
              counts={chipCounts}
              hrefFor={(show) => `${path}${lineupSearch(current, selected.id, { show })}`}
            />
            <PoolSearch
              action={path}
              hidden={{
                lineup: selected.id,
                ...(current.show !== "all" ? { show: current.show } : {}),
              }}
              q={current.q}
              clearHref={filtersActive ? `${path}${lineupSearch(DEFAULT_QUERY, selected.id)}` : null}
            />
            <p className="text-muted-foreground text-sm">
              Showing {shown.length} of {pool.length} player{pool.length === 1 ? "" : "s"}
            </p>

            {pool.length === 0 ? (
              <p className="text-muted-foreground rounded-md border border-dashed p-6 text-center text-sm">
                Everybody in the clan is already in this lineup.
              </p>
            ) : shown.length === 0 ? (
              <p className="text-muted-foreground rounded-md border border-dashed p-6 text-center text-sm">
                No players match these filters.{" "}
                <Link
                  className="text-foreground underline underline-offset-2"
                  href={`${path}${lineupSearch(DEFAULT_QUERY, selected.id)}`}
                >
                  Show everyone
                </Link>
              </p>
            ) : (
              <div className="-mx-5 overflow-x-auto px-5">
                <table className="w-full min-w-[32rem] text-sm">
                  <thead className="text-muted-foreground border-b text-left text-xs uppercase">
                    <tr>
                      <th className="py-2 pr-3 font-medium">Player</th>
                      <th className="py-2 pr-3 font-medium">Town Hall</th>
                      <th className="py-2 pr-3 font-medium">Availability</th>
                      <th className="py-2 text-right font-medium">
                        <span className="sr-only">Action</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((m) => (
                      <tr key={m.playerId} className="border-b align-middle last:border-0">
                        <td className="py-2.5 pr-3">
                          <Link
                            className="block font-medium underline-offset-2 hover:underline"
                            href={`${base}/player/${encodeURIComponent(m.tag)}`}
                          >
                            {m.name}
                          </Link>
                          <span className="text-muted-foreground block font-mono text-xs">{m.tag}</span>
                          {m.note && (
                            <span className="text-muted-foreground mt-0.5 block text-xs italic">
                              “{m.note}”
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 pr-3">
                          <TownHall level={m.thLevel} />
                        </td>
                        <td className="py-2.5 pr-3">
                          <AvailabilityBadge answer={m.answer} />
                        </td>
                        <td className="py-2.5 text-right">
                          {full ? (
                            <span className="text-muted-foreground text-xs">Lineup full</span>
                          ) : (
                            <form action={mutate}>
                              <input type="hidden" name="clanTag" value={clan.tag} />
                              <input type="hidden" name="clanId" value={clan.id} />
                              <input type="hidden" name="action" value="add" />
                              <input type="hidden" name="lineupId" value={selected.id} />
                              <input type="hidden" name="playerId" value={m.playerId} />
                              <input type="hidden" name="view" value={view} />
                              <SubmitButton
                                size="sm"
                                variant={m.answer?.toLowerCase() === "in" ? "default" : "outline"}
                                pendingLabel="Adding"
                                aria-label={`Add ${m.name} to the lineup`}
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
              </div>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
