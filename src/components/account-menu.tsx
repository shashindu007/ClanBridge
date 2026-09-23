"use client";

// The right-hand end of the rail: who you are, and everything you reach rarely.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY A MENU RATHER THAN SIX MORE LINKS
//
// The rail carried twelve targets in a single row — brand, four clan pills,
// Rosters, Participation, Admin, Notifications, Account, Help, a username and
// Sign out — every one of them the same size, the same weight and the same
// colour, with no icon on any of them. Nothing in that row told a member which
// items were related, which were destinations and which were settings, so the
// only way to find anything was to read all twelve.
//
// They are also four unrelated things: which clan am I looking at, where do I
// go as a leader, how is my account set up, and how do I leave. Collapsing the
// last two into one labelled menu is what lets the first two get the room they
// need — and the room was not academic. With four clans the switcher was being
// squeezed until the ACTIVE clan clipped off the edge.
//
// <details> rather than a dropdown library: this app has no dropdown primitive
// in components/ui, and a menu built on useState would hydrate on every page for
// a list of five links. <details> is keyboard-operable and screen-reader
// announced with no JavaScript at all. The handlers in useDetailsMenu are polish on
// top of something that already works without them — which is the same
// reasoning sign-out-button.tsx uses for being a plain form.
// ─────────────────────────────────────────────────────────────────────────────

import Link from "next/link";
import { useRef } from "react";
import { useDetailsMenu } from "@/components/use-details-menu";
import {
  Activity,
  Castle,
  ChevronDown,
  CircleHelp,
  CircleUser,
  ClipboardList,
  KeyRound,
  LogOut,
  ShieldCheck,
  Users,
} from "lucide-react";
import { SignOutButton } from "@/components/sign-out-button";
import { ThemeToggle } from "@/components/theme-toggle";

export interface AccountMenuProps {
  username: string | null;
  email: string | null;
  showAdmin: boolean;
  showLeadership: boolean;
  /**
   * T11.10 — whether to render the picture at all.
   *
   * A boolean rather than a URL, deliberately. The shell must not mint a signed
   * URL on every navigation (see /account/avatar/route.ts), so the src is a fixed
   * path and this only decides whether to ask for it. Asking unconditionally
   * would put a 404 in the console of every member who has not set a picture.
   */
  hasAvatar?: boolean;
}

const ITEM =
  "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[0.9375rem] transition-colors hover:bg-accent hover:text-accent-foreground";

/**
 * One square in the grid of the member's own destinations.
 *
 * Icon above label rather than beside it: at half the menu's width a row would
 * truncate the longer names, and stacking gives the icon room to do the work it
 * is there for. Labels are one word each for the same reason — "Sign-in and
 * password" does not fit a tile, and the page it opens says the rest.
 */
function TileLink({
  href,
  Icon,
  label,
}: {
  href: string;
  Icon: typeof Castle;
  label: string;
}) {
  return (
    <Link
      href={href}
      className="hover:bg-accent hover:text-accent-foreground flex flex-col items-center gap-1.5 rounded-md border px-2 py-3 text-center text-xs transition-colors"
    >
      <Icon aria-hidden className="text-muted-foreground size-4.5" />
      {label}
    </Link>
  );
}

