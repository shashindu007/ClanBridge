// T2.3 — the API client, tested against a stubbed fetch.
//
// No network is touched. Several assertions depend on that: the fixture tests
// replace fetch with something that throws, so if any code path reaches the
// network the test fails rather than quietly succeeding.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  CocAuthError,
  CocNotFoundError,
  CocPrivateLogError,
  CocRateLimitError,
  CocSchemaError,
  CocServerError,
  CocTimeoutError,
  isRetryable,
} from "./errors";
import {
  capitalRaidsEndpoint,
  clanEndpoint,
  currentWarEndpoint,
  cwlGroupEndpoint,
  cwlWarEndpoint,
  playerEndpoint,
  request,
  verifyPlayerToken,
} from "./coc-client";

const anySchema = z.looseObject({});

function jsonResponse(body: unknown, status = 200, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useRealTimers();
  process.env.COC_API_TOKEN = "test-token";
  process.env.COC_API_BASE = "https://api.example.test/v1";
  process.env.USE_FIXTURES = "false";
  // Real sleeps, but short ones. The retry and throttle logic is what is under
  // test, not the wall-clock duration of the pauses.
  process.env.COC_THROTTLE_MS = "1";
  process.env.COC_BACKOFF_MS = "1";
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("endpoint builders encode the tag", () => {
  // Section 7: an unencoded '#' truncates the path and the API answers 404 on a
  // tag that is perfectly valid. Every builder must go through lib/tags.ts.
  it.each([
    ["clan", clanEndpoint("#2PP0JCCL"), "/clans/%232PP0JCCL"],
    ["currentwar", currentWarEndpoint("#2PP0JCCL"), "/clans/%232PP0JCCL/currentwar"],
    [
      "cwl group",
      cwlGroupEndpoint("#2PP0JCCL"),
      "/clans/%232PP0JCCL/currentwar/leaguegroup",
    ],
    ["cwl war", cwlWarEndpoint("#8G9QRVJL"), "/clanwarleagues/wars/%238G9QRVJL"],
    ["player", playerEndpoint("#PY0LQGRJ"), "/players/%23PY0LQGRJ"],
  ])("%s", (_name, actual, expected) => {
    expect(actual).toBe(expected);
    expect(actual).not.toContain("#");
  });

  it("normalises before encoding", () => {
    expect(clanEndpoint("2pp0jccl")).toBe("/clans/%232PP0JCCL");
    // The letter O corrected to zero, then encoded.
    expect(clanEndpoint("#2PPOJCCL")).toBe("/clans/%232PP0JCCL");
  });

  it("includes the limit on capital raids", () => {
    expect(capitalRaidsEndpoint("#2PP0JCCL", 3)).toBe(
      "/clans/%232PP0JCCL/capitalraidseasons?limit=3",
    );
  });
});

describe("error mapping", () => {
  it("maps 403 on a war endpoint to a private war log, naming the clan", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ reason: "accessDenied" }, 403));

    const error = await request(currentWarEndpoint("#2PP0JCCL"), anySchema).catch(
      (e) => e,
    );

    expect(error).toBeInstanceOf(CocPrivateLogError);
    expect((error as CocPrivateLogError).clanTag).toBe("#2PP0JCCL");
    expect((error as Error).message).toMatch(/war log/i);
  });

  // The distinction that matters: same status, same reason, completely different
  // fix. One is an in-game setting on one clan, the other is your API key.
  it("maps 403 on a non-war endpoint to an auth error", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ reason: "accessDenied" }, 403));

    const error = await request(clanEndpoint("#2PP0JCCL"), anySchema).catch((e) => e);

    expect(error).toBeInstanceOf(CocAuthError);
    expect(error).not.toBeInstanceOf(CocPrivateLogError);
    expect((error as Error).message).toMatch(/IP/);
  });

  it("maps 404 and mentions the encoding trap", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ reason: "notFound" }, 404));
    const error = await request(clanEndpoint("#2PP0JCCL"), anySchema).catch((e) => e);
    expect(error).toBeInstanceOf(CocNotFoundError);
    expect((error as Error).message).toMatch(/%23/);
  });

  it("maps 5xx to a server error", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, 503));
    const error = await request(clanEndpoint("#2PP0JCCL"), anySchema).catch((e) => e);
    expect(error).toBeInstanceOf(CocServerError);
  });

  it("fails loudly when the response does not match the schema", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ tag: 12345 }));
    const schema = z.object({ tag: z.string() });

    const error = await request(clanEndpoint("#2PP0JCCL"), schema).catch((e) => e);

    // R5 — better to fail at the boundary than write nulls into a CWL table
    // that cannot be re-fetched.
    expect(error).toBeInstanceOf(CocSchemaError);
    expect((error as CocSchemaError).issues).toMatch(/tag/);
  });

  it("refuses to run without a token, and never echoes one", async () => {
    delete process.env.COC_API_TOKEN;
    const error = await request(clanEndpoint("#2PP0JCCL"), anySchema).catch((e) => e);
    expect(error).toBeInstanceOf(CocAuthError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("retry policy", () => {
  it("retries a 429 and then succeeds", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({}, 429, { "retry-after": "0" }))
      .mockResolvedValueOnce(jsonResponse({ tag: "#2PP0JCCL" }));

    const result = await request(clanEndpoint("#2PP0JCCL"), anySchema);

    expect(result).toEqual({ tag: "#2PP0JCCL" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries a 5xx", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({}, 500))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    await request(clanEndpoint("#2PP0JCCL"), anySchema);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  // The rule that matters most: retrying a 403 or 404 cannot succeed, and burns
  // rate limit that a genuinely retryable call will need.
  it("does NOT retry a 403", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, 403));
    await request(clanEndpoint("#2PP0JCCL"), anySchema).catch(() => {});
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does NOT retry a 404", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, 404));
    await request(clanEndpoint("#2PP0JCCL"), anySchema).catch(() => {});
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does NOT retry a schema failure", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ tag: 1 }));
    await request(clanEndpoint("#2PP0JCCL"), z.object({ tag: z.string() })).catch(
      () => {},
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("gives up after 4 attempts and throws the last error", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, 500));
    const error = await request(clanEndpoint("#2PP0JCCL"), anySchema).catch((e) => e);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(error).toBeInstanceOf(CocServerError);
  });

  it("classifies retryable errors correctly", () => {
    expect(isRetryable(new CocRateLimitError("", "/x"))).toBe(true);
    expect(isRetryable(new CocServerError("", "/x"))).toBe(true);
    expect(isRetryable(new CocTimeoutError("/x", 10_000))).toBe(true);
    expect(isRetryable(new CocAuthError("", "/x"))).toBe(false);
    expect(isRetryable(new CocNotFoundError("", "/x"))).toBe(false);
  });
});

describe("throttling", () => {
  // The rule is "200 ms between calls", and the implementation is a serialised
  // queue rather than a sleep inside each call. With a per-call sleep, 150
  // concurrent player lookups would all wait and then fire at once — the exact
  // burst the rule exists to prevent. This asserts they are spaced, not batched.
  it("spaces concurrent requests instead of releasing them together", async () => {
    process.env.COC_THROTTLE_MS = "40";
    const startedAt: number[] = [];
    fetchMock.mockImplementation(() => {
      startedAt.push(Date.now());
      return Promise.resolve(jsonResponse({ ok: true }));
    });

    await Promise.all(
      Array.from({ length: 4 }, () => request(clanEndpoint("#2PP0JCCL"), anySchema)),
    );

    expect(startedAt).toHaveLength(4);
    for (let i = 1; i < startedAt.length; i++) {
      // Allow slack for timer granularity, but a batch would show ~0ms gaps.
      expect(startedAt[i]! - startedAt[i - 1]!).toBeGreaterThanOrEqual(25);
    }
  });
});

describe("timeout", () => {
  it("maps an aborted request to a timeout error", async () => {
    fetchMock.mockImplementation(() => {
      const error = new Error("The operation was aborted.");
      error.name = "AbortError";
      return Promise.reject(error);
    });

    const error = await request(clanEndpoint("#2PP0JCCL"), anySchema).catch((e) => e);
    expect(error).toBeInstanceOf(CocTimeoutError);
    expect((error as Error).message).toMatch(/10000ms/);
  });
});

// T3.3 — the one function that handles a member's secret, and the one exception
// to R1/R6. R8 says the token is verified and discarded: never stored, never
// logged, never in an error.
describe("verifyPlayerToken (T3.3, R8)", () => {
  const MEMBER_TOKEN = "abc123-secret-member-token";

  it("returns true when Supercell says ok", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ status: "ok" }));
    await expect(verifyPlayerToken("#PY0LQGRJ", MEMBER_TOKEN)).resolves.toBe(true);
  });

  it("returns false when Supercell rejects the token", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ status: "invalid" }));
    await expect(verifyPlayerToken("#PY0LQGRJ", MEMBER_TOKEN)).resolves.toBe(false);
  });

  // A mistyped token is an ordinary outcome, not an incident. Throwing here
  // would surface a 403 to the member as though something had broken.
  it("treats a 403 as a wrong token, not a failure", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ reason: "accessDenied" }, 403));
    await expect(verifyPlayerToken("#PY0LQGRJ", MEMBER_TOKEN)).resolves.toBe(false);
  });

  it("POSTs the token to the verifytoken endpoint with an encoded tag", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ status: "ok" }));
    await verifyPlayerToken("#PY0LQGRJ", MEMBER_TOKEN);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain("/players/%23PY0LQGRJ/verifytoken");
    expect(url).not.toContain("#");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ token: MEMBER_TOKEN });
  });

  // R8, asserted rather than asserted-in-a-comment. If a future refactor puts
  // the response body or the request into an error, this fails.
  it("never puts the member's token into an error", async () => {
    for (const status of [400, 500, 503]) {
      fetchMock.mockResolvedValue(
        // A body that echoes the token back, which is the realistic trap.
        jsonResponse({ reason: "bad", token: MEMBER_TOKEN }, status),
      );
      const error = await verifyPlayerToken("#PY0LQGRJ", MEMBER_TOKEN).catch((e) => e);
      const serialised = `${(error as Error).message} ${(error as Error).stack ?? ""}`;
      expect(serialised, `status ${status}`).not.toContain(MEMBER_TOKEN);
    }
  });

  it("never puts the member's token into a timeout error", async () => {
    fetchMock.mockImplementation(() => {
      const error = new Error("aborted");
      error.name = "AbortError";
      return Promise.reject(error);
    });
    const error = await verifyPlayerToken("#PY0LQGRJ", MEMBER_TOKEN).catch((e) => e);
    expect(error).toBeInstanceOf(CocTimeoutError);
    expect((error as Error).message).not.toContain(MEMBER_TOKEN);
  });

  it("refuses to run without the API key rather than calling out", async () => {
    delete process.env.COC_API_TOKEN;
    await expect(verifyPlayerToken("#PY0LQGRJ", MEMBER_TOKEN)).rejects.toBeInstanceOf(
      CocAuthError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("USE_FIXTURES — the offline path (T2.3 done-when)", () => {
  beforeEach(() => {
    process.env.USE_FIXTURES = "true";
    delete process.env.COC_API_TOKEN;
    // If ANY code path reaches the network, this throws and the test fails.
    fetchMock.mockImplementation(() => {
      throw new Error("network was used while USE_FIXTURES=true");
    });
  });

  it("never touches the network", async () => {
    await request(clanEndpoint("#2PP0JCCL"), anySchema).catch(() => {});
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // The fixtures are still `{}` placeholders until T2.1 is run. The client must
  // say that in words, rather than surfacing a confusing schema error.
  it("explains that a fixture is an unfilled placeholder", async () => {
    const error = await request(clanEndpoint("#2PP0JCCL"), anySchema).catch((e) => e);
    expect((error as Error).message).toMatch(/placeholder/i);
    expect((error as Error).message).toMatch(/fixtures:capture/);
  });

  it("maps each endpoint to a fixture file", async () => {
    // A mapped-but-empty fixture reports "placeholder"; an unmapped endpoint
    // reports "no fixture". Both are CocFixtureError, so the message separates them.
    for (const endpoint of [
      clanEndpoint("#2PP0JCCL"),
      currentWarEndpoint("#2PP0JCCL"),
      cwlGroupEndpoint("#2PP0JCCL"),
      cwlWarEndpoint("#8G9QRVJL"),
      playerEndpoint("#PY0LQGRJ"),
      capitalRaidsEndpoint("#2PP0JCCL"),
    ]) {
      const error = await request(endpoint, anySchema).catch((e) => e);
      expect((error as Error).message, endpoint).toMatch(/placeholder/i);
    }
  });

  it("reports an unmapped endpoint distinctly", async () => {
    const error = await request("/something/unmapped", anySchema).catch((e) => e);
    expect((error as Error).message).toMatch(/no fixture is mapped/i);
  });
});
