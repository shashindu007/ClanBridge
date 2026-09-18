// T3B.6 / T12.1 — family-wide member search.
//
// Outside [clanTag] because it spans clans: somebody remembers a name but not
// which clan that person is in, which is the whole reason this exists.
//
// R3 — SPANNING CLANS IS STILL NOT THE SAME AS NOT FILTERING BY CLAN, and that
// rule is unchanged. What changed in T12.1 is the LIST: the clan ids now come
// from familyClans() rather than visibleClans(), so the search covers every
// platform clan instead of only the ones the caller holds a role in.
//
// The widening lives in 038's definer function, not in a policy. `players` keeps
// its clan-scoped SELECT policy, so this page cannot read another clan's roster
// by querying the table — it has to ask family_clan_roster(), which returns six
// columns and refuses anyone holding no clan role at all.
//
// searchPlayers() in repositories/members.ts is NOT deleted. It is still the
// right function for a clan-scoped search under a session that holds the role,
// it is tested, and replacing a tested thing to avoid two spellings would have
// been the wrong trade.
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
import { clanRoles, currentUserId } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { familyClanRoster, familyClans } from "@/repositories/family";

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

  // Every platform clan, and the caller's role in each — null for most of them.
  // Still the only source of truth for what may be searched: a hardcoded list of
  // tags here is exactly how somebody ends up holding a working search across a
  // clan the database would have refused (T3.7).
  const [clans, roles] = await Promise.all([
    familyClans(supabase),
    clanRoles(supabase, userId),
  ]);
  const byId = new Map(clans.map((c) => [c.id, c]));

  // Departed players included, as before — the footnote says so, and R4 means
  // their rows never went anywhere.
  const hits = term
    ? await familyClanRoster(
        supabase,
        clans.map((c) => c.id),
        term,
        true,
      )
    : [];

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-4 sm:p-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Search members</h1>
        <p className="text-muted-foreground text-sm">
          Across {clans.length === 1 ? "the family's clan" : `all ${clans.length} clans in the family`}.
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
            Nobody in the family matches that. If you are searching a tag, check
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
                  // No `!`. The two reads are separate, so a clan soft-deleted
                  // between them would leave a hit with nowhere to point — rare,
                  // and a dropped row is a better answer than a crash.
                  const clan = byId.get(hit.clanId);
                  if (!clan) return null;

                  // WHERE THE NAME LINKS DEPENDS ON WHETHER YOU ARE IN THAT CLAN.
                  // player/[tag] still resolves through requireClanByTag, so for
                  // a clan the caller holds no role in it would 404 — a search
                  // result that punishes you for clicking it. Those land on the
                  // clan's roster with the tag already searched, which is the
                  // most a visitor is allowed to see of that person anyway.
                  const clanHref = `/${encodeURIComponent(clan.tag)}`;
                  const inClan = roles.has(hit.clanId);
                  const nameHref = inClan
                    ? `${clanHref}/player/${encodeURIComponent(hit.tag)}`
                    : `${clanHref}/members?q=${encodeURIComponent(hit.tag)}`;

                  return (
                    <TableRow key={hit.playerId}>
                      <TableCell className="font-medium">
                        <Link className="underline-offset-2 hover:underline" href={nameHref}>
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
                        <Link className="underline-offset-2 hover:underline" href={clanHref}>
                          {clan.name}
                        </Link>
                        {!inClan && (
                          <span className="text-muted-foreground ml-2 text-xs">visiting</span>
                        )}
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
