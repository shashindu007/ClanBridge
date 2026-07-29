// T2.6 — Clan and member sync. Hourly.
// 
// For each of the three clans: fetch members, upsert players, update roles.
// 
// T2.9 — also write one member_snapshots row per player per run. Donations are
// cumulative totals Supercell resets monthly; snapshotting is the only way to
// derive per-season figures later. Without this, phase 3B has nothing to show.
// 
// T3.9 — handle movement:
//   player now in a different one of the three clans -> update players.clan_id,
//     keep history attached to the player, not the clan
//   player in none of the three -> set players.left_at, keep the row, revoke access
// 
// Done when running it twice produces no duplicate rows (R5).

export {};
