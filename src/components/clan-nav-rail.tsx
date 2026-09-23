"use client";

// The two nav rows on the wooden rail: the clan menu, and the section tabs.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY THIS IS A CLIENT COMPONENT IN AN OTHERWISE SERVER-RENDERED APP
//
// Because a layout does not re-render on a client-side navigation, and this nav
// lives in one.
//
// (app)/layout.tsx read the current path from the middleware's PATHNAME_HEADER,
// which is correct on a full page load and STALE on every soft navigation
// afterwards. Next's router keeps shared parent layouts mounted and refetches
// only the segments that changed, so clicking a clan pill swapped the page under
// a rail still describing the clan the member had just left. The reported
// symptom was the highlight: pick "DH CWL ONLY" and "Dark Heaven" stays lit.
//
// The highlight was the visible half. The section tabs built their hrefs from
// the same stale tag, so every one of them — Members, War, CWL — pointed back
// into the PREVIOUS clan. A member switching clans and then clicking Members
// would land in the clan they thought they had left, with nothing on screen
// saying so.
//
// usePathname() is subscribed to the router rather than to the request, so it is
// correct on both renders and after every navigation. It also fixes the same
// staleness for the section tabs within one clan (/members -> /war), which a
// [clanTag]/layout.tsx would not have: that layout is common to both routes and
// would be preserved exactly like this one.
//
// Nothing about authorisation moves here. The clans are resolved on the server
// from visibleClans() and passed in; this component decides which of them to
// light, never which of them exist. Every page still resolves its own tag
// through requireClanByTag, and RLS is under that (R3).
// ─────────────────────────────────────────────────────────────────────────────

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Castle, Check, ChevronDown, House } from "lucide-react";
import { useEffect, useRef } from "react";
import { activeNav, CLAN_SECTIONS, currentClanTag, sectionHref } from "@/lib/clan-nav";
import { useDetailsMenu } from "@/components/use-details-menu";

/** One clan, flattened to what the rail needs. Serialisable — it crosses the RSC boundary. */
export interface RailClan {
  id: string;
  tag: string;
  name: string;
  role: string;
  /** From clanAccent(clan.id), resolved on the server so the hue rule stays in one place. */
  color: string;
}

// The current tab is a lit parchment tile cut into the wood; everything else is
// ink on wood. The hover has to carry BOTH colours — bg-accent alone puts dim
// tan text on a light tan chip, which is the one combination in this palette
// that disappears.
const ACTIVE =
  "bg-accent text-accent-foreground shadow-[inset_0_1px_0_oklch(1_0_0/0.5)] font-medium";
const IDLE = "text-wood-ink-dim hover:bg-accent hover:text-accent-foreground";

/**
 * T12.10 — the way back to the home page, as a control that looks like one.
 *
 * Home existed from T12.6 and the only way to reach it was the ClanBridge
 * wordmark, which reads as a logo rather than a button. A member who left the
 * dashboard could not find their way back — recognition over recall, lost.
 *
 * A client component for the same reason as ClanSwitcher below: the layout's
 * pathname goes stale on a soft navigation, and the lit state must not.
 */
export function HomeLink() {
  const active = usePathname() === "/dashboard";
  return (
    <Link
      href="/dashboard"
      aria-label="Home"
      aria-current={active ? "page" : undefined}
      className={`flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[0.9375rem] transition-colors ${
        active ? ACTIVE : IDLE
      }`}
    >
      <House aria-hidden className="size-4" />
      <span className="hidden sm:inline">Home</span>
    </Link>
  );
}

/**
 * The clan menu: ONE control on the rail, where there was a row of pills.
 *
 * A pill per clan was the widest thing on the rail, and it grew with every clan
 * added. At four it was scrolling sideways inside the beam, and the leadership
 * links and the bell were being squeezed to make room for it. A menu costs one
 * control however many clans there are, and its label is the answer to the
 * question the pills were really there for — which clan am I looking at?
 *
 * So the summary names the current clan, lit like a current tab, with its own
 * colour; off a clan's pages it says "Clans". The list marks the current clan
 * with a check as well as aria-current, and ends with the way to all of them.
 *
 * <details>, as the account menu is: no dropdown primitive exists here, and a
 * <details> works from the keyboard and with no JavaScript at all.
 */
