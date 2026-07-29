// Internal domain types — the vocabulary everything above src/integration/ uses.
// 
// R7 — no raw API field names past this boundary. Nothing outside integration/
// sees attackerTag, defenderTag, or a timestamp shaped 20260729T063000.000Z.
// 
// R11 — the two groups below are separate on purpose. Keep them separate here
// too, and do not write a convenience type that merges a roster with the API
// roster it is meant to be compared against.
//
//   Game facts (written by scripts/sync/ only):
//     Clan, Player, MemberSnapshot,
//     CwlSeason, CwlWar, CwlAttack,
//     War, WarAttack,
//     RaidSeason, RaidParticipant, ClanGamesScore
//
//   Human decisions (written by people through the app only):
//     Poll, PollOption, PollResponse,
//     CwlRoster, CwlRosterMember,
//     WarLineup, WarLineupMember,
//     WarTarget, CwlBonus, Announcement, BaseLayout

export {};
