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

/** Standard headers, so a client can back off instead of hammering. */
export function rateLimitHeaders(result: RateLimitResult): Record<string, string> {
  return {
    "RateLimit-Limit": String(result.limit),
    "RateLimit-Remaining": String(result.remaining),
    "RateLimit-Reset": String(Math.ceil((result.reset - Date.now()) / 1000)),
  };
}