export function ClanMenu({ clans }: { clans: RailClan[] }) {
  const current = currentClanTag(usePathname());
  const ref = useRef<HTMLDetailsElement>(null);
  useDetailsMenu(ref);

  if (clans.length === 0) return null;
  const here = clans.find((c) => c.tag === current) ?? null;

  return (
    <details ref={ref} className="group relative min-w-0 shrink">
      <summary
        className={`flex min-w-0 cursor-pointer list-none items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[0.9375rem] transition-colors [&::-webkit-details-marker]:hidden ${
          here ? `${ACTIVE} font-semibold` : `${IDLE} group-open:bg-accent group-open:text-accent-foreground`
        }`}
        aria-label={here ? `Clan: ${here.name}. Switch clan` : "Switch clan"}
        title={here ? `${here.name} — you are ${here.role}` : "Your clans"}
      >
        {here ? (
          <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ background: here.color }} />
        ) : (
          <Castle aria-hidden className="size-4 shrink-0" />
        )}
        <span data-clan-summary className="max-w-[8rem] truncate sm:max-w-[12rem]">
          {here ? here.name : "Clans"}
        </span>
        <ChevronDown aria-hidden className="size-3.5 shrink-0 transition-transform group-open:rotate-180" />
      </summary>

      <div className="cb-panel absolute left-0 z-50 mt-2 w-64 rounded-lg border p-2 text-left shadow-lg">
        <p className="text-muted-foreground px-2 pt-1 pb-1.5 text-xs font-medium tracking-wide uppercase">
          Your clans
        </p>
        <nav aria-label="Switch clan" className="flex flex-col gap-0.5">
          {clans.map((clan) => {
            const active = clan.tag === current;
            return (
              <Link
                key={clan.id}
                href={`/${encodeURIComponent(clan.tag)}`}
                aria-current={active ? "page" : undefined}
                data-clan={clan.name}
                className={`flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[0.9375rem] transition-colors hover:bg-accent hover:text-accent-foreground ${
                  active ? "bg-muted font-semibold" : ""
                }`}
              >
                {/* This clan's own colour, derived from its id — see
                    lib/clan-accent.ts on why there is no lookup table. It is
                    never the only thing distinguishing them: the name is right
                    beside it. */}
                <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ background: clan.color }} />
                <span className="min-w-0 flex-1 truncate">{clan.name}</span>
                <span className="text-muted-foreground shrink-0 text-xs capitalize">{clan.role}</span>
                <Check aria-hidden className={`size-4 shrink-0 ${active ? "" : "invisible"}`} />
              </Link>
            );
          })}
        </nav>
        <div className="mt-1 border-t pt-1">
          <Link
            href="/dashboard"
            className="text-muted-foreground flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            <House aria-hidden className="size-4 shrink-0" />
            All clans on Home
          </Link>
        </div>
      </div>
    </details>
  );
}

/**
 * The section tabs, plus a second row inside the sections that have one.
 *
 * Gated on the tag being one of this member's clans rather than on it merely
 * being tag-SHAPED. A layout renders around a page that calls notFound(), so
 * /%23NOTMYCLAN would otherwise 404 in the content area under a full set of tabs
 * whose every link also 404s.
 */
export function ClanSectionTabs({ clans }: { clans: RailClan[] }) {
  const pathname = usePathname();
  const current = currentClanTag(pathname);

  // Same job as the clan switcher's, and it was missing here for longer.
  //
  // THE SWITCHER HAS TWO OR THREE PILLS. THIS ROW HAS NINE. At roughly 100px
  // per icon-and-label tab that is about 900px of strip in the ~343px a phone
  // gives it, so two thirds of the navigation is off screen at any moment — and
  // the tabs are in nav order, not in an order that puts the current one first.
  // A member on Bases or Notices, the last two, saw a tab strip with nothing lit
  // on it at all, because the tab saying where they were had scrolled off the
  // right-hand edge. The comment on ClanSwitcher's effect above applies here
  // verbatim; it simply was not applied here.
  //
  // Both rows, because the sub-tab row under War and CWL has the same problem in
  // miniature. "nearest" so a tab already on screen is left alone — scrolling
  // the rail on every navigation when nothing needed moving is its own kind of
  // wrong.
  const activeTabRef = useRef<HTMLAnchorElement>(null);
  const activeChildRef = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    activeTabRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
    activeChildRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [pathname]);

  const inClan = current !== null && clans.some((c) => c.tag === current);
  if (!inClan) return null;

  const nav = activeNav(pathname);
  if (!nav) return null;

  const base = `/${encodeURIComponent(current)}`;

  return (
    <div className="border-t border-white/10">
      <div className="mx-auto max-w-7xl px-4">
        {/* The `title` is the destination's own hint, verbatim from
            lib/clan-nav.ts. It costs nothing and it is the whole plain-language
            layer for a member who has not learned the product yet. */}
        <div
          className="cb-scroll-x flex items-center gap-1 py-1.5"
          aria-label="Sections"
          role="navigation"
        >
          {CLAN_SECTIONS.map((section) => {
            const active = nav.section.path === section.path;
            return (
              <Link
                key={section.path}
                ref={active ? activeTabRef : undefined}
                href={sectionHref(base, section)}
                aria-current={active ? "page" : undefined}
                title={section.hint}
                className={
                  "flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-[0.9375rem] transition-colors " +
                  (active ? ACTIVE : IDLE)
                }
              >
                <section.icon aria-hidden className="size-4" />
                {section.label}
              </Link>
            );
          })}
        </div>

        {/* Underline rather than another parchment tile: two identical
            treatments stacked read as two peer rows, and these are subordinate
            to the one above. */}
        {nav.section.children && (
          <div className="cb-scroll-x flex items-center gap-3 border-t border-white/10 py-1.5">
            {nav.section.children.map((child) => {
              const active = nav.child?.path === child.path;
              return (
                <Link
                  key={child.path}
                  ref={active ? activeChildRef : undefined}
                  href={sectionHref(base, child)}
                  aria-current={active ? "page" : undefined}
                  title={child.hint}
                  className={
                    "shrink-0 rounded-sm px-1 py-0.5 text-[0.8125rem] transition-colors " +
                    (active
                      ? "text-wood-ink font-medium underline decoration-2 underline-offset-4"
                      : "text-wood-ink-dim hover:text-wood-ink")
                  }
                >
                  {child.label}
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
