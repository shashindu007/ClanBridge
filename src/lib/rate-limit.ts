// T3.3, T9.7 — Upstash Redis rate limiting.
// 
// Redis is used for rate limiting only. It is never a data cache — the database
// is the cache (section 3).
// 
// T3.3: 5 verification attempts per user per hour.
// T9.7: every write route and every sync trigger, so the platform cannot be used
// as an open proxy to the game API and get the key throttled.

export {};
