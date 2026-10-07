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
import { currentUserId, isPlatformAdmin } from "@/lib/auth";
import { visibleClans } from "@/lib/clans";
import { isLeader } from "@/lib/visibility";
import { createClient } from "@/lib/supabase/server";
import { DISPLAY_ZONE } from "@/lib/display-time";
import { AdminNav } from "@/components/admin-nav";
import { EmptyState, Panel } from "@/components/kit";
import { PageHeader } from "@/components/page-header";
import { ScrollText } from "lucide-react";

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

  const [clans, admin] = await Promise.all([
    visibleClans(supabase, userId),
    isPlatformAdmin(supabase, userId),
  ]);
  const leaderOf = clans.filter((c) => isLeader(c.role));

  // Nothing to show, and the reason matters. A co-leader here has not hit a bug.
  if (leaderOf.length === 0) {
    return (
      <main className="mx-auto max-w-page space-y-6 p-4 sm:p-6">
        <PageHeader title="Audit log" />
        <AdminNav current="audit" showFeedback={admin} />
        <Panel>
          <EmptyState
            icon={ScrollText}
            title="Leaders only"
            body="The audit log records who changed what, including entries about co-leaders and members. Only a clan's leader can read it, enforced by the database rather than by this page."
          />
        </Panel>
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
    <main className="mx-auto max-w-page space-y-6 p-4 sm:p-6">
      <PageHeader
        title="Audit log"
        description="Who changed what, and when. Nothing here can be edited or removed — an audit log entries can be taken out of is not one (R4)."
      />
      <AdminNav current="audit" showFeedback={admin} />

      {/* Clan and filter as one kind of chip; they were a row of buttons and a
          row of underlined words for the same job. */}
      {leaderOf.length > 1 && (
        <nav aria-label="Clan" className="cb-scroll-x flex gap-2">
          {leaderOf.map((clan) => (
            <Button
              key={clan.id}
              asChild
              size="xs"
              variant={clan.id === selected.id ? "default" : "outline"}
            >
              <Link href={href({ clan: clan.tag })} aria-current={clan.id === selected.id ? "page" : undefined}>
                {clan.name}
              </Link>
            </Button>
          ))}
        </nav>
      )}

      {entities.length > 1 && (
        <nav aria-label="Filter by what changed" className="cb-scroll-x flex items-center gap-2">
          <span className="text-muted-foreground shrink-0 text-sm">Show</span>
          <Button asChild size="xs" variant={entity ? "outline" : "default"}>
            <Link href={href({})}>everything</Link>
          </Button>
          {entities.map((name) => (
            <Button key={name} asChild size="xs" variant={entity === name ? "default" : "outline"}>
              <Link href={href({ entity: name })}>{name.replace(/_/g, " ")}</Link>
            </Button>
          ))}
        </nav>
      )}

      {entries.length === 0 ? (
        <section className="cb-panel space-y-2 rounded-panel border p-5">
          <h2 className="text-lg font-semibold">Nothing recorded yet</h2>
          <p className="text-muted-foreground text-sm">
            {entity
              ? `No ${entity.replace(/_/g, " ")} changes in ${selected.name}.`
              : `No changes recorded for ${selected.name} yet. Entries appear here ` +
                `when someone approves an account, posts an announcement, or makes ` +
                `any other recorded change.`}
          </p>
        </section>
      ) : (
        <section className="cb-panel rounded-panel border">
          <div className="overflow-x-auto max-sm:p-3">
            <Table className="cb-stack">
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
                    <TableCell data-cell="row" data-label="When" className="text-muted-foreground text-sm whitespace-nowrap">
                      {when(entry.createdAt)}
                    </TableCell>
                    <TableCell data-cell="row" data-label="Who" className="text-sm">
                      {/* An id that does not resolve is a user this leader may
                          not see. "A user" is the honest answer; a bare uuid
                          would be noise, and inventing a name would be a lie. */}
                      {entry.userId ? (actors.get(entry.userId) ?? "a user") : "the system"}
                    </TableCell>
                    <TableCell data-cell="wide" data-label="What" className="text-sm">
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
        recorded here — they act for no user, and their history is on the
        Overview tab.
      </p>
    </main>
  );
}
