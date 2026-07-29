// T6.1 — Clan war sync. Every 15 minutes.
// 
// R10 — handle each state explicitly, and treat none of them as a failure:
//   notInWar      the normal state most of the time
//   preparation   roster known, no attacks yet
//   inWar         attacks arriving
//   warEnded      final; capture it before it rolls off
// 
// A 403 here means the war log is private (T0.1), not that the key is wrong.

export {};
