// T12.4 — who is on ClanBridge, and when they were last around.
//
// The destination behind the two dashboard tiles and the quiet N/M in the rail.
// Those say how many; this says who, which is the half that is actually useful
// — a number tells you somebody is about, not whether it is the co-leader you
// need before a war lineup closes.
//
// EVERY FIELD ON THIS PAGE COMES FROM active_members() (041), which returns six
// columns and no email. That is not a filter applied here: the administrative
// view of a person, which does carry an address, is /admin/members, and it
// answers only to a leader. If this page ever needs more, the thing to widen is
// that function's output — not `users`' RLS policy, which is the rule 038 wrote
// down and 040 followed.
//
// No avatars, deliberately. The bucket is private, so every face is a signed
// URL minted per request, and thirty of them is thirty Storage round trips on
// one page load. T11.10 made this argument about the single avatar in the
// shell. Initials carry the same recognition at a tenth of the cost.

import Link from "next/link";
import { redirect } from "next/navigation";
import { Hourglass, Search, Users } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { currentUserId } from "@/lib/auth";
import { activeMembers, platformPresence } from "@/repositories/notifications";
import { ago } from "@/services/freshness";
import { PageHeader } from "@/components/page-header";
import { Disclosure, EmptyState, FactRow, Panel, SectionHeader } from "@/components/kit";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

/** Two letters, from whatever name this account actually has. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
}

/**
 * "4 minutes ago", or the honest absence of an answer.
 *
 * Null is NOT rendered as "a long time ago". last_seen_at only started being
 * written when presence shipped, so a null means "we have never recorded this
 * person", and a page that guesses at it would be inventing a fact about
 * somebody — which is the same mistake R11 forbids about game data.
 */
function lastSeen(iso: string | null): string {
  if (!iso) return "Not seen since this was added";
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60_000));
  return ago(minutes);
}

export default async function PeoplePage() {
  const supabase = await createClient();

  const userId = await currentUserId(supabase);
  if (!userId) redirect("/login");

  const [presence, people] = await Promise.all([
    platformPresence(supabase),
    activeMembers(supabase),
  ]);

  const online = people.filter((p) => p.isOnline);
  const away = people.filter((p) => !p.isOnline);

  return (
    <main className="mx-auto max-w-narrow space-y-6 p-4 sm:p-6">
      {/* The other directory is one click away, in the header rather than a
          bordered box of its own at the foot of the page. These are ACCOUNTS —
          people who signed in; /search is VILLAGES, who is in the clan in game.
          Genuinely different lists; a member with no account is in only one. */}
      <PageHeader
        title="People"
        description="Everyone with an account here, and when they were last around. Times are approximate — presence is recorded every couple of minutes."
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href="/search">
              <Search aria-hidden />
              Search members by village
            </Link>
          </Button>
        }
      />

      {/* Two facts in a line. They were three framed tiles, and the third —
          "Online now" — is the count on the "Here now" heading just below. */}
      <FactRow
        items={[
          { label: "accounts across every clan", value: presence.activeAccounts, icon: Users },
          {
            label: presence.pendingAccounts === 0 ? "waiting — nobody to let in" : "waiting for approval",
            value: presence.pendingAccounts,
            icon: Hourglass,
          },
        ]}
      />

      {people.length === 0 ? (
        <Panel>
          <EmptyState
            icon={Users}
            title="Nobody to show"
            body="You need a role in a clan before you can see who else is here."
          />
        </Panel>
      ) : (
        <>
          <Group
            title="Here now"
            empty="Nobody has opened the app in the last five minutes."
            people={online}
          />
          {/* Folded when long: "Away" is everyone else on the platform, and at
              eighteen accounts it was most of the page. */}
          {away.length > 0 && (
            <Disclosure title="Away" count={away.length} defaultOpen={away.length <= 8}>
              <PeopleList people={away} />
            </Disclosure>
          )}
        </>
      )}
    </main>
  );
}

function Group({
  title,
  people,
  empty,
}: {
  title: string;
  people: Awaited<ReturnType<typeof activeMembers>>;
  empty?: string;
}) {
  return (
    <Panel className="space-y-3">
      <SectionHeader title={title} count={people.length} />
      {people.length === 0 ? (
        <p className="text-muted-foreground text-sm">{empty}</p>
      ) : (
        <PeopleList people={people} />
      )}
    </Panel>
  );
}

function PeopleList({ people }: { people: Awaited<ReturnType<typeof activeMembers>> }) {
  return (
        <ul className="divide-y">
          {people.map((person) => {
            const name = person.username ?? person.displayName ?? "Someone";

            return (
              <li key={person.id} className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0">
                <span className="bg-muted relative flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold">
                  {initials(name)}
                  {/* The dot sits ON the initials rather than beside the name,
                      so a long list scans down one column instead of needing
                      each row read to find the state. */}
                  {person.isOnline && (
                    <span
                      aria-hidden
                      className="bg-success ring-background absolute -right-0.5 -bottom-0.5 size-3 rounded-full ring-2"
                    />
                  )}
                </span>

                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{name}</p>
                  <p className="text-muted-foreground truncate text-xs">
                    {person.clans.length > 0
                      ? person.clans.map((c) => `${c.clan} — ${c.role}`).join(", ")
                      : "No clan yet"}
                  </p>
                </div>

                <span className="text-muted-foreground shrink-0 text-xs">
                  {person.isOnline ? (
                    <Badge variant="success">Online</Badge>
                  ) : (
                    lastSeen(person.lastSeenAt)
                  )}
                </span>
              </li>
            );
          })}
        </ul>
  );
}
