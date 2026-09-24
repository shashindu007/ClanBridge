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
  BookOpen,
  ChevronDown,
  CircleUser,
  ClipboardList,
  KeyRound,
  LogOut,
  MessageSquare,
  ShieldCheck,
  Users,
  type LucideIcon,
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
  "flex items-center gap-2.5 rounded-control px-2.5 py-2 text-[0.9375rem] transition-colors hover:bg-accent hover:text-accent-foreground";

/**
 * One destination: an icon and the page's own name.
 *
 * THE LABEL IS THE PAGE'S TITLE, word for word. The grid this replaced said
 * "My bases" for a page titled "Your account", "Sign-in" for one titled
 * "Account" and "Help" for "Getting started" — so the thing a member clicked
 * and the thing they landed on never matched, and /people was reachable as
 * "0/18", "People" and "Everyone" from one screen. One page, one name,
 * everywhere it is linked.
 */
function MenuLink({
  href,
  Icon,
  label,
  className = "",
}: {
  href: string;
  Icon: LucideIcon;
  label: string;
  className?: string;
}) {
  return (
    <Link href={href} className={`${ITEM} ${className}`}>
      <Icon aria-hidden className="text-muted-foreground size-4 shrink-0" />
      {label}
    </Link>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 border-t pt-1.5 pb-1">
      <p className="text-muted-foreground px-2.5 pb-0.5 text-xs font-medium tracking-wide uppercase">
        {label}
      </p>
      {children}
    </div>
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
        className="text-rail-ink-dim hover:text-rail-ink flex cursor-pointer list-none items-center gap-1.5 rounded-control px-2 py-1.5 text-[0.9375rem] transition-colors hover:bg-white/8 group-open:bg-white/12 group-open:text-rail-ink [&::-webkit-details-marker]:hidden"
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

      {/* .cb-popover, not .cb-panel: a menu hanging over Home's own panels
          used to wear exactly their surface and frame, so it read as if it
          were cutting their text off rather than floating above them. The
          popover tier is lighter, ringed and deeply shadowed, and nothing on a
          page uses it. Capped to the viewport and scrolls inside itself, so on
          a short phone the way out is never below the fold. */}
      <div className="cb-popover absolute right-0 z-50 mt-2 flex max-h-[calc(100dvh-5rem)] w-64 flex-col overflow-y-auto rounded-panel p-2 text-left">
        {/* Which account, spelled out. The username is on the control above;
            the email is the thing that actually distinguishes two accounts
            belonging to the same person. */}
        <div className="px-2.5 pt-1 pb-2">
          <p className="truncate text-sm font-semibold">{label}</p>
          {email && <p className="text-muted-foreground truncate text-xs">{email}</p>}
        </div>

        <Group label="You">
          {/* T11.8 — the member's own villages and their picture. */}
          <MenuLink href="/account" Icon={CircleUser} label="Profile" />
          <MenuLink href="/settings/account" Icon={KeyRound} label="Sign-in & password" />
        </Group>

        <Group label="ClanBridge">
          <MenuLink href="/people" Icon={Users} label="People" />
          {/* Leadership destinations. On the rail itself from `md` up, so these
              are the narrow-screen path to the same pages — here rather than
              hidden, so the menu is always the COMPLETE list. */}
          {showLeadership && (
            <>
              <MenuLink href="/roster" Icon={ClipboardList} label="CWL lineups" className="md:hidden" />
              <MenuLink href="/report" Icon={Activity} label="Participation" className="md:hidden" />
            </>
          )}
          {showAdmin && <MenuLink href="/admin" Icon={ShieldCheck} label="Admin" />}
          <MenuLink href="/guide" Icon={BookOpen} label="Guide" />
          {/* Home's "Go to" panel was the only way here; that panel is gone,
              and a member with something to say should not have to hunt. */}
          <MenuLink href="/feedback" Icon={MessageSquare} label="Feedback" />
        </Group>

        {/* T12.4 — NOTIFICATIONS IS NOT HERE, AND THAT IS THE POINT. The bell
            is on the rail at every width, so a menu entry would be a second
            button to a page that already has one. The settings for it are
            reached from the feed itself. */}

        {/* Appearance is a SETTING, not a place, and the only one that takes
            effect without leaving the menu — so a control, not another row. */}
        <div className="border-t pt-1">
          <ThemeToggle />
        </div>

        <div className="border-t pt-1">
          <SignOutButton className={`${ITEM} w-full text-destructive no-underline hover:no-underline`}>
            <LogOut aria-hidden className="size-4" />
            Sign out
          </SignOutButton>
        </div>
      </div>
    </details>
  );
}
