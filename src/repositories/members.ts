// T3B.2 — the member directory's reads.
//
// R3 — member_snapshots has a real clan_id column, unlike cwl_attacks, so the
// filter here is a direct .eq("clan_id", clanId) rather than the resolve-the-
// parent-first chain repositories/cwl.ts has to use. Both queries below filter
// on it AND restrict to the clan's own player ids.
//
// R4 — nothing is deleted, so "current members" is `left_at is null`, not an
// absent row. A departed member still has every snapshot, attack and bonus they
// ever had; the directory just does not list them by default (T0.11).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ClanRole } from "@/types/domain";

export interface MemberRow {
  playerId: string;
  tag: string;
  name: string;
  thLevel: number | null;
  clanRole: ClanRole | null;
  verified: boolean;
  /** Set when the player is in none of the three clans (T3.9). */
  leftAt: string | null;
}

/**
 * One reading of the counters Supercell resets monthly.
 *
 * `donations` and `donationsReceived` are CUMULATIVE SINCE THE LAST RESET, not
 * deltas — so the newest snapshot in a month already holds that month's total.
 * services/members.ts depends on this; read the note there before changing it.
 */
export interface SnapshotPoint {
  playerId: string;
  capturedAt: string;
  donations: number | null;
  donationsReceived: number | null;
  trophies: number | null;
  thLevel: number | null;
  role: ClanRole | null;
}

function toPoint(row: Record<string, unknown>): SnapshotPoint {
  return {
    playerId: row.player_id as string,
    capturedAt: row.captured_at as string,
    donations: (row.donations as number | null) ?? null,
    donationsReceived: (row.donations_received as number | null) ?? null,
    trophies: (row.trophies as number | null) ?? null,
    thLevel: (row.th_level as number | null) ?? null,
    role: (row.role as ClanRole | null) ?? null,
  };
}

/**
 * The accounts behind a set of players, for notifying them (T4B.5, T5.6).
 *
 * A player is a village; a user is a login. They are not the same thing and the
 * mapping is neither total nor unique: an unverified player has no user_id at
 * all, and one member with two villages appears twice and must be notified once.
 * Hence a Set, and hence the silent skip for nulls — a member who has not
 * verified simply cannot be reached, which is not an error.
 *
 * R3 — filtered by clan as well as by id. Without it a caller holding a player
 * id from another clan would resolve an account it has no business addressing.
 */
