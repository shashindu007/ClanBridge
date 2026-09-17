// T3B.6 — cross-clan member search.
//
// Outside [clanTag] because it spans clans: a leader remembers a name but not
// which of the three that person is in, which is the whole reason this exists.
//
// R3 — AND THIS IS THE PAGE THAT GETS IT WRONG. Spanning clans is not the same
// as not filtering by clan. The search runs one query per clan the caller may
// see, built from visibleClans(); it never queries players unscoped and leans on
// RLS to sort it out. test/authorisation.test.ts asserts the net underneath
// holds anyway, because both are meant to be true.
//
// The form is a GET, so a search is a URL. No client JavaScript, and a leader
// can paste the result to someone.

import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { currentUserId } from "@/lib/auth";
import { visibleClans } from "@/lib/clans";
import { createClient } from "@/lib/supabase/server";
import { searchPlayers } from "@/repositories/members";

export const dynamic = "force-dynamic";

export default async function CrossClanSearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const term = (q ?? "").trim();

  const supabase = await createClient();
  const userId = await currentUserId(supabase);
  if (!userId) redirect("/login");

  // The only source of truth for which clans this user may search. A hardcoded
  // list of three tags here is exactly how a leader of clan A ends up holding a
  // working search across clan B (T3.7).
  const clans = await visibleClans(supabase, userId);
  const byId = new Map(clans.map((c) => [c.id, c]));

  const hits = term
    ? await searchPlayers(
        supabase,
        clans.map((c) => c.id),
        term,
      )
    : [];

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-4 sm:p-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Search members</h1>
        <p className="text-muted-foreground text-sm">
          Across {clans.length === 1 ? "your clan" : `all ${clans.length} of your clans`}.
          Search a name, or paste a full tag beginning with #.
        </p>
      </div>

      <form className="flex flex-wrap gap-2" action="/search" method="get">
        <Input
          name="q"
          defaultValue={term}
          placeholder="Name or #TAG"
          aria-label="Name or tag"
          className="max-w-xs"
        />
        <Button type="submit">Search</Button>
      </form>

      {!term ? (
        <p className="text-muted-foreground text-sm">
          Type a name to begin. Partial names work; tags have to be exact, because
          a partial tag is not a meaningful query.
        </p>
      ) : hits.length === 0 ? (
        <section className="cb-panel space-y-2 rounded-lg border p-6">
          <h2 className="font-medium">No match for &ldquo;{term}&rdquo;</h2>
          <p className="text-muted-foreground text-sm">
            Nobody in your clans matches that. If you are searching a tag, check
            it is exact and remember tags never contain the letter O — what looks
            like one is a zero.
          </p>
        </section>
      ) : (
        <section className="rounded-lg border">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Clan</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead className="text-right">TH</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {hits.map((hit) => {
                  const clan = byId.get(hit.clanId)!;
                  return (
                    <TableRow key={hit.playerId}>
                      <TableCell className="font-medium">
                        <Link
                          className="underline-offset-2 hover:underline"
                          href={`/${encodeURIComponent(clan.tag)}/player/${encodeURIComponent(hit.tag)}`}
                        >
                          {hit.name}
                        </Link>
                        {hit.leftAt && (
                          <Badge variant="destructive" className="ml-2 font-normal">
                            left
                          </Badge>
                        )}
                        <span className="text-muted-foreground ml-2 font-mono text-xs">
                          {hit.tag}
                        </span>
                      </TableCell>
                      <TableCell className="text-sm">
                        <Link
                          className="underline-offset-2 hover:underline"
                          href={`/${encodeURIComponent(clan.tag)}`}
                        >
                          {clan.name}
                        </Link>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {hit.clanRole ?? "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {hit.thLevel ?? "—"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </section>
      )}

      <p className="text-muted-foreground text-xs">
        Former members are included, marked. Their history is kept — nothing in
        this system is ever deleted (R4).
      </p>
    </main>
  );
}
