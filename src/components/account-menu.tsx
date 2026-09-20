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
// announced with no JavaScript at all. The three handlers below are polish on
// top of something that already works without them — which is the same
// reasoning sign-out-button.tsx uses for being a plain form.
// ─────────────────────────────────────────────────────────────────────────────

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import {
  Activity,
  Castle,
  ChevronDown,
  CircleHelp,
  CircleUser,
  ClipboardList,
  KeyRound,
  LogOut,
  Mail,
  ShieldCheck,
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
  /** T12.2 — unread messages, for the count beside the Messages entry. */
  unreadMessages?: number;
}

const ITEM =
  "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[0.9375rem] transition-colors hover:bg-accent hover:text-accent-foreground";

export function AccountMenu({
  username,
  email,
  showAdmin,
  showLeadership,
  hasAvatar = false,
  unreadMessages = 0,
}: AccountMenuProps) {
  const ref = useRef<HTMLDetailsElement>(null);
  const pathname = usePathname();

  // Close on navigation. <details> has no idea the page changed underneath it,
  // so without this the menu stays hanging open over the page it just sent the
  // member to.
  useEffect(() => {
    if (ref.current) ref.current.open = false;
  }, [pathname]);

  // Escape and click-outside, which every menu is expected to do and <details>
  // does not. pointerdown rather than click so the menu closes on press rather
  // than on release, matching the platform menus members already know.
  useEffect(() => {
    const onPointer = (event: PointerEvent) => {
      const el = ref.current;
      if (!el?.open) return;
      if (event.target instanceof Node && !el.contains(event.target)) el.open = false;
    };
    const onKey = (event: KeyboardEvent) => {
      const el = ref.current;
      if (el?.open && event.key === "Escape") {
        el.open = false;
        // Focus goes back to the control that opened it, or the member is left
        // with no keyboard position at all.
        el.querySelector("summary")?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

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
        {/* T12.2 — the inbox. The rail shows a Messages link only while
            something is unread, so this is the permanent way in: the menu is
            always the COMPLETE list and the rail is a set of shortcuts on top
            of it, which is the same rule the two leadership links follow. */}
        <Link href="/messages" className={ITEM}>
          <Mail aria-hidden className="text-muted-foreground size-4" />
          Messages
          {unreadMessages > 0 && (
            <span className="bg-info-tint text-info-ink ml-auto rounded-full px-1.5 py-0.5 text-xs leading-none">
              {unreadMessages}
            </span>
          )}
        </Link>
        {/* T11.8 — the member's own villages and their picture. Above the
            credentials entry because it is the one of the two they open more than
            once. */}
        <Link href="/account" className={ITEM}>
          <Castle aria-hidden className="text-muted-foreground size-4" />
          My bases
        </Link>
        {/* Renamed from "Account". Two items a word apart — "Account" and "My
            bases" — is a menu a member has to guess at, and "Account" never
            described that page anyway: it changes a username and a password. */}
        <Link href="/settings/account" className={ITEM}>
          <KeyRound aria-hidden className="text-muted-foreground size-4" />
          Sign-in and password
        </Link>
        <Link href="/guide" className={ITEM}>
          <CircleHelp aria-hidden className="text-muted-foreground size-4" />
          Help and page guide
        </Link>

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
