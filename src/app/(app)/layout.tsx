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

import { Suspense } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Activity, Bell, ClipboardList } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { accountProfile, currentUserId, needsAccountSetup } from "@/lib/auth";
import { clanAccent } from "@/lib/clan-accent";
import { visibleClans } from "@/lib/clans";
import { isLeader, isLeadership } from "@/lib/visibility";
import { isGateExempt, isSetupExempt } from "@/lib/gate";
import { AccountMenu } from "@/components/account-menu";
import { Toaster } from "@/components/toaster";
import {
  ClanSectionTabs,
  ClanSwitcher,
  type RailClan,
} from "@/components/clan-nav-rail";
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

  const showAdminLink = admin || clans.some((c) => isLeader(c.role));
  const showLeadershipLinks = clans.some((c) => isLeadership(c.role));

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
        <nav className="mx-auto flex max-w-7xl items-center gap-x-4 gap-y-2 px-4 py-3">
          {/* shrink-0 so the brand never compresses, and the wordmark drops
              below `sm` where the space it costs is space the clan switcher
              needs. The shield stays at every width — it is the only mark this
              product has, and a header with no mark at all reads as a page
              rather than an app. */}
          <Link
            href="/"
            className="text-wood-ink hover:text-wood-ink flex shrink-0 items-center gap-2 text-[1.0625rem] font-semibold tracking-tight"
            title="ClanBridge — go to your first clan"
          >
            {/* The same shield the backdrop tiles, once, at full strength. The
                product had no mark of its own anywhere — the word "ClanBridge"
                in the corner was it. */}
            <svg
              aria-hidden
              viewBox="0 0 132 132"
              className="size-5.5 shrink-0"
              fill="none"
              stroke="currentColor"
              strokeWidth={7}
              strokeLinejoin="round"
            >
              <path d="M66 20 L98 33 v27 c0 21-15 36-32 45-17-9-32-24-32-45V33z" />
              <path d="M66 33 v59" />
              <path d="M40 47 h52" />
            </svg>
            <span className="hidden sm:inline">ClanBridge</span>
          </Link>

          <ClanSwitcher clans={railClans} />

          {/* Everything after the clan switcher, aligned as one group.

              ml-auto lives HERE rather than on whichever child happens to come
              first, because that child is conditional: the leadership links are
              leader-only and hidden below md, so putting the margin on them
              left an ordinary member's controls sitting against the clan
              switcher instead of hard right. */}
          <div className="text-wood-ink-dim ml-auto flex shrink-0 items-center gap-1 text-[0.9375rem]">
          {/* ── Leadership destinations ──────────────────────────────────
              Cross-clan, so they live here rather than under a clan tag: a CWL
              season is picked across every clan a leader runs (T4B.7), and
              /report lists every member of every clan with the reasons they
              were flagged — a leader's view of the family, not a member's view
              of their own clan (T9.1, objective O3).

              These two are DESTINATIONS, not settings, which is why they stay
              on the rail rather than going in the account menu with Admin and
              Notifications. They carry icons for the same reason the section
              tabs below do: a row of same-weight words is a row you have to
              read all of.

              Below `md` they collapse into the menu, which always holds the
              complete list — see account-menu.tsx. */}
          {showLeadershipLinks && (
            <div className="text-wood-ink-dim hidden shrink-0 items-center gap-1 md:flex">
              <Link
                href="/roster"
                className="hover:bg-accent hover:text-accent-foreground flex items-center gap-1.5 rounded-md px-2 py-1 transition-colors"
                title="Pick the CWL roster across every clan you run"
              >
                <ClipboardList aria-hidden className="size-4" />
                Rosters
              </Link>
              <Link
                href="/report"
                className="hover:bg-accent hover:text-accent-foreground flex items-center gap-1.5 rounded-md px-2 py-1 transition-colors"
                title="Who across all your clans has stopped turning up"
              >
                <Activity aria-hidden className="size-4" />
                Participation
              </Link>
            </div>
          )}

          {/* ── Notifications, promoted out of the menu ──────────────────
              A member checking whether anything has been posted for them should
              not have to open an account menu to find out. It is the one item
              in that group that is READ rather than configured, and the one a
              member opens repeatedly rather than once.

              Icon-only below `sm`, where the label is the part that costs width
              and the bell is already unambiguous. aria-label carries the name in
              both cases, so the control is never nameless to a screen reader. */}
          <Link
            href="/settings/notifications"
            aria-label="Notifications"
            title="What this app sends you, and on which devices"
            className="text-wood-ink-dim hover:bg-accent hover:text-accent-foreground flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 transition-colors"
          >
            <Bell aria-hidden className="size-4" />
            <span className="hidden sm:inline">Notifications</span>
          </Link>

          {/* T10.3 — who you are, then the way out.

              The identity is not decoration. The bug that prompted all of T10
              was a member with two accounts who could not tell which one they
              were signed in as and had no way to change it; a shell that shows
              neither is how "I am on the wrong account" becomes a support
              conversation.

              `ml-auto` here as well as on the block above, so the menu still
              sits hard right for a member with no leadership links at all. */}
          <div className="shrink-0">
            {/* T11.10 — a BOOLEAN, not a URL. Signing the picture here would add
                a Storage round trip to every navigation, which is the cost T10.9
                spent this phase's predecessor removing from this file. The menu
                points at /account/avatar instead, which the browser caches for
                the life of the signature. */}
            <AccountMenu
              username={profile?.username ?? null}
              email={profile?.email ?? null}
              showAdmin={showAdminLink}
              showLeadership={showLeadershipLinks}
              hasAvatar={Boolean(profile?.avatarPath)}
            />
          </div>
          </div>

        </nav>

        <ClanSectionTabs clans={railClans} />
      </header>

      {children}

      {/* Mounted once for the whole authenticated app. It renders nothing until
          an action redirects with ?ok= or ?error=, but the live region itself
          has to exist beforehand — see the component. */}
      <Suspense fallback={null}>
        <Toaster />
      </Suspense>
    </div>
  );
}
