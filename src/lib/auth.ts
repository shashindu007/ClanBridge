// T3.5 — Roles and the requireRole() guard.
// 
// leader / co-leader / elder / member, read from clan_roles.
// Every route handler and Server Action calls this before acting. Roles are
// per-clan, not global: co-leader of clan A is an ordinary member of clan B.

export {};