export function AccountMenu({
  username,
  email,
  showAdmin,
  showLeadership,
  hasAvatar = false,
}: AccountMenuProps) {
  const ref = useRef<HTMLDetailsElement>(null);
  // Close on navigation, Escape and click-outside — see the hook.
  useDetailsMenu(ref);

  const label = username ?? email ?? "Account";

  return (
    <details ref={ref} className="group relative shrink-0">
      <summary
        // The control says WHOSE account it is. The bug that started T10 was a
        // member with two accounts who could not tell which one they were signed
        // in as, so the name is the label rather than a generic avatar.
        className="text-wood-ink-dim hover:text-wood-ink flex cursor-pointer list-none items-center gap-1.5 rounded-md px-2 py-1.5 text-[0.9375rem] transition-colors group-open:bg-white/10 group-open:text-wood-ink [&::-webkit-details-marker]:hidden"
        aria-label={`Account and settings for ${label}`}
        title={email ?? undefined}
      >
        {/* T11.10 — the picture goes BESIDE the name, never instead of it. The
            bug that started T10 was a member who could not tell which of two
            accounts they were signed in as, and two accounts belonging to the
            same person tend to carry the same face. So the avatar replaces the
            generic icon and nothing else.

            A raw img: the src is this app's own route, which 302s to a signed
            URL, and next/image cannot optimise a redirect to an expiring URL. */}
        {hasAvatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src="/account/avatar"
            alt=""
            aria-hidden
            className="size-5 shrink-0 rounded-full object-cover"
          />
        ) : (
          <CircleUser aria-hidden className="size-4 shrink-0" />
        )}
        <span className="max-w-[9rem] truncate">{label}</span>
        <ChevronDown
          aria-hidden
          className="size-3.5 shrink-0 transition-transform group-open:rotate-180"
        />
      </summary>

      <div className="cb-panel absolute right-0 z-50 mt-2 flex w-60 flex-col gap-0.5 rounded-lg border p-2 text-left shadow-lg">
        {/* Which account, spelled out. The username is on the control above;
            this is the email behind it, which is the thing that actually
            distinguishes two accounts belonging to the same person. */}
        {email && (
          <p className="text-muted-foreground truncate border-b px-2 pt-1 pb-2 text-xs">
            Signed in as {email}
          </p>
        )}

        {/* Leadership destinations. They are shown on the rail itself from `md`
            up, so these two are the narrow-screen path to the same pages —
            rendered here rather than hidden entirely, so the menu is always the
            COMPLETE list and the rail is a set of shortcuts on top of it. */}
        {showLeadership && (
          <>
            <Link href="/roster" className={`${ITEM} md:hidden`}>
              <ClipboardList aria-hidden className="text-muted-foreground size-4" />
              Rosters
            </Link>
            <Link href="/report" className={`${ITEM} md:hidden`}>
              <Activity aria-hidden className="text-muted-foreground size-4" />
              Participation
            </Link>
          </>
        )}

        {showAdmin && (
          <Link href="/admin" className={ITEM}>
            <ShieldCheck aria-hidden className="text-muted-foreground size-4" />
            Admin
          </Link>
        )}

        {/* ── The member's own four, as a grid ─────────────────────────────
            T12.4 — NOTIFICATIONS IS NOT HERE, AND THAT IS THE POINT.

            T12.3 put it in this menu on the "the menu is always the COMPLETE
            list" rule that the two leadership links follow. That rule earns
            its keep for those, because they are hidden from the rail below
            `md` and the menu is the only way to reach them on a phone. The
            bell is NOT hidden at any width — only its label is — so the menu
            entry was never a narrow-screen path to anything. It was a second
            button to a page that already had one, sitting directly under the
            first, and "What to notify me about" made it three controls for one
            subject.

            So the feed is reached by the bell, and the settings for it are
            reached from the feed's own Settings button — see the notifications
            page. Both are one click, neither is duplicated, and this menu goes
            back to being the things that have nowhere else to live.

            A grid rather than four more rows: these are the member's OWN
            things and they are peers, so two columns says that in a way a
            vertical list of one-line links does not, and it halves the height
            of a menu that hangs over the page. Four is the right number for
            it — at three it reads as a ragged list, and at six it stops being
            scannable. */}
        <div className="mt-1 grid grid-cols-2 gap-1">
          {/* T11.8 — the member's own villages and their picture. First
              because it is the one of these they open more than once. */}
          <TileLink href="/account" Icon={Castle} label="My bases" />
          <TileLink href="/people" Icon={Users} label="People" />
          {/* Renamed from "Account". Two items a word apart — "Account" and
              "My bases" — is a menu a member has to guess at, and "Account"
              never described that page anyway: it changes a username and a
              password. */}
          <TileLink href="/settings/account" Icon={KeyRound} label="Sign-in" />
          <TileLink href="/guide" Icon={CircleHelp} label="Help" />
        </div>

        {/* Appearance sits below the destinations and above the way out. It is
            a SETTING, not a place, so it does not belong among the links — and
            it is the only setting here that takes effect without leaving the
            menu, which is why it is a control rather than another row. */}
        <div className="mt-1 border-t pt-1">
          <ThemeToggle />
        </div>

        <div className="mt-1 border-t pt-1">
          <SignOutButton className={`${ITEM} w-full text-destructive no-underline hover:no-underline`}>
            <LogOut aria-hidden className="size-4" />
            Sign out
          </SignOutButton>
        </div>
      </div>
    </details>
  );
}
