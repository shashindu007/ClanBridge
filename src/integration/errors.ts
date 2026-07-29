// Named error classes for the Clash of Clans API boundary.
//
// Section 4: never throw bare strings. Callers branch on the class, not on a
// status code or a substring of a message.
//
// R8 — no message, cause or stack here may ever contain a player API token.
// The client never puts a request body or an Authorization header into an error,
// which is why these carry an endpoint path and nothing else.

/** Base class, so `catch (e) { if (e instanceof CocError) }` works. */
export class CocError extends Error {
  /** The endpoint path, never the full URL — the URL can carry a token in some setups. */
  readonly endpoint: string;
  readonly status?: number;

  constructor(message: string, endpoint: string, status?: number) {
    super(message);
    this.name = new.target.name;
    this.endpoint = endpoint;
    this.status = status;
  }
}

/**
 * 403 on a non-war endpoint. The key's registered IP does not match the caller.
 *
 * Almost always one of: your home IP changed, a VPN is on, or the development key
 * is being used from GitHub Actions where the proxy key belongs.
 *
 * NOT retryable — the same request will fail identically forever, and retrying
 * burns rate limit for nothing.
 */
export class CocAuthError extends CocError {}

/**
 * 403 on a war endpoint. The clan's war log is set to private in game (T0.1).
 *
 * Separate from CocAuthError because the fix is completely different: this is an
 * in-game setting on a specific clan, not a key problem. Conflating the two sends
 * you hunting an IP issue that does not exist.
 */
export class CocPrivateLogError extends CocError {
  readonly clanTag: string;

  constructor(message: string, endpoint: string, clanTag: string) {
    super(message, endpoint, 403);
    this.clanTag = clanTag;
  }
}

/**
 * 404. Usually a tag that was not %23-encoded rather than a tag that is wrong —
 * an unencoded '#' truncates the URL path.
 *
 * Also the normal response for the CWL league group outside CWL week, which
 * callers must treat as an ordinary condition, not a failure (R10).
 */
export class CocNotFoundError extends CocError {}

/** 429. Retryable with backoff. */
export class CocRateLimitError extends CocError {
  /** Seconds from a Retry-After header, when the API supplies one. */
  readonly retryAfterSeconds?: number;

  constructor(message: string, endpoint: string, retryAfterSeconds?: number) {
    super(message, endpoint, 429);
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** 5xx, or a network failure. Retryable. */
export class CocServerError extends CocError {}

/** Request exceeded the timeout. The RoyaleAPI proxy occasionally hangs. Retryable. */
export class CocTimeoutError extends CocError {
  constructor(endpoint: string, timeoutMs: number) {
    super(`Request timed out after ${timeoutMs}ms`, endpoint);
  }
}

/**
 * The response parsed as JSON but did not match the Zod schema.
 *
 * Deliberately loud. If Supercell changes a shape, failing here is far better
 * than writing nulls into a CWL table that cannot be re-fetched (R5).
 */
export class CocSchemaError extends CocError {
  readonly issues: string;

  constructor(endpoint: string, issues: string) {
    super(`Response did not match the expected schema: ${issues}`, endpoint);
    this.issues = issues;
  }
}

/** USE_FIXTURES=true but the fixture for this endpoint is missing or still `{}`. */
export class CocFixtureError extends CocError {
  constructor(endpoint: string, detail: string) {
    super(`Fixture unavailable: ${detail}`, endpoint);
  }
}

/** Errors worth retrying. Never 403 or 404 — those are configuration, not luck. */
export function isRetryable(error: unknown): boolean {
  return (
    error instanceof CocRateLimitError ||
    error instanceof CocServerError ||
    error instanceof CocTimeoutError
  );
}
