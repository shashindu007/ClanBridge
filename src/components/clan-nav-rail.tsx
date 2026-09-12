"use client";

// The two nav rows on the wooden rail: the clan switcher, and the section tabs.
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
import { useEffect, useRef } from "react";
import { activeNav, CLAN_SECTIONS, currentClanTag, sectionHref } from "@/lib/clan-nav";

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
 * The clan switcher.
 *
 * Scrolls rather than wraps: the rail is sticky and sits above every page, so a
 * wrapping rail is vertical space taken from the content on the narrowest
 * screens — which, given manifest.json declares this app portrait and
 * standalone, is most of them.
 */
export function ClanSwitcher({ clans }: { clans: RailClan[] }) {
  const current = currentClanTag(usePathname());
  const activeRef = useRef<HTMLAnchorElement>(null);

  // Drag the current clan into view.
  //
  // THE ONE PILL THAT MUST NEVER BE HIDDEN IS THE ONE THAT WAS. A fourth clan
  // pushed the row past the space it had, and because the pills are in tag
  // order rather than in any order that puts the current one first, the clan the
  // member was actually looking at clipped off the right-hand edge — leaving a
  // switcher showing three clans they were NOT in.
  //
  // "nearest" so a pill already on screen is left alone: scrolling the rail on
  // every navigation when nothing needed moving is its own kind of wrong.
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [current]);

  if (clans.length === 0) return null;

  return (
    // A recess cut into the beam, with the pills inside it. See `.cb-well` in
    // globals.css: which clan you are looking at is the most consequential
    // state on any page here, and it used to render as three links at the same
    // weight as "Rosters" and "Participation" sitting beside them.
    <div className="cb-well flex min-w-0 shrink items-center gap-1.5 rounded-lg py-1 pr-1 pl-2">
      {/* The word is for the member who has not worked out yet that these are
          clans rather than sections. Hidden on a phone, where the space is
          worth more than the label and the coloured dots already group them. */}
      <span
        aria-hidden
        className="text-wood-ink-muted hidden shrink-0 text-[0.6875rem] font-semibold tracking-widest uppercase sm:inline"
      >
        Clan
      </span>
      <div
        className="cb-scroll-x flex min-w-0 shrink items-center gap-1"
        aria-label="Switch clan"
        role="navigation"
      >
        {clans.map((clan) => {
          const active = current === clan.tag;
          return (
            <Link
              key={clan.id}
              ref={active ? activeRef : undefined}
              href={`/${encodeURIComponent(clan.tag)}`}
              aria-current={active ? "page" : undefined}
              className={
                "flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-[0.9375rem] transition-colors " +
                // Bolder as well as lit. Weight survives a glance from across a
                // desk where a background tint does not, and this is the one
                // pill a member has to find without reading all of them.
                (active ? `${ACTIVE} font-semibold` : IDLE)
              }
              title={`${clan.name} — you are ${clan.role}`}
            >
              {/* This clan's own colour, derived from its id — see
                  lib/clan-accent.ts on why there is no lookup table. It is
                  never the only thing distinguishing them: the name is right
                  beside it, which is the mitigation the aqua slot needs. */}
              <span
                aria-hidden
                className={
                  "shrink-0 rounded-full transition-all " +
                  (active ? "size-2.5" : "size-2")
                }
                style={{ background: clan.color }}
              />
              {clan.name}
            </Link>
          );
        })}
      </div>
    </div>
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
