// The roster pages' view logic, pure so it can be tested without a database.
//
// /roster and /roster/[season] were redesigned for a leader using them for the
// first time: human month names instead of "2026-09", one clan's lineup at a
// time instead of a button per clan on every player row, and a player list that
// can be filtered and searched. Everything here is the part of that which is
// decidable from values alone — which filter is active, which players it keeps,
// what a season is called — so the pages are left with fetching and markup.
//
// THE FILTERS LIVE IN THE URL, not in client state. The pages are server
// components with server actions, and a filter held in the URL survives the
// redirect every add and remove performs, a reload, and a link sent to a
// co-leader. builderSearch() is how the actions put the leader back exactly
// where they were.

import { fromZonedTime } from "date-fns-tz";
import { DISPLAY_ZONE } from "@/lib/display-time";
import { cwlWindow } from "@/lib/coc-time";

export type Availability = "in" | "maybe" | "out" | "none" | "other";

/** The availability chips, in the order a leader works down them. */
export const AVAILABILITY_FILTERS = ["all", "in", "maybe", "none", "out"] as const;
export type AvailabilityFilter = (typeof AVAILABILITY_FILTERS)[number];

export const AVAILABILITY_LABELS: Record<AvailabilityFilter, string> = {
  all: "Everyone",
  in: "Said In",
  maybe: "Said Maybe",
  none: "No answer",
  out: "Said Out",
};

/**
 * A poll answer as one of the four states a leader acts on.
 *
 * The CWL availability template's options are In / Maybe / Out, but a leader can
 * edit them, so matching is case-insensitive and anything else is "other" —
 * shown as its own text rather than guessed at.
 */
export function availabilityOf(answer: string | null): Availability {
  if (answer === null) return "none";
  switch (answer.trim().toLowerCase()) {
    case "in":
      return "in";
    case "maybe":
      return "maybe";
    case "out":
      return "out";
    default:
      return "other";
  }
}

export interface BuilderQuery {
  /** The tag of the clan whose lineup is being edited, or null for the first. */
  clan: string | null;
  show: AvailabilityFilter;
  /** Name or tag search, trimmed. */
  q: string;
  /** Only players currently in this clan (a clan id), or null for all. */
  from: string | null;
  /** Whether players already picked for any lineup are listed. */
  picked: "hide" | "show";
  /**
   * Whether the "Add players" dialog is open. In the URL, not in component
   * state, so it survives the redirect every Add makes — a leader adding
   * fifteen players stays in the list instead of reopening it fifteen times.
   */
  pick: boolean;
}

export const DEFAULT_QUERY: BuilderQuery = {
  clan: null,
  show: "all",
  q: "",
  from: null,
  picked: "hide",
  pick: false,
};

type Params = Record<string, string | string[] | undefined> | URLSearchParams;

function read(params: Params, key: string): string | undefined {
  if (params instanceof URLSearchParams) return params.get(key) ?? undefined;
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
}

/**
 * The page's search params as a query, with anything unrecognised dropped.
 *
 * Also used by the server action on a hidden form field, which is attacker
 * controlled like any form field — so this is an allow-list, and nothing it
 * returns is ever used as anything but a filter value.
 */
export function parseBuilderQuery(params: Params): BuilderQuery {
  const show = read(params, "show");
  const clan = read(params, "clan")?.trim();
  const from = read(params, "from")?.trim();
  return {
    clan: clan ? clan.slice(0, 16) : null,
    show: (AVAILABILITY_FILTERS as readonly string[]).includes(show ?? "")
      ? (show as AvailabilityFilter)
      : "all",
    q: (read(params, "q") ?? "").trim().slice(0, 40),
    from: from && /^[0-9a-f-]{36}$/i.test(from) ? from : null,
    picked: read(params, "picked") === "show" ? "show" : "hide",
    pick: read(params, "pick") === "1",
  };
}

/** `?clan=…&show=in`, omitting defaults. Empty string when nothing differs. */
export function builderSearch(query: BuilderQuery, overrides: Partial<BuilderQuery> = {}): string {
  const merged = { ...query, ...overrides };
  const params = new URLSearchParams();
  if (merged.clan) params.set("clan", merged.clan);
  if (merged.show !== "all") params.set("show", merged.show);
  if (merged.q) params.set("q", merged.q);
  if (merged.from) params.set("from", merged.from);
  if (merged.picked !== "hide") params.set("picked", merged.picked);
  if (merged.pick) params.set("pick", "1");
  const text = params.toString();
  return text ? `?${text}` : "";
}

