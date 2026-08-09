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
// choosing the war size." The poll machinery is Phase 4B's and already handles
// war_availability end to end — 010's CHECK, PollType, POLL_TEMPLATES, and the
// form at /[clanTag]/polls/new. What was missing is the count appearing WHERE
// THE SIZE IS CHOSEN. A count on the polls page and a size box on this one is
// two tabs and a memory test, and the leader will guess rather than switch.
//
// A DRAFT IS INVISIBLE TO MEMBERS, and the policy in 024 enforces that, not this
// page. A draft is the leader thinking out loud with people on it who will be
// cut; showing it causes exactly the arguments publishing exists to prevent. If
// a member somehow reached this file's leadership branch, the rows would still
// not be there.
// ─────────────────────────────────────────────────────────────────────────────
//
// Saved on every click. There is no save button because there is nothing to
// lose — the same argument roster/[season]/page.tsx makes: a leader will not
// finish in one sitting, and a form that loses an hour of cross-referencing to a
// closed tab is a form nobody uses twice.

import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { currentUserId } from "@/lib/auth";
import { requireClanByTag } from "@/lib/clans";
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
} from "@/repositories/war";
import { openWarAvailabilityPoll, optionShare } from "@/services/polls";

export const dynamic = "force-dynamic";

/** 5v5 to 50v50, the sizes the game actually offers. 024's CHECK allows 5–50. */
const WAR_SIZES = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50];

function isLeadership(role: string): boolean {
  return role === "leader" || role === "co-leader";
}

