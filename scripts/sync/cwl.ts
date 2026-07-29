// T4.1 — Clan War League sync. Every 2 hours. THE URGENT ONE.
// 
// Fetch the league group, then each war tag, then insert seasons, wars and attacks
// with ON CONFLICT DO NOTHING against cwl_attacks(war_id, player_id, attack_order).
// 
// R10 — a missing CWL group is a clean exit, not an error. There is no CWL for
// three weeks of every month. A job that reports failure three weeks out of four
// trains you to ignore the alerts that matter.
// 
// R5 — never UPDATE or DELETE a historical row because the API returned something
// unexpected. This data is deleted from Supercell's side when the season ends and
// cannot ever be recovered.

export {};
