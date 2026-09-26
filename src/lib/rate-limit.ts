// T3.3, T9.7 — rate limiting.
//
// Redis is used for rate limiting ONLY. It is never a data cache — the database
// is the cache (section 3).
//
//   T3.3  5 verification attempts per user per hour
//   T9.7  every write route and every sync trigger, so the platform cannot be
//         used as an open proxy to the game API and get the key throttled
//
// Deliberately behind an interface. Upstash credentials (T0.9) do not exist yet,
// and a route whose limiter cannot be tested is a route whose limiter is not
// really there. The in-memory implementation makes the limits assertable today;
// Upstash is selected automatically once the environment variables appear.

export interface RateLimitResult {
  success: boolean;
  limit: number;
  remaining: number;
  /** When the window resets, as epoch milliseconds. */
  reset: number;
}

export interface RateLimiter {
  /** `key` should identify the actor, e.g. `verify:<userId>`. */
  limit(key: string): Promise<RateLimitResult>;
}

export interface RateLimitConfig {
  /** Requests permitted per window. */
  max: number;
  /** Window length in milliseconds. */
  windowMs: number;
}

/** T3.3's limit, stated once so the route and its test cannot disagree. */
export const VERIFY_LIMIT: RateLimitConfig = { max: 5, windowMs: 60 * 60 * 1000 };

/** T9.7's default for ordinary write routes. */
export const WRITE_LIMIT: RateLimitConfig = { max: 30, windowMs: 60 * 1000 };

/** T9.7 — manually triggering a sync is expensive; treat it as rare. */
export const SYNC_TRIGGER_LIMIT: RateLimitConfig = { max: 3, windowMs: 60 * 60 * 1000 };

/**
 * "Refresh now" on the war, CWL, raid and member pages — any approved member.
 *
 * Three budgets, because the thing being protected is shared. Every workflow
 * covers all three clans, so one run answers every member who is waiting, and
 * the private repository's 2,000 Actions minutes a month are already mostly
 * spoken for by the schedules (see the header of lib/github.ts).
 *
 *   JOB    one run per workflow per ten minutes, whoever asks. The real cooldown.
 *   USER   one impatient member cannot use up the day's allowance alone.
 *   DAILY  the hard ceiling: 20 runs a day is at most ~600 minutes a month even
 *          if every one of them is used, every day.
 */
export const SYNC_NOW_JOB_LIMIT: RateLimitConfig = { max: 1, windowMs: 10 * 60 * 1000 };
export const SYNC_NOW_USER_LIMIT: RateLimitConfig = { max: 6, windowMs: 60 * 60 * 1000 };
export const SYNC_NOW_DAILY_LIMIT: RateLimitConfig = { max: 20, windowMs: 24 * 60 * 60 * 1000 };

/**
 * T10.4 — password sign-in attempts.
 *
 * Generous enough that a member fumbling their password three times in a row
 * never notices, tight enough that guessing is not a strategy. Fifteen minutes
 * rather than an hour because the cost of getting this wrong is locking out a
 * real person, and a real person will try again within the hour.
 *
 * Note what this is NOT protecting: before T10 the login form had no limit of
 * any kind, because signInWithOtp went from the browser straight to Supabase and
 * never passed through this application at all. It still does. This budget
 * covers the password path, which is the one worth guessing at.
 */
export const SIGN_IN_LIMIT: RateLimitConfig = { max: 10, windowMs: 15 * 60 * 1000 };

/**
 * Fixed-window counter held in process memory.
 *
 * Correct for tests and for local development. NOT correct in production: Vercel
 * runs many isolated instances, so each would keep its own count and the real
 * limit would be `max × instances`. That is precisely why Upstash exists here,
 * and why this implementation refuses to be used in production below.
 */