function when(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

async function mutate(formData: FormData) {
  "use server";

  const supabase = await createClient();
  const userId = await currentUserId(supabase);
  if (!userId) redirect("/login");

  const clanTag = String(formData.get("clanTag") ?? "");
  const clanId = String(formData.get("clanId") ?? "");
  const action = String(formData.get("action") ?? "");
  const lineupId = String(formData.get("lineupId") ?? "");
  const playerId = String(formData.get("playerId") ?? "");
  const here = `/${encodeURIComponent(clanTag)}/war/lineup`;

  let result: { error?: string } = {};

  if (action === "create") {
    const size = Number(formData.get("size") ?? 15);
    const created = await createLineup(supabase, clanId, size, userId);
    result = "error" in created ? { error: created.error } : {};
  } else if (action === "add") {
    result = await addToLineup(supabase, lineupId, playerId, userId);
  } else if (action === "remove") {
    result = await removeFromLineup(supabase, lineupId, playerId);
  } else if (action === "publish") {
    result = await publishLineup(supabase, lineupId);
  } else if (action === "unpublish") {
    result = await unpublishLineup(supabase, lineupId);
  } else if (action === "attach") {
    // T6.10 needs this link and cannot be computed without it: until somebody
    // says "this plan was for that war", the plan and the outcome are two
    // unrelated lists.
    result = await attachLineupToWar(supabase, lineupId, String(formData.get("warId") ?? ""));
  } else {
    redirect(`${here}?error=unknown-action`);
  }

  if (result.error) redirect(`${here}?error=${encodeURIComponent(result.error)}`);

  revalidatePath(here);
  redirect(lineupId ? `${here}?lineup=${encodeURIComponent(lineupId)}` : here);
}

export default async function WarLineupPage({
  params,
  searchParams,
}: {
  params: Promise<{ clanTag: string }>;
  searchParams: Promise<{ lineup?: string; error?: string }>;
}) {
  const { clanTag } = await params;
  const { lineup: requested, error } = await searchParams;
  const supabase = await createClient();

  const clan = await requireClanByTag(supabase, clanTag);
  const userId = await currentUserId(supabase);
  if (!userId) redirect("/login");

  const base = `/${encodeURIComponent(clan.tag)}`;
  const leadership = isLeadership(clan.role);

  // RLS returns drafts to leadership and published ones to everybody, so this
  // one call serves both views (024).
  const lineups = await lineupsForClan(supabase, clan.id);
  const selected = requested
    ? await lineupById(supabase, clan.id, requested)
    : (lineups[0] ?? null);
  const picked = selected ? await membersOfLineup(supabase, selected.id) : [];

  // ── T6.7 — the availability count, here because here is where size is chosen
  //
  // OPEN polls only. pollsForClan filters on deleted_at alone, so the newest
  // war_availability poll is usually last war's, closed days ago — and every
  // number below it (the "in" count, the largest supported size, the default on
  // the size selector) would then be describing a war that already happened.
  const polls = await pollsForClan(supabase, clan.id);
  const availabilityPoll = openWarAvailabilityPoll(polls);
  const counts = availabilityPoll ? await countsForPoll(supabase, availabilityPoll.id) : [];
  const shares = optionShare(counts);
  const inCount = counts.find((c) => c.label.toLowerCase() === "in")?.votes ?? 0;

  // ── Member view: the published lineup, and nothing else ──────────────────
  if (!leadership) {
    const published = lineups.find((l) => l.status === "published") ?? null;
    const publishedMembers = published ? await membersOfLineup(supabase, published.id) : [];

    return (
      <main className="mx-auto max-w-3xl space-y-6 p-8">
        <LineupHeader clanName={clan.name} base={base} />

        {availabilityPoll && (
          <Alert>
            <AlertTitle>War availability poll is open</AlertTitle>
            <AlertDescription>
              Answer it and your leader knows whether to declare a 15 or a 30.{" "}
              <Link
                className="underline"
                href={`${base}/polls/${encodeURIComponent(availabilityPoll.id)}`}
              >
                Answer now
              </Link>
            </AlertDescription>
          </Alert>
        )}

        {!published ? (
          <section className="space-y-3 rounded-lg border p-6">
            <h2 className="font-medium">Nothing published yet</h2>
            {/* Honest about WHY it is empty. A leader mid-decision has a draft
                this page genuinely cannot see, and "there is no lineup" would
                be the wrong thing to tell a member who then asks about it. */}
            <p className="text-muted-foreground text-sm">
              The lineup appears here once your leader publishes it. If they are
              still deciding, it is deliberately not visible yet.
            </p>
          </section>
        ) : (
          <section className="space-y-4 rounded-lg border p-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-medium">
                Selected{" "}
                <span className="text-muted-foreground font-normal tabular-nums">
                  ({publishedMembers.length} of {published.size})
                </span>
              </h2>
              {published.publishedAt && (
                <Badge variant="secondary">published {when(published.publishedAt)}</Badge>
              )}
            </div>

            {publishedMembers.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                The lineup was published with nobody on it. That is almost certainly
                a mistake — ask your leader.
              </p>
            ) : (
              <ul className="divide-y">
                {publishedMembers.map((m, index) => (
                  <li key={m.playerId} className="flex items-center gap-4 py-3">
                    <span className="text-muted-foreground w-6 text-sm tabular-nums">
                      {index + 1}
                    </span>
                    <Link
                      className="min-w-0 flex-1 underline-offset-2 hover:underline"
                      href={`${base}/player/${encodeURIComponent(m.tag)}`}
                    >
                      {m.name}
                    </Link>
                    <span className="text-muted-foreground text-sm tabular-nums">
                      TH{m.thLevel ?? "—"}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            <p className="text-muted-foreground text-xs">
              If you are on this list you are expected to use both attacks. If you
              cannot, say so now rather than in the last hour.
            </p>
          </section>
        )}
      </main>
    );
  }

  // ── Leadership view ───────────────────────────────────────────────────────
  const roster = await membersForClan(supabase, clan.id);
  const answers = availabilityPoll
    ? await responsesForPoll(supabase, availabilityPoll.id)
    : [];
  const answerByPlayer = new Map(answers.map((a) => [a.playerId, a]));
  const optionLabel = new Map(counts.map((c) => [c.optionId, c.label]));

  const pickedIds = new Set(picked.map((m) => m.playerId));
  const war = await currentWar(supabase, clan.id);

  const pool = roster
    .filter((m) => !pickedIds.has(m.playerId))
    .map((m) => {
      const answer = answerByPlayer.get(m.playerId);
      return {
        ...m,
        answer: answer ? (optionLabel.get(answer.optionId) ?? null) : null,
        note: answer?.note ?? null,
      };
    })
    // In first, then unanswered, then Out — the order a leader works down.
    // Within a band the highest Town Hall first.
    .sort(
      (a, b) =>
        (a.answer === "In" ? 0 : a.answer === null ? 1 : 2) -
          (b.answer === "In" ? 0 : b.answer === null ? 1 : 2) ||
        (b.thLevel ?? 0) - (a.thLevel ?? 0) ||
        a.name.localeCompare(b.name),
    );

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-8">
      <LineupHeader clanName={clan.name} base={base} />

      {error && (
        <Alert variant="destructive">
          <AlertTitle>That did not work</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* ── T6.7 — the count, beside the size box, on purpose ───────────── */}
      <section className="space-y-3 rounded-lg border p-6">
        <h2 className="font-medium">Who said they are in</h2>

        {!availabilityPoll ? (
          <>
            <p className="text-muted-foreground text-sm">
              No war availability poll is open. You can still pick a lineup, but you
              are picking blind — and the size you declare in game cannot be changed
              once matchmaking starts.
            </p>
            <Button asChild size="sm" variant="outline">
              <Link href={`${base}/polls/new?type=war_availability`}>
                Open a war availability poll
              </Link>
            </Button>
          </>
        ) : (
          <>
            <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
              <p className="text-2xl font-semibold tabular-nums">{inCount} in</p>
              {shares.map((s) => (
                <p key={s.optionId} className="text-muted-foreground text-sm tabular-nums">
                  {s.label} {s.votes} ({s.share}%)
                </p>
              ))}
            </div>
            <p className="text-muted-foreground text-xs">
              {inCount >= 5
                ? `Largest war these answers support: ${
                    WAR_SIZES.filter((s) => s <= inCount).at(-1) ?? 5
                  }v${WAR_SIZES.filter((s) => s <= inCount).at(-1) ?? 5}.`
                : "Not enough answers yet for even a 5v5. Chase the poll before declaring."}{" "}
              <Link
                className="underline"
                href={`${base}/polls/${encodeURIComponent(availabilityPoll.id)}`}
              >
                See who has not answered
              </Link>
            </p>
          </>
        )}
      </section>

      {/* ── T6.8 — the lineup ───────────────────────────────────────────── */}
      {!selected ? (
        <section className="space-y-3 rounded-lg border p-6">
          <h2 className="font-medium">No lineup started</h2>
          <p className="text-muted-foreground text-sm">
            Start one and it saves as you go. Nobody sees it until you publish.
          </p>
          <form action={mutate} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="clanTag" value={clan.tag} />
            <input type="hidden" name="clanId" value={clan.id} />
            <input type="hidden" name="action" value="create" />
            <label className="text-sm">
              <span className="text-muted-foreground block text-xs">War size</span>
              <select
                name="size"
                className="border-input bg-background h-9 rounded-md border px-2 text-sm"
                defaultValue={WAR_SIZES.filter((s) => s <= Math.max(inCount, 5)).at(-1) ?? 15}
              >
                {WAR_SIZES.map((s) => (
                  <option key={s} value={s}>
                    {s}v{s}
                  </option>
                ))}
              </select>
            </label>
            <Button type="submit" size="sm">
              Start a lineup
            </Button>
          </form>
        </section>
      ) : (
        <>
          <section className="space-y-4 rounded-lg border p-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-medium">
                Picked{" "}
                <span className="text-muted-foreground font-normal tabular-nums">
                  ({picked.length} of {selected.size})
                </span>
              </h2>
              <div className="flex items-center gap-2">
                <Badge variant={selected.status === "published" ? "default" : "outline"}>
                  {selected.status}
                </Badge>
                <form action={mutate}>
                  <input type="hidden" name="clanTag" value={clan.tag} />
                  <input type="hidden" name="clanId" value={clan.id} />
                  <input type="hidden" name="lineupId" value={selected.id} />
                  <input
                    type="hidden"
                    name="action"
                    value={selected.status === "published" ? "unpublish" : "publish"}
                  />
                  <Button
                    type="submit"
                    size="sm"
                    variant={selected.status === "published" ? "outline" : "default"}
                    disabled={selected.status !== "published" && picked.length === 0}
                  >
                    {selected.status === "published" ? "Back to draft" : "Publish to members"}
                  </Button>
                </form>
              </div>
            </div>

            {picked.length === 0 ? (
              <p className="text-muted-foreground text-sm">Nobody picked yet.</p>
            ) : (
              <ul className="divide-y">
                {picked.map((m, index) => (
                  <li key={m.playerId} className="flex items-center gap-3 py-2">
                    <span className="text-muted-foreground w-6 text-sm tabular-nums">
                      {index + 1}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm">{m.name}</span>
                    <span className="text-muted-foreground text-xs tabular-nums">
                      TH{m.thLevel ?? "—"}
                    </span>
                    <form action={mutate}>
                      <input type="hidden" name="clanTag" value={clan.tag} />
                      <input type="hidden" name="clanId" value={clan.id} />
                      <input type="hidden" name="action" value="remove" />
                      <input type="hidden" name="lineupId" value={selected.id} />
                      <input type="hidden" name="playerId" value={m.playerId} />
                      <Button type="submit" size="xs" variant="ghost">
                        Drop
                      </Button>
                    </form>
                  </li>
                ))}
              </ul>
            )}

            {picked.length > selected.size && (
              <p className="text-destructive text-xs">
                {picked.length - selected.size} over the war size. The extras will not
                be in the war, and the report will show them as picked-but-absent.
              </p>
            )}

            {/* T6.10's prerequisite. Offered here rather than automatically,
                because only a human knows which war a plan was made for — the
                lineup exists before the war does, which is the whole reason 024
                does not tie them together. */}
            {war && !selected.warId && selected.status === "published" && (
              <form action={mutate} className="flex flex-wrap items-center gap-2 border-t pt-4">
                <input type="hidden" name="clanTag" value={clan.tag} />
                <input type="hidden" name="clanId" value={clan.id} />
                <input type="hidden" name="action" value="attach" />
                <input type="hidden" name="lineupId" value={selected.id} />
                <input type="hidden" name="warId" value={war.id} />
                <span className="text-muted-foreground text-sm">
                  Was this lineup for the war against {war.opponentName ?? "the current opponent"}?
                </span>
                <Button type="submit" size="xs" variant="outline">
                  Link it
                </Button>
              </form>
            )}

            {selected.warId && (
              <p className="text-muted-foreground border-t pt-4 text-xs">
                Linked to a war —{" "}
                <Link
                  className="underline"
                  href={`${base}/war/report?war=${encodeURIComponent(selected.warId)}`}
                >
                  see picked versus played
                </Link>
              </p>
            )}
          </section>

          {/* ── The pool ─────────────────────────────────────────────────── */}
          <section className="space-y-4 rounded-lg border p-6">
            <h2 className="font-medium">
              Available{" "}
              <span className="text-muted-foreground font-normal tabular-nums">
                ({pool.length})
              </span>
            </h2>

            {pool.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                Everybody in the clan is already on this lineup.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-muted-foreground border-b text-left">
                    <tr>
                      <th className="py-2 pr-3 font-medium">Member</th>
                      <th className="py-2 pr-3 text-right font-medium">TH</th>
                      <th className="py-2 pr-3 font-medium">Said</th>
                      <th className="py-2 font-medium"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {pool.map((m) => (
                      <tr key={m.playerId} className="border-b last:border-0">
                        <td className="py-2 pr-3">
                          <span className="font-medium">{m.name}</span>
                          {m.note && (
                            <span className="text-muted-foreground block text-xs">
                              {m.note}
                            </span>
                          )}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums">
                          {m.thLevel ?? "—"}
                        </td>
                        <td className="py-2 pr-3">
                          {m.answer === null ? (
                            <span className="text-muted-foreground">no answer</span>
                          ) : (
                            <Badge
                              variant={
                                m.answer === "In"
                                  ? "default"
                                  : m.answer === "Out"
                                    ? "destructive"
                                    : "secondary"
                              }
                            >
                              {m.answer}
                            </Badge>
                          )}
                        </td>
                        <td className="py-2">
                          <form action={mutate}>
                            <input type="hidden" name="clanTag" value={clan.tag} />
                            <input type="hidden" name="clanId" value={clan.id} />
                            <input type="hidden" name="action" value="add" />
                            <input type="hidden" name="lineupId" value={selected.id} />
                            <input type="hidden" name="playerId" value={m.playerId} />
                            <Button type="submit" size="xs" variant="outline">
                              Pick
                            </Button>
                          </form>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}

      {lineups.length > 1 && (
        <nav className="flex flex-wrap gap-2">
          {lineups.map((l) => (
            <Button
              key={l.id}
              asChild
              size="xs"
              variant={l.id === selected?.id ? "default" : "outline"}
            >
              <Link href={`${base}/war/lineup?lineup=${encodeURIComponent(l.id)}`}>
                {when(l.plannedFor)} · {l.size}v{l.size}
              </Link>
            </Button>
          ))}
        </nav>
      )}
    </main>
  );
}

function LineupHeader({ clanName, base }: { clanName: string; base: string }) {
  return (
    <div className="space-y-2">
      <h1 className="text-2xl font-semibold tracking-tight">War lineup</h1>
      <p className="text-muted-foreground text-sm">
        {clanName} ·{" "}
        <Link className="underline" href={`${base}/war`}>
          war board
        </Link>{" "}
        ·{" "}
        <Link className="underline" href={`${base}/war/history`}>
          history
        </Link>
      </p>
    </div>
  );
}
