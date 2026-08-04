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
 * One player's snapshots, oldest first, from `since` onwards (T3B.4).
 *
 * Ascending because every consumer walks it forwards looking for the point where
 * a counter DROPPED, which is how a monthly reset is detected. Handing that code
 * a descending array would make every reset look like a gain.
 */
export async function snapshotHistory(
  supabase: SupabaseClient,
  clanId: string,
  playerId: string,
  since: Date,
): Promise<SnapshotPoint[]> {
  const { data, error } = await supabase
    .from("member_snapshots")
    .select("player_id, captured_at, donations, donations_received, trophies, th_level, role")
    .eq("clan_id", clanId) // R3
    .eq("player_id", playerId)
    .is("deleted_at", null)
    .gte("captured_at", since.toISOString())
    .order("captured_at");

  if (error || !data) return [];
  return (data as Array<Record<string, unknown>>).map(toPoint);
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
  const { data, error } = await supabase
    .from("member_snapshots")
    .select("clan_id, captured_at")
    .eq("player_id", playerId)
    .is("deleted_at", null)
    .order("captured_at");

  if (error || !data) return [];

  const spans = new Map<string, { clanId: string; firstSeen: string; lastSeen: string }>();
  for (const row of data as Array<Record<string, unknown>>) {
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