export function createMemoryRateLimiter(config: RateLimitConfig): RateLimiter {
  const windows = new Map<string, { count: number; reset: number }>();

  return {
    async limit(key: string): Promise<RateLimitResult> {
      const now = Date.now();
      const existing = windows.get(key);

      if (!existing || existing.reset <= now) {
        const reset = now + config.windowMs;
        windows.set(key, { count: 1, reset });
        return { success: true, limit: config.max, remaining: config.max - 1, reset };
      }

      existing.count += 1;
      const remaining = Math.max(0, config.max - existing.count);
      return {
        success: existing.count <= config.max,
        limit: config.max,
        remaining,
        reset: existing.reset,
      };
    },
  };
}

/**
 * Upstash-backed sliding window.
 *
 * Imported lazily so that neither `@upstash/ratelimit` nor its transitive
 * dependencies are pulled into a bundle that never rate limits anything.
 */
async function createUpstashRateLimiter(config: RateLimitConfig): Promise<RateLimiter> {
  const [{ Ratelimit }, { Redis }] = await Promise.all([
    import("@upstash/ratelimit"),
    import("@upstash/redis"),
  ]);

  const limiter = new Ratelimit({
    redis: Redis.fromEnv(),
    limiter: Ratelimit.slidingWindow(config.max, `${config.windowMs} ms`),
    // Namespaced so the verify limit and the write limit cannot collide on a key.
    prefix: `clanbridge:${config.max}:${config.windowMs}`,
  });

  return {
    async limit(key: string) {
      const result = await limiter.limit(key);
      return {
        success: result.success,
        limit: result.limit,
        remaining: result.remaining,
        reset: result.reset,
      };
    },
  };
}

function upstashConfigured(): boolean {
  return Boolean(
    process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN,
  );
}

/**
 * The limiter a route should use.
 *
 * Upstash when configured; in-memory otherwise. In production without Upstash it
 * THROWS rather than silently falling back — an ineffective rate limiter is worse
 * than none, because it looks like protection while allowing `max × instances`
 * requests through.
 */
export async function getRateLimiter(config: RateLimitConfig): Promise<RateLimiter> {
  if (upstashConfigured()) return createUpstashRateLimiter(config);

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "Rate limiting is not configured. Set UPSTASH_REDIS_REST_URL and " +
        "UPSTASH_REDIS_REST_TOKEN (T0.9). The in-memory limiter is per-instance " +
        "and does not limit anything across a serverless deployment.",
    );
  }

  return createMemoryRateLimiter(config);
}

/**
 * The process-wide limiter for a config. Use this from routes, not
 * getRateLimiter().
 *
 * createMemoryRateLimiter() closes over a fresh Map, so calling getRateLimiter()
 * inside a handler hands every request its own empty counter and the limit never
 * trips. Upstash would still work, because its state lives in Redis — which is
 * the dangerous version of the bug: local and test behaviour silently differs
 * from production, and the limiter looks fine right up until it is the only
 * thing standing between this platform and a throttled API key.
 *
 * Keyed by the config's shape so VERIFY_LIMIT and WRITE_LIMIT cannot share a
 * counter. Held as promises so a slow Upstash import is awaited once, not raced.
 */
const shared = new Map<string, Promise<RateLimiter>>();

export function sharedRateLimiter(config: RateLimitConfig): Promise<RateLimiter> {
  const key = `${config.max}:${config.windowMs}`;
  let limiter = shared.get(key);
  if (!limiter) {
    limiter = getRateLimiter(config).catch((error) => {
      // Never cache a rejected promise: a transient failure would otherwise
      // disable rate limiting for the lifetime of the process.
      shared.delete(key);
      throw error;
    });
    shared.set(key, limiter);
  }
  return limiter;
}

/** Test seam — drop every memoised limiter so a case starts from a clean count. */
export function resetSharedRateLimiters(): void {
  shared.clear();
}

/** Standard headers, so a client can back off instead of hammering. */
export function rateLimitHeaders(result: RateLimitResult): Record<string, string> {
  return {
    "RateLimit-Limit": String(result.limit),
    "RateLimit-Remaining": String(result.remaining),
    "RateLimit-Reset": String(Math.ceil((result.reset - Date.now()) / 1000)),
  };
}
