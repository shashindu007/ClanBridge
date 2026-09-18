// T9.6 — audit log viewer. Leader only.
//
// R4 says every write is recorded. Until this page existed that record was real
// and invisible, which makes the protection it offers theoretical: nobody can
// answer "who removed that announcement" by querying a table they never open.
//
// LEADER ONLY, and enforced by the policy rather than here. 006's "leaders read
// own clan audit log" uses auth_leader_clan_ids(), which excludes co-leaders on
// purpose — the log contains entries about the people who can read it, and a
// co-leader is a subject of it. So a co-leader arriving here sees an empty list
// rather than an error, and the page says why instead of looking broken.
//
// The clan filter is a select, not a route segment, because this page lives
// outside [clanTag] alongside the rest of /admin.

import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { auditActorEmails, auditEntriesForClan, describeAudit } from "@/lib/audit";
import { currentUserId } from "@/lib/auth";
import { visibleClans } from "@/lib/clans";
import { isLeader } from "@/lib/visibility";
import { createClient } from "@/lib/supabase/server";
import { DISPLAY_ZONE } from "@/lib/display-time";

export const dynamic = "force-dynamic";

function when(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: DISPLAY_ZONE,
  });
}

export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<{ clan?: string; entity?: string }>;
}) {
  const query = await searchParams;
  const supabase = await createClient();

  const userId = await currentUserId(supabase);
  if (!userId) redirect("/login");

  const clans = await visibleClans(supabase, userId);
  const leaderOf = clans.filter((c) => isLeader(c.role));

  // Nothing to show, and the reason matters. A co-leader here has not hit a bug.
  if (leaderOf.length === 0) {
    return (
      <main className="mx-auto max-w-7xl space-y-4 p-4 sm:p-8">
        <h1 className="text-2xl font-semibold tracking-tight">Audit log</h1>
        <section className="cb-panel space-y-2 rounded-lg border p-6">
          <h2 className="font-medium">Leaders only</h2>
          <p className="text-muted-foreground text-sm">
            The audit log records who changed what, and that includes entries
            about co-leaders and members. Only a clan&rsquo;s leader can read it,
            enforced by the database rather than by this page.
          </p>
          <Button asChild variant="outline" size="sm">
            <Link href="/admin">Back to admin</Link>
          </Button>
        </section>
      </main>
    );
  }

  const selected = leaderOf.find((c) => c.tag === query.clan) ?? leaderOf[0]!;
  const entity = query.entity?.trim() || undefined;

  const entries = await auditEntriesForClan(supabase, selected.id, { entity });
  const actors = await auditActorEmails(
    supabase,
    entries.map((e) => e.userId),
  );

  const entities = [...new Set(entries.map((e) => e.entity))].sort();
  const href = (params: { clan?: string; entity?: string }) => {
    const q = new URLSearchParams();
    q.set("clan", params.clan ?? selected.tag);
    if (params.entity) q.set("entity", params.entity);
    return `/admin/audit?${q.toString()}`;
  };

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-4 sm:p-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Audit log</h1>
        <p className="text-muted-foreground text-sm">
          Who changed what, and when. Nothing here can be edited or removed — an
          audit log entries can be taken out of is not one (R4).
        </p>
      </div>

      {leaderOf.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {leaderOf.map((clan) => (
            <Button
              key={clan.id}
              asChild
              size="sm"
              variant={clan.id === selected.id ? "default" : "outline"}
            >
              <Link href={href({ clan: clan.tag })}>{clan.name}</Link>
            </Button>
          ))}
        </div>
      )}

      {entities.length > 1 && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">Filter:</span>
          <Link
            href={href({})}
            className={entity ? "underline underline-offset-2" : "font-medium"}
          >
            all
          </Link>
          {entities.map((name) => (
            <Link
              key={name}
              href={href({ entity: name })}
              className={
                entity === name ? "font-medium" : "underline underline-offset-2"
              }
            >
              {name.replace(/_/g, " ")}
            </Link>
          ))}
        </div>
      )}

      {entries.length === 0 ? (
        <section className="cb-panel space-y-2 rounded-lg border p-6">
          <h2 className="font-medium">Nothing recorded yet</h2>
          <p className="text-muted-foreground text-sm">
            {entity
              ? `No ${entity.replace(/_/g, " ")} changes in ${selected.name}.`
              : `No changes recorded for ${selected.name} yet. Entries appear here ` +
                `when someone approves an account, posts an announcement, or makes ` +
                `any other recorded change.`}
          </p>
        </section>
      ) : (
        <section className="rounded-lg border">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Who</TableHead>
                  <TableHead>What</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell className="text-muted-foreground text-sm whitespace-nowrap">
                      {when(entry.createdAt)}
                    </TableCell>
                    <TableCell className="text-sm">
                      {/* An id that does not resolve is a user this leader may
                          not see. "A user" is the honest answer; a bare uuid
                          would be noise, and inventing a name would be a lie. */}
                      {entry.userId ? (actors.get(entry.userId) ?? "a user") : "the system"}
                    </TableCell>
                    <TableCell className="text-sm">
                      {describeAudit(entry)}
                      <Badge variant="outline" className="ml-2 font-normal">
                        {entry.entity.replace(/_/g, " ")}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>
      )}

      <p className="text-muted-foreground text-xs">
        Showing the most recent {entries.length} entr{entries.length === 1 ? "y" : "ies"}
        {entity ? ` for ${entity.replace(/_/g, " ")}` : ""}. Sync jobs are not
        recorded here — they act for no user, and their history is in{" "}
        <Link className="underline" href="/admin">
          sync health
        </Link>
        .
      </p>
    </main>
  );
}
