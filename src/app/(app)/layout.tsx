// T3.6 — Authenticated shell and clan switcher.
// T3.8 — Approval gate.
//
// Every page under (app) passes through here, which makes it the right place for
// the gate: a page added in a hurry at midnight inherits it without anyone
// remembering to add a check.
//
// It is not the only thing standing there. RLS denies an unapproved user
// everything anyway, because they have no clan_roles row and auth_clan_ids() is
// therefore empty. This layout exists to turn that silent emptiness into an
// explanation the member can act on.
//
// R3 — the switcher is built from the user's own clan_roles via visibleClans(),
// never from a hardcoded list of three clans. Hardcoding it is precisely how a
// leader of clan A is handed a working link into clan B (T3.7).

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { accountStatus, currentUserId, isPlatformAdmin } from "@/lib/auth";
import { visibleClans } from "@/lib/clans";
import { isGateExempt } from "@/lib/gate";
import { PATHNAME_HEADER } from "@/lib/supabase/middleware";

// The exempt list and its reasoning live in lib/gate.ts, so they can be tested
// without rendering this layout. Its absence of "/admin" was a bootstrap
// deadlock that no test caught.

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();

  const userId = await currentUserId(supabase);
  // The middleware already turned away anonymous requests, so arriving here
  // without a user means the session expired mid-flight. Send them back rather
  // than render an empty shell.
  if (!userId) redirect("/login");

  const pathname = (await headers()).get(PATHNAME_HEADER) ?? "";
  const exempt = isGateExempt(pathname);

  const status = await accountStatus(supabase, userId);
  const approved = status === "approved";

  if (!approved && !exempt) redirect("/pending");

  // Not fetched at all while unapproved: there is nothing to show, and asking
  // would just be two queries returning nothing on every /pending render.
  const clans = approved ? await visibleClans(supabase, userId) : [];
  const admin = approved && (await isPlatformAdmin(supabase, userId));
  const showAdminLink = admin || clans.some((c) => c.role === "leader");

  return (
    <div className="min-h-screen">
      <header className="border-b">
        <nav className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-2 p-4">
          <Link href="/" className="font-semibold">
            ClanBridge
          </Link>

          {clans.length > 0 && (
            <div className="flex flex-wrap items-center gap-1">
              {clans.map((clan) => (
                <Link
                  key={clan.id}
                  href={`/${encodeURIComponent(clan.tag)}`}
                  className="hover:bg-accent rounded-md px-2 py-1 text-sm"
                  title={`${clan.name} — you are ${clan.role}`}
                >
                  {clan.name}
                </Link>
              ))}
            </div>
          )}

          <div className="ml-auto flex items-center gap-3 text-sm">
            {/* Cross-clan, so it lives here rather than under a clan tag: a CWL
                season is picked across every clan a leader runs (T4B.7). */}
            {clans.some((c) => c.role === "leader" || c.role === "co-leader") && (
              <Link href="/roster" className="hover:underline">
                Rosters
              </Link>
            )}
            {showAdminLink && (
              <Link href="/admin" className="hover:underline">
                Admin
              </Link>
            )}
            <Link href="/guide" className="hover:underline">
              Help
            </Link>
          </div>
        </nav>
      </header>

      {children}
    </div>
  );
}
