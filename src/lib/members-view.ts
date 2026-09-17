// The member directory's URL state, as pure functions.
//
// THE FILTERS LIVE IN THE URL, not in client state — the same idiom
// lib/roster-view.ts sets out and for the same three reasons: the page stays a
// server component with no JavaScript, a leader can send somebody a link to
// exactly the view they are looking at, and the browser's back button works.
//
// Extracted rather than written inline because the directory hand-rolled its
// query string in two places — the column-header links and the departed toggle —
// and both rebuilt it from scratch. That was survivable while there were three
// parameters and none of them interacted. It stopped being survivable the moment
// a search term was added: every sort click silently dropped it, because the
// code that built the link had never heard of it.
//
// So there is one function that reads the URL and one that writes it, and no
// page composes a query string by hand.

import type { Tier } from "@/lib/visibility";

/** The columns the directory can sort by. The keys are also the URL values. */
export const SORTS = {
  name: "Name",
  role: "Role",
  th: "TH",
  trophies: "Trophies",
  given: "Given",
  received: "Received",
  ratio: "Ratio",
  activity: "Last seen",
} as const;

export type SortKey = keyof typeof SORTS;

/**
 * The columns a visitor may sort by.
 *
 * A visitor sees name, in-game role and Town Hall and nothing else, so offering
 * "Ratio" would be offering a sort on a column that is not on their screen —
 * and `?sort=ratio` typed by hand would silently sort by a figure they are not
 * allowed to read. parseMemberQuery() folds anything outside this set back to
 * "name" rather than refusing, because a bad sort is a bad URL, not an attack.
 */
const VISITOR_SORTS = ["name", "role", "th"] as const;

/** The sortable columns for a tier. */
export function sortsFor(tier: Tier): Partial<Record<SortKey, string>> {
  if (tier !== "visitor") return SORTS;
  return Object.fromEntries(VISITOR_SORTS.map((k) => [k, SORTS[k]]));
}

export interface MemberQuery {
  sort: SortKey;
  dir: "asc" | "desc";
  /** Show members who have left the clan. R4 keeps their rows for ever. */
  departed: boolean;
  /** Name or tag search. Trimmed, and capped at 40 like parseBuilderQuery's. */
  q: string;
}

export const DEFAULT_QUERY: MemberQuery = {
  sort: "name",
  dir: "asc",
  departed: false,
  q: "",
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
 * An ALLOW-LIST, like parseBuilderQuery(). `sort` is checked against the tier's
 * own column set, so a hand-edited `?sort=ratio` on a visitor's URL becomes
 * "name" rather than reaching the comparator.
 */
export function parseMemberQuery(params: Params, tier: Tier): MemberQuery {
  const allowed = sortsFor(tier);
  const sort = read(params, "sort");
  return {
    sort: sort && sort in allowed ? (sort as SortKey) : "name",
    dir: read(params, "dir") === "desc" ? "desc" : "asc",
    departed: read(params, "departed") === "1",
    // The cap is the same 40 roster-view.ts uses. A search term is a filter, not
    // a document; anything longer is a paste accident or a probe.
    q: (read(params, "q") ?? "").trim().slice(0, 40),
  };
}

/**
 * `?sort=ratio&dir=desc&q=sk`, omitting defaults. Empty when nothing differs.
 *
 * Every link on the directory goes through this, which is what makes a search
 * term survive a sort click and the departed toggle survive a search. The two
 * places that used to build this by hand each knew about a different subset of
 * the state.
 */
export function memberSearch(
  query: MemberQuery,
  overrides: Partial<MemberQuery> = {},
): string {
  const merged = { ...query, ...overrides };
  const params = new URLSearchParams();
  if (merged.sort !== DEFAULT_QUERY.sort) params.set("sort", merged.sort);
  if (merged.dir !== DEFAULT_QUERY.dir) params.set("dir", merged.dir);
  if (merged.departed) params.set("departed", "1");
  if (merged.q) params.set("q", merged.q);
  const text = params.toString();
  return text ? `?${text}` : "";
}

/**
 * The rows a search term keeps. Order is preserved.
 *
 * Matching is filterPool()'s, lifted deliberately rather than reinvented
 * (lib/roster-view.ts:147): lowercase, a leading `#` stripped from both sides,
 * substring against the name OR the tag. A member pasting `#2PP0JCCL` and a
 * member typing `2pp0` both find the same row.
 *
 * NOT searchPlayers()'s semantics, and the difference is deliberate. That one
 * matches tags EXACTLY, because it queries the database across clans and a
 * prefix match there is a way to enumerate tags a page at a time. This one
 * filters a list the caller has already been given in full, so there is nothing
 * to enumerate — and substring matching is what somebody typing into a box on a
 * page they are already reading expects.
 */
export function filterMembers<T extends { name: string; tag: string }>(
  rows: T[],
  q: string,
): T[] {
  const needle = q.trim().toLowerCase().replace(/^#/, "");
  if (!needle) return rows;
  return rows.filter(
    (r) =>
      r.name.toLowerCase().includes(needle) ||
      r.tag.toLowerCase().replace(/^#/, "").includes(needle),
  );
}
