// T1.13 — Parse Supercell's timestamp format: 20260729T063000.000Z
// 
// new Date() on that string produces Invalid Date silently — no throw, no warning.
// It must be reshaped to 2026-07-29T06:30:00.000Z before parsing.
// 
// Everything is stored timestamptz in UTC. Conversion to Sri Lanka time is a
// display concern only (T9.9) — off-by-one-day errors here make missed-attack
// lists quietly wrong.

export {};
