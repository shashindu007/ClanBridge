// T3B.2 / T3B.3 — member directory.
//
// This replaces "scroll WhatsApp and guess". Sorting and the departed toggle are
// URL state rather than client state, so the page stays a server component with
// no JavaScript, and a leader can send someone a link to exactly the view they
// are looking at.
//
// R1 — PostgreSQL only. R3 — every query below is filtered by clan, and the
// clan itself was resolved through requireClanByTag().

import Link from "next/link";
import { DataFreshness } from "@/components/data-freshness";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PoolSearch } from "@/components/lineup-parts";
import { requireClanByTag } from "@/lib/clans";
import {
  filterMembers,
  memberSearch,
  parseMemberQuery,
  SORTS,
  type SortKey,
} from "@/lib/members-view";
import { canSeeAttention, isLeader, tierOf } from "@/lib/visibility";
import { createClient } from "@/lib/supabase/server";
import { familyCwlHistory } from "@/repositories/cwl";
import { latestSnapshots, membersForClan, recentSnapshots } from "@/repositories/members";
import { latestRun } from "@/repositories/sync-log";
import { freshness } from "@/services/freshness";
import {
  LOW_RATIO_THRESHOLD,
  memberActivity,
  needsAttention,
  QUIET_DAYS,
} from "@/services/members";

export const dynamic = "force-dynamic";

/** Leader first — the in-game hierarchy, not alphabetical. */
const ROLE_ORDER: Record<string, number> = {
  leader: 0,
  "co-leader": 1,
  elder: 2,
  member: 3,
};

function daysBetween(from: string, to: Date): number {
  return Math.floor((to.getTime() - new Date(from).getTime()) / 86_400_000);
}

