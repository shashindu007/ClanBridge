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
import { latestSnapshots, membersForClan, recentSnapshots } from "@/repositories/members";
import { latestRun } from "@/repositories/sync-log";
import { freshness } from "@/services/freshness";
import { LOW_RATIO_THRESHOLD, memberActivity } from "@/services/members";

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

      {rows.length === 0 ? (
        <section className="space-y-3 rounded-lg border p-6">
          <h2 className="font-medium">No members recorded yet</h2>
          <p className="text-muted-foreground text-sm">
            The member list arrives with <code className="text-xs">sync:clans</code>,
            which runs hourly. If this is still empty after that, the job is not
            running — check <Link className="underline" href="/admin">/admin</Link>.
          </p>
        </section>
      ) : (
        <section className="rounded-lg border">
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

      <section className="text-muted-foreground space-y-2 rounded-lg border border-dashed p-6 text-sm">
        <p>
          <strong className="text-foreground">Ratio</strong> is given ÷ received
          for the current season, shown in red below {LOW_RATIO_THRESHOLD}. It is
          blank for anyone who has received nothing — that is an undefined ratio,
          not a perfect one.
        </p>
        <p>
          <strong className="text-foreground">Last seen</strong> is the last time
          this member&rsquo;s donations or trophies changed, which is a floor
          rather than a login time: someone who plays daily without donating or
          moving trophies looks idle. It reaches back{" "}
          {coveredDays > 0 ? `${coveredDays} days` : "as far as the snapshots go"};
          older activity shows as a bound, not a date. Advisory only — never a
          reason on its own to remove anyone (T3B.5).
        </p>
      </section>
    </main>
  );
}
