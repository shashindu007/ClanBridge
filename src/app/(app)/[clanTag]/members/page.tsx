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
import { requireClanByTag } from "@/lib/clans";
import { createClient } from "@/lib/supabase/server";
import { playerSeasonHistory } from "@/repositories/cwl";
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

const SORTS = {
  name: "Name",
  role: "Role",
  th: "TH",
  trophies: "Trophies",
  given: "Given",
  received: "Received",
  ratio: "Ratio",
  activity: "Last seen",
} as const;

type SortKey = keyof typeof SORTS;

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
  searchParams: Promise<{ sort?: string; dir?: string; departed?: string }>;
}) {
  const { clanTag } = await params;
  const query = await searchParams;
  const supabase = await createClient();

  const clan = await requireClanByTag(supabase, clanTag);

  const sort: SortKey = (query.sort as SortKey) in SORTS ? (query.sort as SortKey) : "name";
  const descending = query.dir === "desc";
  const includeDeparted = query.departed === "1";

  const members = await membersForClan(supabase, clan.id, { includeDeparted });
  const [latest, recent, clansRun] = await Promise.all([
    latestSnapshots(supabase, clan.id, members.length),
    recentSnapshots(supabase, clan.id),
    latestRun(supabase, "clans", clan.id),
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

  // T3B.5. CWL participation is per player, so this is one pass over the roster
  // rather than a single query — acceptable at ≤50 members and no worse than the
  // profile page already does. Departed members are excluded from the list even
  // when the toggle shows them in the table: "needs attention" means someone a
  // leader might act on, and someone who has already left is not that.
  const attention = needsAttention(
    await Promise.all(
      rows
        .filter(({ member }) => !member.leftAt)
        .map(async ({ member, activity }) => {
          const seasons = await playerSeasonHistory(supabase, clan.id, member.playerId);
          return {
            playerId: member.playerId,
            name: member.name,
            activity,
            warsRostered: seasons.reduce((n, s) => n + s.warsRostered, 0),
            attacksUsed: seasons.reduce((n, s) => n + s.attacksUsed, 0),
          };
        }),
    ),
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

  const coveredDays = recent.coveredFrom ? daysBetween(recent.coveredFrom, now) : 0;
  const base = `/${encodeURIComponent(clan.tag)}/members`;
  const link = (key: SortKey) => {
    const flip = sort === key && !descending ? "desc" : "asc";
    const departed = includeDeparted ? "&departed=1" : "";
    return `${base}?sort=${key}&dir=${flip}${departed}`;
  };

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-8">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">Members</h1>
          <DataFreshness freshness={freshness(clansRun)} />
        </div>
        <p className="text-muted-foreground text-sm">
          {clan.name} — {rows.length} {includeDeparted ? "including former members" : "current"}
          . Donations are this season&rsquo;s; the game resets them monthly.
        </p>
      </div>

      <div className="flex flex-wrap gap-3 text-sm">
        <Link
          className="underline underline-offset-2"
          href={`${base}?sort=${sort}&dir=${descending ? "desc" : "asc"}${includeDeparted ? "" : "&departed=1"}`}
        >
          {includeDeparted ? "Hide former members" : "Include former members"}
        </Link>
      </div>

      {/* T3B.5 — advisory, and it shows its working. Placed above the table
          because it is the reason a leader opened this page, but deliberately
          worded as a prompt to look rather than a verdict. */}
      {attention.length > 0 && (
        <section className="cb-panel space-y-3 rounded-lg border p-6">
          <h2 className="font-medium">Worth a look — {attention.length}</h2>
          <ul className="space-y-3">
            {attention.map((flag) => {
              const member = rows.find((r) => r.member.playerId === flag.playerId)!.member;
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
        <section className="cb-panel space-y-3 rounded-lg border p-6">
          <h2 className="font-medium">No members recorded yet</h2>
          <p className="text-muted-foreground text-sm">
            The member list arrives with <code className="text-xs">sync:clans</code>,
            which runs hourly. If this is still empty after that, the job is not
            running — check <Link className="underline" href="/admin">/admin</Link>.
          </p>
        </section>
      ) : (
        <section className="cb-panel rounded-lg border">
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
                {rows.map(({ member, activity }) => (
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
      <section className="text-muted-foreground space-y-4 rounded-lg border border-dashed p-6 text-sm">
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