export default async function MemberDirectoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ clanTag: string }>;
  searchParams: Promise<{
    sort?: string;
    dir?: string;
    departed?: string;
    q?: string;
  }>;
}) {
  const { clanTag } = await params;
  const query = await searchParams;
  const supabase = await createClient();

  const clan = await requireClanByTag(supabase, clanTag);

  // One allow-list parse, one writer. The page used to read these three inline
  // and rebuild the query string in two other places, each knowing about a
  // different subset — which is exactly how a search term gets dropped by a
  // sort click. See lib/members-view.ts.
  const tier = tierOf(clan.role);
  const q = parseMemberQuery(query, tier);
  const sort: SortKey = q.sort;
  const descending = q.dir === "desc";
  const includeDeparted = q.departed;

  // ── TWO ROUND TRIPS, NOT THREE ────────────────────────────────────────────
  //
  // The reads on this page fall into exactly two layers, and they used to be
  // spread over three.
  //
  // Layer one — everything keyed by the clan alone. Only membersForClan() was
  // here before; recentSnapshots() and latestRun() were queued behind it despite
  // needing nothing from it. A waterfall made of independent work, which is the
  // shape T10.9 removed from the layout and left behind on the pages.
  const [members, recent, clansRun] = await Promise.all([
    membersForClan(supabase, clan.id, { includeDeparted }),
    recentSnapshots(supabase, clan.id),
    latestRun(supabase, "clans", clan.id),
  ]);

  // Layer two — the two reads that genuinely need the member list, and which
  // need nothing from EACH OTHER. latestSnapshots() sizes its row budget from
  // the count; familyCwlHistory() takes the ids. They were sequential, so the
  // page paid two round trips for work that fits in one.
  //
  // T3B.5 — familyCwlHistory is ONE read for the whole directory, and that is
  // load-bearing. It used to be a Promise.all of playerSeasonHistory() per
  // member, reasoned as "acceptable at <= 50 members" — which would have been
  // right if each call were one query. Each was about thirty-one: it walked the
  // clan's entire CWL tree and filtered to one player afterwards, so fifty
  // members were fifteen hundred queries all fetching identical rows.
  //
  // T11C.5 — from every clan in the family, not only this one. A member of this
  // clan who plays CWL in DH CWL ONLY had no CWL here, so their participation
  // read as zero wars and the attention list judged them on nothing.
  const [latest, cwlHistory] = await Promise.all([
    latestSnapshots(supabase, clan.id, members.length),
    familyCwlHistory(
      supabase,
      members.map((m) => m.playerId),
    ),
  ]);

  const now = new Date();
  const rows = members.map((member) => ({
    member,
    activity: memberActivity(
      member.playerId,
      latest.get(member.playerId),
      recent.byPlayer.get(member.playerId) ?? [],
    ),
  }));

  // Departed members are excluded from the attention list even when the toggle
  // shows them in the table: "needs attention" means someone a leader might act
  // on, and someone who has already left is not that.
  const attention = needsAttention(
    rows
      .filter(({ member }) => !member.leftAt)
      .map(({ member, activity }) => {
        const seasons = cwlHistory.get(member.playerId) ?? [];
        return {
          playerId: member.playerId,
          name: member.name,
          activity,
          warsRostered: seasons.reduce((n, s) => n + s.warsRostered, 0),
          attacksUsed: seasons.reduce((n, s) => n + s.attacksUsed, 0),
        };
      }),
    now,
  );

  // Nulls sort last in every column regardless of direction — an unknown value
  // is not "the lowest", and letting it win a "worst ratio" sort would put every
  // never-synced member at the top of the list a leader is about to act on.
  const compare = (
    a: (typeof rows)[number],
    b: (typeof rows)[number],
  ): number => {
    const pick = (r: (typeof rows)[number]): string | number | null => {
      switch (sort) {
        case "role":
          return ROLE_ORDER[r.member.clanRole ?? ""] ?? 99;
        case "th":
          return r.member.thLevel;
        case "trophies":
          return r.activity.trophies;
        case "given":
          return r.activity.donations;
        case "received":
          return r.activity.donationsReceived;
        case "ratio":
          return r.activity.ratio;
        case "activity":
          return r.activity.lastActivityAt;
        default:
          return r.member.name.toLowerCase();
      }
    };

    const left = pick(a);
    const right = pick(b);
    if (left === null && right === null) return a.member.name.localeCompare(b.member.name);
    if (left === null) return 1;
    if (right === null) return -1;

    const order =
      typeof left === "number" && typeof right === "number"
        ? left - right
        : String(left).localeCompare(String(right));

    return descending ? -order : order;
  };

  rows.sort(compare);

  // ── THE SEARCH FILTERS WHAT IS RENDERED, AND NOTHING ELSE ─────────────────
  //
  // Every read above is sized from the UNFILTERED roster and must stay that way.
  // latestSnapshots() budgets its row limit as max(200, memberCount * 4) and its
  // header explains that the window has to contain a complete batch or players
  // silently vanish from the map — so narrowing `members` before that call would
  // shrink the budget and lose people. Filtering here, after the last await,
  // makes that true by construction rather than by remembering.
  //
  // `attention` is likewise computed from the full list: "Worth a look" is
  // advice about the clan, not about the current search, and a leader typing a
  // name should not watch the flags disappear. It is also what keeps the lookup
  // below total — the panel used to do rows.find(...)! against a list that would
  // no longer contain everyone it had flagged.
  const memberById = new Map(rows.map((r) => [r.member.playerId, r.member]));
  const visible = filterMembers(
    rows.map((r) => ({ ...r, name: r.member.name, tag: r.member.tag })),
    q.q,
  );
  const searching = q.q.length > 0;

  const coveredDays = recent.coveredFrom ? daysBetween(recent.coveredFrom, now) : 0;
  const base = `/${encodeURIComponent(clan.tag)}/members`;
  /** Every link on this page goes through memberSearch, so no state is dropped. */
  const link = (key: SortKey) =>
    `${base}${memberSearch(q, {
      sort: key,
      dir: sort === key && !descending ? "desc" : "asc",
    })}`;

  return (
    <main className="mx-auto max-w-page space-y-6 p-4 sm:p-6">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="cb-title text-3xl">Members</h1>
          <DataFreshness freshness={freshness(clansRun)} canAdmin={isLeader(clan.role)} />
        </div>
        <p className="text-muted-foreground text-sm">
          {/* "3 of 47" while searching, so a filtered list never reads as a
              clan that has shrunk. */}
          {clan.name} —{" "}
          {searching
            ? `${visible.length} of ${rows.length} matching “${q.q}”`
            : `${rows.length} ${includeDeparted ? "including former members" : "current"}`}
          . Donations are this season&rsquo;s; the game resets them monthly.
        </p>
      </div>

      {/* The same GET form the roster builder and the war lineup use. No client
          code: a search is a URL, so it can be sent to somebody. `hidden`
          re-emits the sort and the departed toggle, which is what stops the
          form throwing them away — the mirror image of link() above. */}
      <PoolSearch
        action={base}
        hidden={{
          ...(sort !== "name" ? { sort } : {}),
          ...(descending ? { dir: "desc" } : {}),
          ...(includeDeparted ? { departed: "1" } : {}),
        }}
        q={q.q}
        clearHref={searching ? `${base}${memberSearch(q, { q: "" })}` : null}
      />

      <div className="flex flex-wrap gap-3 text-sm">
        <Link
          className="underline underline-offset-2"
          href={`${base}${memberSearch(q, { departed: !includeDeparted })}`}
        >
          {includeDeparted ? "Hide former members" : "Include former members"}
        </Link>
      </div>

      {/* T3B.5 — advisory, and it shows its working. Placed above the table
          because it is the reason a leader opened this page, but deliberately
          worded as a prompt to look rather than a verdict. */}
      {canSeeAttention(clan.role) && attention.length > 0 && (
        <section className="cb-panel space-y-3 rounded-panel border p-5">
          <h2 className="font-medium">Worth a look — {attention.length}</h2>
          <ul className="space-y-3">
            {attention.map((flag) => {
              // From the unfiltered map, and checked rather than asserted. The
              // `!` this replaces threw the moment a search narrowed `rows`
              // below the set these flags were computed from.
              const member = memberById.get(flag.playerId);
              if (!member) return null;
              return (
                <li key={flag.playerId} className="text-sm">
                  <Link
                    className="font-medium underline-offset-2 hover:underline"
                    href={`/${encodeURIComponent(clan.tag)}/player/${encodeURIComponent(member.tag)}`}
                  >
                    {flag.name}
                  </Link>
                  <ul className="text-muted-foreground list-inside list-disc">
                    {flag.reasons.map((reason) => (
                      <li key={reason}>{reason}</li>
                    ))}
                  </ul>
                </li>
              );
            })}
          </ul>
          {/* Worded for a reader who has never used this before. The previous
              version said "every line above is a proxy, not a fact", which is
              exactly right and says nothing to someone who does not already
              know what a proxy measurement is — and the people most likely to
              act on this list are the ones least likely to know. The caveat is
              the important part of the section, so it may not be the part that
              needs a second reading. */}
          <p className="text-muted-foreground text-xs">
            These are hints, not facts. All &ldquo;quiet&rdquo; means is that two
            numbers stopped moving, so someone away on holiday looks exactly the
            same here as someone who has quit. Talk to them before you do
            anything — this app never removes or changes anyone by itself.
          </p>
        </section>
      )}

      {rows.length === 0 ? (
        <section className="cb-panel space-y-3 rounded-panel border p-5">
          <h2 className="font-medium">No members recorded yet</h2>
          <p className="text-muted-foreground text-sm">
            The member list arrives with <code className="text-xs">sync:clans</code>,
            which runs hourly. If this is still empty after that, the job is not
            running — check <Link className="underline" href="/admin">/admin</Link>.
          </p>
        </section>
      ) : visible.length === 0 ? (
        // Its own state. Reusing the one above would tell a member who mistyped
        // a name that the clan has never been synced.
        <section className="cb-panel space-y-3 rounded-panel border p-5">
          <h2 className="font-medium">Nobody matches &ldquo;{q.q}&rdquo;</h2>
          <p className="text-muted-foreground text-sm">
            Part of a name works, and so does part of a tag. Tags never contain
            the letter O — what looks like one is a zero.
            {!includeDeparted && " Somebody who has left the clan is hidden unless you include former members."}
          </p>
          <div className="flex flex-wrap gap-3 text-sm">
            <Link className="underline underline-offset-2" href={`${base}${memberSearch(q, { q: "" })}`}>
              Clear the search
            </Link>
            {!includeDeparted && (
              <Link
                className="underline underline-offset-2"
                href={`${base}${memberSearch(q, { departed: true })}`}
              >
                Search former members too
              </Link>
            )}
          </div>
        </section>
      ) : (
        <section className="cb-panel rounded-panel border">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  {(Object.keys(SORTS) as SortKey[]).map((key) => (
                    <TableHead
                      key={key}
                      className={key === "name" || key === "role" ? "" : "text-right"}
                    >
                      <Link
                        href={link(key)}
                        className="underline-offset-2 hover:underline"
                        aria-label={`Sort by ${SORTS[key]}`}
                      >
                        {SORTS[key]}
                        {sort === key && (descending ? " ↓" : " ↑")}
                      </Link>
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map(({ member, activity }) => (
                  <TableRow key={member.playerId}>
                    <TableCell className="font-medium">
                      <Link
                        className="underline-offset-2 hover:underline"
                        href={`/${encodeURIComponent(clan.tag)}/player/${encodeURIComponent(member.tag)}`}
                      >
                        {member.name}
                      </Link>
                      {member.leftAt && (
                        <Badge variant="destructive" className="ml-2 font-normal">
                          left
                        </Badge>
                      )}
                      <span className="text-muted-foreground ml-2 font-mono text-xs">
                        {member.tag}
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {member.clanRole ?? "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {member.thLevel ?? "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {activity.trophies ?? "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {activity.donations ?? "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {activity.donationsReceived ?? "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {activity.ratio === null ? (
                        "—"
                      ) : (
                        <span className={activity.lowRatio ? "text-destructive" : undefined}>
                          {activity.ratio.toFixed(2)}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-right text-sm">
                      {activity.lastActivityAt
                        ? `${daysBetween(activity.lastActivityAt, now)}d ago`
                        : coveredDays > 0
                          ? `>${coveredDays}d`
                          : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>
      )}

      {/* ── What the two awkward columns actually mean ──────────────────────
          Rewritten in plain words. The previous version was accurate and
          compressed into terms that assume the reader already knows them —
          "a floor rather than a login time", "a bound, not a date", "an
          undefined ratio", and a task ID. Every one of those is a sentence a
          new member has to decode before they can use the table above it, and
          the whole point of this block is to stop the table being misread.

          Nothing in the MEANING changed: last seen is still a lower bound, the
          blank ratio is still undefined rather than perfect, and the list is
          still advisory (T3B.5). Only the wording did. */}
      <section className="text-muted-foreground space-y-4 rounded-panel border border-dashed p-6 text-sm">
        <div className="space-y-1">
          <p className="text-foreground font-medium">What &ldquo;Ratio&rdquo; means</p>
          <p>
            How many troops someone gave for each one they got. 1.0 means they
            gave back exactly what they took; below {LOW_RATIO_THRESHOLD} shows in
            red. It stays blank for anyone who has not received anything yet,
            because there is nothing to divide by — blank is not a perfect score.
          </p>
        </div>

        <div className="space-y-1">
          <p className="text-foreground font-medium">What &ldquo;Last seen&rdquo; means</p>
          <p>
            The last time this member&rsquo;s donations or trophies changed.{" "}
            <strong className="text-foreground">It is not a login time</strong>,
            and this is the part that catches people out: someone who plays every
            single day without donating or moving trophies still looks inactive
            here. Read it as &ldquo;at least this long ago&rdquo;, never as
            &ldquo;exactly then&rdquo;.
          </p>
          <p>
            {coveredDays > 0
              ? `Only the last ${coveredDays} days are kept, so anything older shows as "more than ${coveredDays} days" instead of a date.`
              : "Only recent days are kept, so older activity shows as a rough bound instead of a date."}
          </p>
        </div>

        <div className="space-y-1">
          <p className="text-foreground font-medium">
            What &ldquo;Worth a look&rdquo; means
          </p>
          <p>
            {QUIET_DAYS} days with no change to either of those numbers. It is a
            nudge to go and ask someone how they are getting on — not a verdict,
            and never on its own a reason to remove anyone.
          </p>
        </div>
      </section>
    </main>
  );
}