/** "2026-09" → "September 2026". Anything unexpected is returned unchanged. */
export function seasonLabel(season: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(season);
  if (!match) return season;
  const month = Number(match[2]);
  if (month < 1 || month > 12) return season;
  return new Date(Date.UTC(Number(match[1]), month - 1, 1)).toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** "2026-09" for the month containing `now`, in UTC — CWL months are UTC months. */
/**
 * When a season's CWL lineups must be final: the start of the 2nd of that
 * month, in the clans' own time.
 *
 * Signup opens on the 1st and the leader has to register the lineup in game
 * before war days begin, so the site's plan is due by the 2nd — the rule the
 * clans work to, stated once here rather than as a date on every page.
 */
export function lineupDeadline(season: string): Date | null {
  if (!/^\d{4}-\d{2}$/.test(season)) return null;
  return fromZonedTime(`${season}-02T00:00:00`, DISPLAY_ZONE);
}

export function seasonOf(now: Date): string {
  return now.toISOString().slice(0, 7);
}

/** "2026-12" -> "2027-01". */
export function nextSeason(season: string): string {
  const [year, month] = season.split("-").map(Number) as [number, number];
  return seasonOf(new Date(Date.UTC(year, month, 1)));
}

/**
 * The season a lineup screen should open on.
 *
 * This month's CWL until its war week is over (cwlWindow in lib/coc-time.ts),
 * then NEXT month's. The calendar month alone was wrong for three weeks out of
 * four: on 27 September "this month" is a CWL that finished on the 12th, and
 * the lineup a leader is actually building — due by the 2nd — is October's.
 */
export function lineupFocusSeason(now: Date): string {
  const window = cwlWindow(now);
  return now < window.warsEnd ? window.season : nextSeason(window.season);
}

/** The focus season and the one after — the only seasons a leader has reason to start. */
export function startableSeasons(now: Date): string[] {
  const focus = lineupFocusSeason(now);
  return [focus, nextSeason(focus)];
}

export interface PoolEntry {
  name: string;
  tag: string;
  clanId: string;
  answer: string | null;
  assignedTo: string | null;
}

/** The players a query keeps. Order is preserved. */
export function filterPool<T extends PoolEntry>(pool: T[], query: BuilderQuery): T[] {
  const needle = query.q.toLowerCase().replace(/^#/, "");
  return pool.filter((p) => {
    if (query.picked === "hide" && p.assignedTo !== null) return false;
    if (query.from && p.clanId !== query.from) return false;
    if (query.show !== "all" && availabilityOf(p.answer) !== query.show) return false;
    if (needle) {
      const inName = p.name.toLowerCase().includes(needle);
      const inTag = p.tag.toLowerCase().replace(/^#/, "").includes(needle);
      if (!inName && !inTag) return false;
    }
    return true;
  });
}

/**
 * How many players each availability chip would show, counted over the pool
 * AFTER the other filters, so a chip never promises rows its click will not show.
 */
export function availabilityCounts(
  pool: PoolEntry[],
  query: BuilderQuery,
): Record<AvailabilityFilter, number> {
  const base = filterPool(pool, { ...query, show: "all" });
  const counts: Record<AvailabilityFilter, number> = { all: base.length, in: 0, maybe: 0, none: 0, out: 0 };
  for (const p of base) {
    const kind = availabilityOf(p.answer);
    if (kind !== "other") counts[kind] += 1;
  }
  return counts;
}

/** "3 of 4 lineups published" and friends, for summaries that must read as English. */
export function publishedSummary(published: number, total: number): string {
  if (total === 0) return "No lineups";
  if (published === 0) return total === 1 ? "Draft, not published yet" : `${total} drafts, none published yet`;
  if (published === total) return total === 1 ? "Published" : `All ${total} published`;
  return `${published} of ${total} published`;
}

export interface LineupBase {
  name: string;
  thLevel: number | null;
  maxPct?: number | null;
  heroPct?: number | null;
}

/**
 * War order: the strongest base first. Highest Town Hall, then the most
 * maxed heroes, then the most maxed base overall, then by name so the order
 * is stable. A Town Hall not known yet sinks to the bottom.
 */
export function byWarOrder(a: LineupBase, b: LineupBase): number {
  return (
    (b.thLevel ?? 0) - (a.thLevel ?? 0) ||
    (b.heroPct ?? -1) - (a.heroPct ?? -1) ||
    (b.maxPct ?? -1) - (a.maxPct ?? -1) ||
    a.name.localeCompare(b.name)
  );
}

export interface LineupBreakdown {
  total: number;
  /** One entry per Town Hall level present, highest first. */
  levels: { level: number; count: number }[];
  /** Players whose Town Hall is not known yet. */
  unknown: number;
  /** Average Town Hall over the known ones, or null with none known. */
  avgTh: number | null;
  avgMaxPct: number | null;
  avgHeroPct: number | null;
}

/** "TH18 ×3, TH17 ×5 …" and the averages, for a lineup or several at once. */
export function lineupBreakdown(players: readonly LineupBase[]): LineupBreakdown {
  const byLevel = new Map<number, number>();
  let unknown = 0;
  for (const p of players) {
    if (p.thLevel) byLevel.set(p.thLevel, (byLevel.get(p.thLevel) ?? 0) + 1);
    else unknown += 1;
  }
  const levels = [...byLevel]
    .map(([level, count]) => ({ level, count }))
    .sort((a, b) => b.level - a.level);
  const average = (values: (number | null | undefined)[]): number | null => {
    const known = values.filter((v): v is number => typeof v === "number");
    return known.length ? known.reduce((t, v) => t + v, 0) / known.length : null;
  };
  return {
    total: players.length,
    levels,
    unknown,
    avgTh: average(players.map((p) => p.thLevel || null)),
    avgMaxPct: average(players.map((p) => p.maxPct)),
    avgHeroPct: average(players.map((p) => p.heroPct)),
  };
}
