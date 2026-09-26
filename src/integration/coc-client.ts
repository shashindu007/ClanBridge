// T2.3 — The Clash of Clans API client.
//
// R1 — ONLY scripts/sync/ may import this. Pages and route handlers read
// PostgreSQL. If a feature seems to need a live call during a page load, the fix
// is to sync more often, never to call from the page.
//
// R7 — this module returns raw API shapes. Mapping to internal types happens in
// ./mappers/, and nothing above src/integration/ sees a field named attackerTag.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ZodType } from "zod";
import { encodeTag, normaliseTag } from "@/lib/tags";
import {
  CocAuthError,
  CocFixtureError,
  CocNotFoundError,
  CocPrivateLogError,
  CocRateLimitError,
  CocSchemaError,
  CocServerError,
  CocTimeoutError,
  isRetryable,
} from "./errors";

const DEFAULT_BASE = "https://api.clashofclans.com/v1";
const TIMEOUT_MS = 10_000;
const MAX_ATTEMPTS = 4;

// Spacing and backoff are read from the environment so the test suite can run
// without sleeping for real. Production never sets these — the defaults are the
// values the spec calls for, and a sync job that shortened them would be the bug.
const throttleMs = () => Number(process.env.COC_THROTTLE_MS ?? 200);
const backoffBaseMs = () => Number(process.env.COC_BACKOFF_MS ?? 500);

/**
 * Serialised throttle.
 *
 * Deliberately a promise chain rather than a sleep inside each call. With a plain
 * `await sleep(200)` per request, 150 concurrent player lookups all wait 200 ms
 * and then fire simultaneously — precisely the burst the rule exists to prevent.
 * Chaining forces one request to start every 200 ms no matter how many callers
 * are waiting.
 */
let queue: Promise<unknown> = Promise.resolve();

