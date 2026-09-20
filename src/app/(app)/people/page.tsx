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
import { Search, Users } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { currentUserId } from "@/lib/auth";
import { activeMembers, platformPresence } from "@/repositories/notifications";
import { ago } from "@/services/freshness";
import { PageHeader } from "@/components/page-header";
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
    <main className="mx-auto max-w-3xl space-y-6 p-4 sm:p-8">
      <PageHeader
        title="People"
        description="Everyone with an account here, and when they were last around. Times are approximate — presence is recorded once every couple of minutes, not continuously."
      />

      <section className="grid gap-3 sm:grid-cols-3">
        <Tally label="Accounts" value={presence.activeAccounts} hint="across every clan here" />
        <Tally
          label="Online now"
          value={presence.onlineNow}
          hint="active in the last five minutes"
          live={presence.onlineNow > 0}
        />
        <Tally
          label="Waiting"
          value={presence.pendingAccounts}
          hint={presence.pendingAccounts === 0 ? "nobody to let in" : "still need approving"}
        />
      </section>

      {people.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <Users aria-hidden className="text-muted-foreground mx-auto size-6" />
          <p className="mt-2 text-sm font-medium">Nobody to show</p>
          <p className="text-muted-foreground mt-1 text-sm">
            You need a role in a clan before you can see who else is here.
          </p>
        </div>
      ) : (
        <>
          <Group
            title="Here now"
            empty="Nobody has opened the app in the last five minutes."
            people={online}
          />
          {away.length > 0 && <Group title="Away" people={away} />}
        </>
      )}

      {/* The other directory. These are ACCOUNTS — people who signed in; that
          one is VILLAGES, which is who is in the clan in game. They are
          genuinely different lists and a member with no account is in exactly
          one of them. */}
      <div className="rounded-lg border p-4">
        <p className="text-muted-foreground text-sm">
          Looking for someone by their village name or tag instead?
        </p>
        <Button asChild size="sm" variant="outline" className="mt-2">
          <Link href="/search">
            <Search aria-hidden />
            Search the member directory
          </Link>
        </Button>
      </div>
    </main>
  );
}

function Tally({
  label,
  value,
  hint,
  live = false,
}: {
  label: string;
  value: number;
  hint: string;
  live?: boolean;
}) {
  return (
    <div className="cb-panel space-y-1 rounded-lg border p-4">
      <div className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium uppercase">
        {live && <span aria-hidden className="bg-success size-2 shrink-0 rounded-full" />}
        {label}
      </div>
      <p className="text-2xl font-semibold tabular-nums">{value}</p>
      <p className="text-muted-foreground text-xs">{hint}</p>
    </div>
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
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">
        {title}
        <span className="text-muted-foreground ml-2 text-sm font-normal tabular-nums">
          {people.length}
        </span>
      </h2>

      {people.length === 0 ? (
        <p className="text-muted-foreground rounded-md border border-dashed p-4 text-sm">
          {empty}
        </p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {people.map((person) => {
            const name = person.username ?? person.displayName ?? "Someone";

            return (
              <li key={person.id} className="flex flex-wrap items-center gap-3 p-4">
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
      )}
    </section>
  );
}
