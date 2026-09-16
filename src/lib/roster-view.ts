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
}

export const DEFAULT_QUERY: BuilderQuery = {
  clan: null,
  show: "all",
  q: "",
  from: null,
  picked: "hide",
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
export function seasonOf(now: Date): string {
  return now.toISOString().slice(0, 7);
}

/** This month and next, the only seasons a leader has reason to start. */
export function startableSeasons(now: Date): string[] {
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return [seasonOf(now), seasonOf(next)];
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
