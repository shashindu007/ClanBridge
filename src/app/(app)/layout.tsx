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
import { Menu } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { accountProfile, currentUserId, needsAccountSetup } from "@/lib/auth";
import { clanAccent } from "@/lib/clan-accent";
import { visibleClans } from "@/lib/clans";
import { isGateExempt, isSetupExempt } from "@/lib/gate";
import {
  ClanSectionTabs,
  ClanSwitcher,
  type RailClan,
} from "@/components/clan-nav-rail";
import { SignOutButton } from "@/components/sign-out-button";
import { PATHNAME_HEADER } from "@/lib/request-headers";

// The exempt list and its reasoning live in lib/gate.ts, so they can be tested
// without rendering this layout. Its absence of "/admin" was a bootstrap
// deadlock that no test caught.

// The pathname is still read here, but ONLY for the two redirects below. The
// nav's own active state cannot come from it: a layout is not re-rendered on a
// client-side navigation, so this value is stale from the second page onwards.
// See components/clan-nav-rail.tsx, which subscribes to the router instead.

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

  // T10.9 — the profile and the clan switcher are fetched together.
  //
  // They are independent reads, and they used to run one after the other only
  // because the clans query sat behind the `approved` check below. That saved a
  // query for the rare unapproved member and cost a round trip for every other
  // member on every single navigation — the wrong way round. Now both are in
  // flight at once and an unapproved member simply discards an answer.
  const [profile, allClans] = await Promise.all([
    accountProfile(supabase, userId),
    visibleClans(supabase, userId),
  ]);
  const approved = profile?.status === "approved";

  // T10.5 — setup BEFORE approval, and the order is not arbitrary.
  //
  // Every account that existed before T10 has no username and no password, and
  // a brand-new one is 'pending' by definition. Running the approval gate first
  // would send all of them to /pending, where there is nothing to do and no way
  // to finish setting up — so the Sign in button would never work for anybody
  // and the magic link would remain the only door. Approval is the second
  // question because it is a question about an account that exists; this one is
  // about whether it finished being made.
  //
  // "/account" is in GATE_EXEMPT for the mirror-image reason: without it the
  // approval gate below immediately bounces them back off the setup page.
  if (needsAccountSetup(profile) && !isSetupExempt(pathname)) {
    redirect("/account/setup");
  }

  if (!approved && !isGateExempt(pathname)) redirect("/pending");

  // T10.9 — one query, down from two.
  //
  // This used to be Promise.all([visibleClans, isPlatformAdmin]), issued
  // together rather than in sequence, which was the right fix for the problem as
  // understood then. The better fix is not to ask twice: isPlatformAdmin() read
  // the `users` row that accountProfile() above had already fetched, so the
  // parallel pair was one useful query racing a redundant one.
  //
  // Still not SHOWN while unapproved — a /pending render has no switcher — but
  // the emptying happens here rather than by withholding the query, which is
  // what lets it be issued alongside the profile above.
  const clans = approved ? allClans : [];
  const admin = profile?.isPlatformAdmin === true;

  const showAdminLink = admin || clans.some((c) => c.role === "leader");
  const showLeadershipLinks = clans.some(
    (c) => c.role === "leader" || c.role === "co-leader",
  );

  // Flattened for the rail, which is a Client Component and therefore receives
  // only serialisable values. The accent is resolved HERE rather than there so
  // the "a clan's hue is derived from its id, never looked up" rule stays in one
  // place (R3, lib/clan-accent.ts) instead of being restated on the client.
  const railClans: RailClan[] = clans.map((clan) => ({
    id: clan.id,
    tag: clan.tag,
    name: clan.name,
    role: clan.role,
    color: clanAccent(clan.id).color,
  }));

  // Written once and rendered twice — as a row on a wide screen, and inside the
  // disclosure on a phone. Two copies would be two places to add the next link
  // to, and the one that gets forgotten is the phone.
  const secondaryLinks = (
    <>
      {/* Cross-clan, so it lives here rather than under a clan tag: a CWL
          season is picked across every clan a leader runs (T4B.7). */}
      {showLeadershipLinks && (
        <>
          <Link href="/roster" className="hover:underline">
            Rosters
          </Link>
          {/* T9.1 — objective O3, and it needs a way in. Leadership only: it
              lists every member of every clan with the reasons they were
              flagged, which is a leader's view of the family, not a member's
              view of their own clan. */}
          <Link href="/report" className="hover:underline">
            Participation
          </Link>
        </>
      )}
      {showAdminLink && (
        <Link href="/admin" className="hover:underline">
          Admin
        </Link>
      )}
      <Link href="/settings/notifications" className="hover:underline">
        Notifications
      </Link>
      <Link href="/settings/account" className="hover:underline">
        Account
      </Link>
      <Link href="/guide" className="hover:underline">
        Help
      </Link>
    </>
  );

  return (
    // The root layout owns the page height now (it flexes the footer to the
    // bottom), so a second min-h-screen here would guarantee a scrollbar on
    // every page: a full viewport of shell, plus the footer underneath it.
    <div>
      {/* The rail. A dark wooden beam across the top, which is the one place
          this app's chrome stops being a document and starts being furniture —
          see the decorative block in globals.css for why the depth is bought
          with light and grain rather than with a picture of anything.

          Sticky, because the clan switcher is the control members use most and
          it was previously scrolled off the top of every long roster. z-30 sits
          above page content and below any dialog. */}
      <header className="cb-rail sticky top-0 z-30">
        <nav className="mx-auto flex max-w-5xl items-center gap-x-4 gap-y-2 px-4 py-3">
          <Link
            href="/"
            className="text-wood-ink hover:text-wood-ink flex items-center gap-2 font-semibold tracking-tight"
          >
            {/* The same shield the backdrop tiles, once, at full strength. The
                product had no mark of its own anywhere — the word "ClanBridge"
                in the corner was it. */}
            <svg
              aria-hidden
              viewBox="0 0 132 132"
              className="size-5 shrink-0"
              fill="none"
              stroke="currentColor"
              strokeWidth={7}
              strokeLinejoin="round"
            >
              <path d="M66 20 L98 33 v27 c0 21-15 36-32 45-17-9-32-24-32-45V33z" />
              <path d="M66 33 v59" />
              <path d="M40 47 h52" />
            </svg>
            ClanBridge
          </Link>

          <ClanSwitcher clans={railClans} />

          {/* Nav links on the rail. `[&_a]:` rather than a class on each: there
              are seven of them, they are all the same thing, and the next one
              someone adds should not have to remember six utility classes to
              avoid rendering as dark-blue-on-dark-wood.

              Hidden below `sm`, where the same seven items plus a username used
              to wrap the rail into a four-row block on every page. See the
              disclosure below. */}
          <div className="text-wood-ink-dim ml-auto hidden items-center gap-3 text-sm sm:flex [&_a]:transition-colors [&_a:hover]:text-wood-ink [&_button]:transition-colors [&_button:hover]:text-wood-ink">
            {secondaryLinks}

            {/* T10.3 — who you are, then the way out.

                The identity is not decoration. The bug that prompted all of this
                was a member with two accounts who could not tell which one they
                were signed in as and had no way to change it; a shell that shows
                neither is how "I am on the wrong account" becomes a support
                conversation. Username first because they chose it, email as the
                fallback for the moments before setup has run. */}
            <span
              className="text-wood-ink-muted border-l border-white/15 pl-3"
              title={profile?.email}
            >
              {profile?.username ?? profile?.email ?? ""}
            </span>
            <SignOutButton />
          </div>

          {/* The same links on a phone, behind a disclosure.

              A native <details>, not a dropdown. This app is server-rendered
              throughout, there is no dropdown-menu primitive in components/ui to
              reach for, and a menu built out of useState would be the first
              client component in the shell — hydration on every page for a list
              of six links. <details> opens with no JavaScript at all, is
              keyboard-operable and screen-reader-announced for free, and cannot
              break the way the sign-out form deliberately cannot break.

              It is placed after the switcher in the DOM so tab order still
              reaches the clan pills first, which are what members actually
              use. */}
          <details className="group relative ml-auto shrink-0 sm:hidden">
            <summary
              className="text-wood-ink-dim hover:text-wood-ink flex cursor-pointer list-none items-center gap-1.5 rounded-md px-2 py-1 text-sm transition-colors [&::-webkit-details-marker]:hidden"
              aria-label="Menu"
            >
              <Menu aria-hidden className="size-4" />
              More
            </summary>
            <div className="cb-panel absolute right-0 z-40 mt-2 flex w-56 flex-col gap-1 rounded-lg border p-2 text-sm [&_a]:rounded-md [&_a]:px-2 [&_a]:py-1.5 [&_a:hover]:bg-accent [&_button]:rounded-md [&_button]:px-2 [&_button]:py-1.5 [&_button]:text-left [&_button:hover]:bg-accent">
              {secondaryLinks}
              <span
                className="text-muted-foreground mt-1 border-t px-2 pt-2 text-xs"
                title={profile?.email}
              >
                {profile?.username ?? profile?.email ?? ""}
              </span>
              <SignOutButton />
            </div>
          </details>
        </nav>

        <ClanSectionTabs clans={railClans} />
      </header>

      {children}
    </div>
  );
}