export async function userIdsForPlayers(
  supabase: SupabaseClient,
  clanId: string,
  playerIds: readonly string[],
): Promise<string[]> {
  if (playerIds.length === 0) return [];

  const { data, error } = await supabase
    .from("players")
    .select("user_id")
    .eq("clan_id", clanId) // R3
    .in("id", [...playerIds])
    .is("deleted_at", null)
    .not("user_id", "is", null);

  if (error || !data) return [];

  return [
    ...new Set(
      (data as Array<{ user_id: string | null }>)
        .map((r) => r.user_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
}

/**
 * The clan's players.
 *
 * `includeDeparted` is the directory's toggle. Default false: T0.11's fourth
 * question — whether a departed member stays visible — has not been answered by
 * the leader yet, and hiding by default is reversible in a way that surprising
 * everyone with a list full of ex-members is not.
 */
export async function membersForClan(
  supabase: SupabaseClient,
  clanId: string,
  options: { includeDeparted?: boolean } = {},
): Promise<MemberRow[]> {
  const query = supabase
    .from("players")
    .select("id, tag, name, th_level, clan_role, verified, left_at")
    .eq("clan_id", clanId) // R3
    .is("deleted_at", null);

  // Applied as a filter rather than fetched-and-dropped, so the common case
  // does not read rows it is going to discard.
  if (!options.includeDeparted) query.is("left_at", null);

  const { data, error } = await query.order("name");
  if (error || !data) return [];

  return (data as Array<Record<string, unknown>>).map((r) => ({
    playerId: r.id as string,
    tag: r.tag as string,
    name: r.name as string,
    thLevel: (r.th_level as number | null) ?? null,
    clanRole: (r.clan_role as ClanRole | null) ?? null,
    verified: r.verified === true,
    leftAt: (r.left_at as string | null) ?? null,
  }));
}

/**
 * The most recent snapshot for each player in one clan.
 *
 * Postgres would express this as `distinct on (player_id) ... order by
 * captured_at desc`, which PostgREST cannot send. The workaround is to read the
 * newest rows and keep the first occurrence of each player — but that only works
 * if the window is guaranteed to contain a COMPLETE batch.
 *
 * It is: sync:clans writes one row per player per run, so a batch is exactly one
 * member list. Reading `4 × members` rows therefore spans roughly the last four
 * runs, and any one of them covers everybody. The floor of 200 keeps it correct
 * for a clan whose player rows have not been written yet.
 *
 * A player still missing from the result has genuinely not been synced recently
 * — the directory shows that as "—" rather than inventing a zero, because a zero
 * is indistinguishable from a real reading of nothing donated.
 */
export async function latestSnapshots(
  supabase: SupabaseClient,
  clanId: string,
  memberCount: number,
): Promise<Map<string, SnapshotPoint>> {
  const { data, error } = await supabase
    .from("member_snapshots")
    .select("player_id, captured_at, donations, donations_received, trophies, th_level, role")
    .eq("clan_id", clanId) // R3
    .is("deleted_at", null)
    .limit(Math.max(200, memberCount * 4))
    .order("captured_at", { ascending: false });

  if (error || !data) return new Map();

  const latest = new Map<string, SnapshotPoint>();
  for (const row of data as Array<Record<string, unknown>>) {
    const point = toPoint(row);
    // Newest first, so the first sighting of a player is their latest.
    if (!latest.has(point.playerId)) latest.set(point.playerId, point);
  }
  return latest;
}

export interface SearchHit extends MemberRow {
  clanId: string;
}

/**
 * T3B.6 — find players by name or tag across the clans the caller may see.
 *
 * ONE QUERY PER CLAN, deliberately, and this is the part to not "optimise".
 * The obvious version is a single `players` query with an ilike and no clan
 * filter, relying on RLS to scope it. That works right up until someone runs it
 * with the service key, or adds a join that widens the policy, and then a leader
 * of clan A is searching all three. R3 says the query is the mechanism and the
 * policy is the net; a search with no clan in it has no mechanism at all.
 *
 * `clanIds` must come from visibleClans() — never from a list of tags written
 * down somewhere, which is precisely what T3.7 exists to catch.
 *
 * Tags are matched exactly rather than by prefix. A tag is not a name and a
 * partial one is not a meaningful query; matching loosely would also turn this
 * into a way to enumerate tags a page at a time.
 */
export async function searchPlayers(
  supabase: SupabaseClient,
  clanIds: string[],
  term: string,
): Promise<SearchHit[]> {
  const trimmed = term.trim();
  if (!trimmed || !clanIds.length) return [];

  // PostgREST treats these as pattern metacharacters; a member searching for a
  // name containing one should get a literal match, not a wildcard.
  const escaped = trimmed.replace(/[%_\\]/g, (ch) => `\\${ch}`);
  const isTag = trimmed.startsWith("#");

  const perClan = await Promise.all(
    clanIds.map(async (clanId) => {
      const query = supabase
        .from("players")
        .select("id, tag, name, th_level, clan_role, verified, left_at")
        .eq("clan_id", clanId) // R3 — the mechanism, not the net
        .is("deleted_at", null);

      if (isTag) query.eq("tag", trimmed.toUpperCase());
      else query.ilike("name", `%${escaped}%`);

      const { data, error } = await query.order("name");
      if (error || !data) return [];

      return (data as Array<Record<string, unknown>>).map((r) => ({
        clanId,
        playerId: r.id as string,
        tag: r.tag as string,
        name: r.name as string,
        thLevel: (r.th_level as number | null) ?? null,
        clanRole: (r.clan_role as ClanRole | null) ?? null,
        verified: r.verified === true,
        leftAt: (r.left_at as string | null) ?? null,
      }));
    }),
  );

  return perClan.flat();
}

export interface RecentSnapshots {
  /** playerId -> their points in this window, ASCENDING. */
  byPlayer: Map<string, SnapshotPoint[]>;
  /** The oldest reading the window actually reached, or null if empty. */
  coveredFrom: string | null;
}

/**
 * A bounded window of the whole clan's snapshots, for deriving last-activity
 * across the directory in ONE query instead of one per member.
 *
 * Why a row cap rather than a date range: last-activity needs consecutive
 * readings to compare, so it wants every row, and at hourly × 50 members a
 * week is ~8,400 rows. PostgREST caps response size, and a truncated response
 * would silently produce wrong activity dates rather than an error — the worst
 * available failure. Asking for a fixed number of the newest rows makes the
 * limit explicit and the coverage knowable.
 *
 * `coveredFrom` is returned so the page can say how far back it looked. A member
 * with no activity inside the window is reported as "nothing in the last N days"
 * rather than a precise-looking date the query never had the data to support.
 * The full history for one player is snapshotHistory(), used by the profile.
 */
export async function recentSnapshots(
  supabase: SupabaseClient,
  clanId: string,
  maxRows = 1500,
): Promise<RecentSnapshots> {
  const { data, error } = await supabase
    .from("member_snapshots")
    .select("player_id, captured_at, donations, donations_received, trophies, th_level, role")
    .eq("clan_id", clanId) // R3
    .is("deleted_at", null)
    .limit(maxRows)
    .order("captured_at", { ascending: false });

  if (error || !data) return { byPlayer: new Map(), coveredFrom: null };

  const rows = (data as Array<Record<string, unknown>>).map(toPoint);
  const byPlayer = new Map<string, SnapshotPoint[]>();

  // Fetched newest-first to make the cap take the RECENT rows; flipped here
  // because every consumer walks forwards looking for a counter that dropped.
  for (const point of rows.slice().reverse()) {
    const list = byPlayer.get(point.playerId) ?? [];
    list.push(point);
    byPlayer.set(point.playerId, list);
  }

  const oldest = rows.length ? rows[rows.length - 1]!.capturedAt : null;
  return { byPlayer, coveredFrom: oldest };
}

/**
 * PostgREST's default row cap. A read that can exceed it has to page, or it
 * silently comes back short — see newestFirst() for which end goes missing.
 */
const PAGE = 1000;

/**
 * Enough pages for a little over two years of hourly snapshots of one player —
 * a ceiling so a runaway loop is impossible, not a limit anyone should meet.
 */
const MAX_PAGES = 20;

/**
 * Read a player's snapshots NEWEST FIRST, a page at a time.
 *
 * Why this exists: these reads used to be one ascending query. Six months of
 * hourly snapshots is ~4,400 rows, PostgREST returns 1,000, and ascending means
 * the 1,000 it returns are the OLDEST — so after about six weeks a profile
 * showed history that stopped weeks ago and missed the move to another clan
 * that happened yesterday. Paging backwards by captured_at (unique per player
 * per hour, so no row is skipped or repeated at a page edge) always has the
 * newest data and only ever loses the far past to MAX_PAGES.
 */
async function newestFirst(
  supabase: SupabaseClient,
  columns: string,
  playerId: string,
  filter: { clanId?: string; since?: Date },
): Promise<Array<Record<string, unknown>>> {
  const rows: Array<Record<string, unknown>> = [];
  let before: string | null = null;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    let query = supabase
      .from("member_snapshots")
      .select(columns)
      .eq("player_id", playerId)
      .is("deleted_at", null);
    if (filter.clanId) query = query.eq("clan_id", filter.clanId); // R3
    if (filter.since) query = query.gte("captured_at", filter.since.toISOString());
    if (before) query = query.lt("captured_at", before);

    const { data, error } = await query
      .limit(PAGE)
      .order("captured_at", { ascending: false });

    if (error || !data) break;
    const batch = data as unknown as Array<Record<string, unknown>>;
    rows.push(...batch);
    if (batch.length < PAGE) break;
    before = batch[batch.length - 1]!.captured_at as string;
  }

  return rows;
}

/**
 * One player's snapshots, oldest first, from `since` onwards (T3B.4).
 *
 * Ascending because every consumer walks it forwards looking for the point where
 * a counter DROPPED, which is how a monthly reset is detected. Handing that code
 * a descending array would make every reset look like a gain. Read newest-first
 * and reversed here, for the reason newestFirst() gives.
 */
export async function snapshotHistory(
  supabase: SupabaseClient,
  clanId: string,
  playerId: string,
  since: Date,
): Promise<SnapshotPoint[]> {
  const rows = await newestFirst(
    supabase,
    "player_id, captured_at, donations, donations_received, trophies, th_level, role",
    playerId,
    { clanId, since },
  );
  return rows.reverse().map(toPoint);
}

/**
 * Every clan this player has snapshots in, newest activity first (T3B.4).
 *
 * NOT filtered to one clan — that is the point. A player who moved from clan A
 * to clan B has snapshots in both, and the movement history is precisely the
 * list of clans they appear in and when. RLS still applies: a caller only sees
 * rows for clans they belong to, so a leader of one clan sees the part of the
 * journey that happened inside their own family and nothing else.
 */
export async function clanMovement(
  supabase: SupabaseClient,
  playerId: string,
): Promise<Array<{ clanId: string; firstSeen: string; lastSeen: string }>> {
  // Newest first, then walked oldest-first below, for the reason newestFirst()
  // gives: the recent move is the part of this list that matters most.
  const rows = (await newestFirst(supabase, "clan_id, captured_at", playerId, {})).reverse();

  const spans = new Map<string, { clanId: string; firstSeen: string; lastSeen: string }>();
  for (const row of rows) {
    const clanId = row.clan_id as string;
    const at = row.captured_at as string;
    const existing = spans.get(clanId);
    // Ascending, so the first sighting is firstSeen and each later one extends
    // lastSeen. A player who moved away and came back collapses into one span —
    // acceptable, because the profile shows "when were they here", not a ledger.
    if (!existing) spans.set(clanId, { clanId, firstSeen: at, lastSeen: at });
    else existing.lastSeen = at;
  }

  return [...spans.values()].sort((a, b) => b.lastSeen.localeCompare(a.lastSeen));
}