function throttled<T>(fn: () => Promise<T>): Promise<T> {
  const result = queue.then(fn, fn);
  queue = result.then(
    () => sleep(throttleMs()),
    () => sleep(throttleMs()),
  );
  return result;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Not named useFixtures(): the `use` prefix makes ESLint's react-hooks rule
// treat it as a Hook and reject every call site.
function fixturesEnabled(): boolean {
  return process.env.USE_FIXTURES === "true";
}

function baseUrl(): string {
  return (process.env.COC_API_BASE ?? DEFAULT_BASE).replace(/\/$/, "");
}

/**
 * Which fixture file backs which endpoint.
 *
 * Order matters: the war endpoints are checked before the bare clan endpoint,
 * because `/clans/{tag}/currentwar` also starts with `/clans/`.
 */
const FIXTURES: ReadonlyArray<[RegExp, string]> = [
  [/^\/clans\/[^/]+\/currentwar\/leaguegroup$/, "cwlgroup.json"],
  [/^\/clans\/[^/]+\/currentwar$/, "currentwar.json"],
  [/^\/clans\/[^/]+\/capitalraidseasons/, "capitalraids.json"],
  [/^\/clanwarleagues\/wars\/[^/]+$/, "cwlwar.json"],
  [/^\/players\/[^/]+$/, "player.json"],
  [/^\/clans\/[^/]+$/, "clan.json"],
];

/** War endpoints, where a 403 means a private war log rather than a bad key. */
const WAR_ENDPOINT = /^\/clans\/([^/]+)\/currentwar/;

async function loadFixture(endpoint: string): Promise<unknown> {
  const match = FIXTURES.find(([pattern]) => pattern.test(endpoint));
  if (!match) {
    throw new CocFixtureError(endpoint, "no fixture is mapped to this endpoint");
  }

  const file = join(process.cwd(), "fixtures", match[1]);
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch {
    throw new CocFixtureError(endpoint, `cannot read fixtures/${match[1]}`);
  }

  const parsed: unknown = JSON.parse(raw);

  // An unfilled placeholder is `{}`. Say so plainly — otherwise the Zod error
  // that follows reads like a schema bug rather than "you have not run T2.1".
  if (parsed && typeof parsed === "object" && Object.keys(parsed).length === 0) {
    throw new CocFixtureError(
      endpoint,
      `fixtures/${match[1]} is still an empty placeholder. Run: npm run fixtures:capture`,
    );
  }

  return parsed;
}

async function fetchOnce(endpoint: string): Promise<unknown> {
  const token = process.env.COC_API_TOKEN;
  if (!token) {
    throw new CocAuthError(
      "COC_API_TOKEN is not set. It belongs in .env.local and GitHub Actions secrets only (R6).",
      endpoint,
    );
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${baseUrl()}${endpoint}`, {
      headers: {
        // R8-adjacent: this header is the only place the token appears, and it
        // is never copied into an error, a log line, or a thrown message.
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new CocTimeoutError(endpoint, TIMEOUT_MS);
    }
    throw new CocServerError(
      `Network failure: ${error instanceof Error ? error.message : String(error)}`,
      endpoint,
    );
  } finally {
    clearTimeout(timer);
  }

  if (response.ok) {
    return response.json();
  }

  await throwForStatus(response, endpoint);
  throw new Error("unreachable");
}

async function throwForStatus(response: Response, endpoint: string): Promise<never> {
  // Read the body for context, but never assume it is JSON — the proxy returns
  // HTML for some failures.
  const body = await response.text().catch(() => "");

  switch (response.status) {
    case 403: {
      const war = WAR_ENDPOINT.exec(endpoint);
      if (war) {
        // Both cases are 403 with reason "accessDenied". The endpoint is what
        // separates them, and the difference matters: one is an in-game setting
        // on one clan, the other is your API key.
        throw new CocPrivateLogError(
          "War log is private. Clan Settings -> War Log -> Public (T0.1).",
          endpoint,
          decodeURIComponent(war[1]!),
        );
      }
      throw new CocAuthError(
        "403 accessDenied. The key's registered IP does not match. Your home IP changed, or a VPN is on.",
        endpoint,
        403,
      );
    }
    case 404:
      throw new CocNotFoundError(
        "404 notFound. Check the tag is %23-encoded, not a bare '#'.",
        endpoint,
        404,
      );
    case 429: {
      const header = response.headers.get("retry-after");
      const retryAfter = header ? Number(header) : undefined;
      throw new CocRateLimitError(
        "429 rate limited.",
        endpoint,
        Number.isFinite(retryAfter) ? retryAfter : undefined,
      );
    }
    default:
      if (response.status >= 500) {
        throw new CocServerError(`${response.status} from the API.`, endpoint);
      }
      throw new CocServerError(
        `Unexpected ${response.status}: ${body.slice(0, 200)}`,
        endpoint,
      );
  }
}

/**
 * One request, with retry, throttling, timeout and schema validation.
 *
 * Retries 429, 5xx and timeouts only. A 403 or a 404 is a configuration problem
 * that will fail identically every time, so retrying it only burns rate limit.
 */
export async function request<T>(
  endpoint: string,
  schema: ZodType<T>,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const body = fixturesEnabled()
        ? await loadFixture(endpoint)
        : await throttled(() => fetchOnce(endpoint));

      const parsed = schema.safeParse(body);
      if (!parsed.success) {
        throw new CocSchemaError(
          endpoint,
          parsed.error.issues
            .slice(0, 5)
            .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
            .join("; "),
        );
      }
      return parsed.data;
    } catch (error) {
      lastError = error;
      if (!isRetryable(error) || attempt === MAX_ATTEMPTS) break;

      // Exponential backoff, honouring Retry-After when the API sends one.
      const backoff =
        error instanceof CocRateLimitError && error.retryAfterSeconds
          ? error.retryAfterSeconds * 1000
          : backoffBaseMs() * 2 ** (attempt - 1);
      await sleep(backoff);
    }
  }

  throw lastError;
}

// ---------------------------------------------------------------------------
// Endpoints. Every tag goes through lib/tags.ts — an unencoded '#' truncates the
// path and returns 404 on a perfectly valid tag (section 7).
// ---------------------------------------------------------------------------

export function clanEndpoint(tag: string): string {
  return `/clans/${encodeTag(tag)}`;
}

export function currentWarEndpoint(tag: string): string {
  return `/clans/${encodeTag(tag)}/currentwar`;
}

export function warLogEndpoint(tag: string, limit = 5): string {
  return `/clans/${encodeTag(tag)}/warlog?limit=${limit}`;
}

export function cwlGroupEndpoint(tag: string): string {
  return `/clans/${encodeTag(tag)}/currentwar/leaguegroup`;
}

export function cwlWarEndpoint(warTag: string): string {
  return `/clanwarleagues/wars/${encodeTag(warTag)}`;
}

export function capitalRaidsEndpoint(tag: string, limit = 10): string {
  return `/clans/${encodeTag(tag)}/capitalraidseasons?limit=${limit}`;
}

export function playerEndpoint(tag: string): string {
  return `/players/${encodeTag(tag)}`;
}

/**
 * Verify a member's in-game API token (T3.3).
 *
 * THE ONE EXCEPTION TO R1 AND R6. This is called from /api/verify on Vercel,
 * not from a sync job, because the handshake is interactive — a member pastes a
 * token and waits for an answer. It reads no game data, so R1's substance holds.
 * R6 documents the carve-out: /api/verify may read COC_API_TOKEN on Vercel, and
 * nothing else on Vercel may.
 *
 * R8 — the member's token is verified and discarded. It is never stored, never
 * logged, and never placed in an error, a message, or a stack.
 */
export async function verifyPlayerToken(
  playerTag: string,
  token: string,
): Promise<boolean> {
  const endpoint = `/players/${encodeTag(playerTag)}/verifytoken`;
  const apiToken = process.env.COC_API_TOKEN;
  if (!apiToken) {
    throw new CocAuthError("COC_API_TOKEN is not set.", endpoint);
  }

  // The AbortController is armed INSIDE the throttled callback, not outside it.
  // Armed outside, the timer starts while the request is still queued, so a busy
  // queue silently eats the 10s budget and a perfectly healthy verification
  // times out. fetchOnce() avoids this the same way.
  return throttled(async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(`${baseUrl()}${endpoint}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ token }),
        signal: controller.signal,
      });

      // A 403 here means one of two completely different things, and treating
      // them as one is a bug that costs an evening.
      //
      //   accessDenied.invalidIp   OUR key is refused — its registered IP no
      //                            longer matches. Nothing the member did.
      //   anything else            the member's in-game token is wrong or has
      //                            expired, which is ordinary and common.
      //
      // Returning false for both told a member "that token was not accepted"
      // when the real fault was a home IP that changed overnight — so they
      // fetched a fresh token, failed again, and had no way to learn why. The
      // reason field is what separates them.
      if (response.status === 403) {
        // Body read before branching. It carries `reason` and `message`, never
        // the member's token — R8 holds, and none of it is put into an error.
        const denial = (await response
          .json()
          .catch(() => ({}))) as { reason?: string };

        if (denial.reason?.startsWith("accessDenied")) {
          throw new CocAuthError(
            `Game API key rejected (${denial.reason}). Check the IP the key is ` +
              `registered against at developer.clashofclans.com.`,
            endpoint,
          );
        }

        return false;
      }

      if (!response.ok) {
        // Note what is NOT here: the token, or the response body, which echoes it.
        throw new CocServerError(
          `Verification failed (${response.status}).`,
          endpoint,
        );
      }

      const result = (await response.json()) as { status?: string };
      return result.status === "ok";
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new CocTimeoutError(endpoint, TIMEOUT_MS);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  });
}

/** Exposed for tests; normalises exactly as the endpoint builders do. */
export function normalise(tag: string): string {
  return normaliseTag(tag);
}
