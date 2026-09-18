// The directory's URL state.
//
// The reason this file exists is the round-trip block at the bottom. Before
// members-view.ts the page built its query string in two places — the column
// links and the departed toggle — and each knew about a different subset of the
// state. Adding a search term to that arrangement means every sort click drops
// it, silently, and the page still renders. Nothing about that failure is
// visible in a diff, so it is asserted here instead.

import { describe, expect, it } from "vitest";
import {
  DEFAULT_QUERY,
  filterMembers,
  memberSearch,
  parseMemberQuery,
  sortsFor,
  SORTS,
  type MemberQuery,
} from "@/lib/members-view";

describe("sortsFor", () => {
  it("gives a member every column", () => {
    expect(Object.keys(sortsFor("member"))).toEqual(Object.keys(SORTS));
    expect(Object.keys(sortsFor("elder"))).toEqual(Object.keys(SORTS));
    expect(Object.keys(sortsFor("leadership"))).toEqual(Object.keys(SORTS));
  });

  it("gives a visitor only the columns they can see", () => {
    expect(Object.keys(sortsFor("visitor"))).toEqual(["name", "role", "th"]);
  });

  it("never offers a visitor a donation column", () => {
    const visitor = sortsFor("visitor");
    for (const key of ["trophies", "given", "received", "ratio", "activity"]) {
      expect(visitor).not.toHaveProperty(key);
    }
  });
});

describe("parseMemberQuery", () => {
  it("defaults everything when the URL is empty", () => {
    expect(parseMemberQuery({}, "member")).toEqual(DEFAULT_QUERY);
  });

  it("reads a valid sort and direction", () => {
    expect(parseMemberQuery({ sort: "ratio", dir: "desc" }, "member")).toMatchObject({
      sort: "ratio",
      dir: "desc",
    });
  });

  it("falls back to name for a sort that is not a column", () => {
    expect(parseMemberQuery({ sort: "password" }, "member").sort).toBe("name");
  });

  // The hand-edited URL. A visitor has no Ratio column on screen, so sorting by
  // it would order a list by a figure they may not read.
  it("folds a visitor's out-of-tier sort back to name", () => {
    expect(parseMemberQuery({ sort: "ratio" }, "visitor").sort).toBe("name");
    expect(parseMemberQuery({ sort: "th" }, "visitor").sort).toBe("th");
  });

  it("treats any direction but desc as ascending", () => {
    expect(parseMemberQuery({ dir: "sideways" }, "member").dir).toBe("asc");
  });

  it("treats departed as the literal 1 and nothing else", () => {
    expect(parseMemberQuery({ departed: "1" }, "member").departed).toBe(true);
    expect(parseMemberQuery({ departed: "true" }, "member").departed).toBe(false);
  });

  it("trims the term and caps it at 40 characters", () => {
    expect(parseMemberQuery({ q: "  sk flash  " }, "member").q).toBe("sk flash");
    expect(parseMemberQuery({ q: "x".repeat(200) }, "member").q).toHaveLength(40);
  });

  it("takes the first value when a param is repeated", () => {
    expect(parseMemberQuery({ q: ["one", "two"] }, "member").q).toBe("one");
  });

  it("reads a URLSearchParams as well as a params object", () => {
    const params = new URLSearchParams("sort=th&dir=desc&q=flash&departed=1");
    expect(parseMemberQuery(params, "member")).toEqual({
      sort: "th",
      dir: "desc",
      departed: true,
      q: "flash",
    });
  });
});

describe("memberSearch", () => {
  it("is empty when nothing differs from the default", () => {
    expect(memberSearch(DEFAULT_QUERY)).toBe("");
  });

  it("omits defaults rather than spelling them out", () => {
    expect(memberSearch({ ...DEFAULT_QUERY, sort: "ratio" })).toBe("?sort=ratio");
  });

  it("applies overrides on top of the current query", () => {
    const q: MemberQuery = { sort: "name", dir: "asc", departed: false, q: "flash" };
    expect(memberSearch(q, { sort: "th", dir: "desc" })).toBe("?sort=th&dir=desc&q=flash");
  });

  it("encodes a term with a space or a hash", () => {
    const built = memberSearch({ ...DEFAULT_QUERY, q: "#2PP0 JCCL" });
    expect(built).toContain("q=");
    expect(new URLSearchParams(built.slice(1)).get("q")).toBe("#2PP0 JCCL");
  });
});

// ── The regression this module was written for ───────────────────────────────

describe("state survives every link on the page", () => {
  const searching: MemberQuery = {
    sort: "name",
    dir: "asc",
    departed: false,
    q: "flash",
  };

  it("keeps the search term through a column-header click", () => {
    // The old link() rebuilt the query from sort + dir + departed and had never
    // heard of q, so one sort click threw the search away.
    const href = memberSearch(searching, { sort: "ratio", dir: "desc" });
    expect(new URLSearchParams(href.slice(1)).get("q")).toBe("flash");
  });

  it("keeps the search term through the departed toggle", () => {
    const href = memberSearch(searching, { departed: true });
    const params = new URLSearchParams(href.slice(1));
    expect(params.get("q")).toBe("flash");
    expect(params.get("departed")).toBe("1");
  });

  it("keeps the sort and the toggle through a search", () => {
    // The mirror image: the search FORM must re-emit the rest as hidden fields.
    // This asserts the values it has to carry.
    const sorted: MemberQuery = { sort: "given", dir: "desc", departed: true, q: "" };
    const params = new URLSearchParams(memberSearch(sorted, { q: "sk" }).slice(1));
    expect(params.get("sort")).toBe("given");
    expect(params.get("dir")).toBe("desc");
    expect(params.get("departed")).toBe("1");
    expect(params.get("q")).toBe("sk");
  });

  it("round-trips through parse and back unchanged", () => {
    const original: MemberQuery = { sort: "ratio", dir: "desc", departed: true, q: "flash" };
    const parsed = parseMemberQuery(new URLSearchParams(memberSearch(original).slice(1)), "member");
    expect(parsed).toEqual(original);
  });
});

describe("filterMembers", () => {
  const rows = [
    { name: "SK FLASH", tag: "#PY0LQGRJ" },
    { name: "Shashi", tag: "#2PP0JCCL" },
    { name: "Quiet One", tag: "#9VUYQ8C2" },
  ];

  it("returns everything for an empty term", () => {
    expect(filterMembers(rows, "")).toHaveLength(3);
    expect(filterMembers(rows, "   ")).toHaveLength(3);
  });

  it("matches part of a name, case-insensitively", () => {
    expect(filterMembers(rows, "flash").map((r) => r.name)).toEqual(["SK FLASH"]);
    expect(filterMembers(rows, "SHASH").map((r) => r.name)).toEqual(["Shashi"]);
  });

  it("matches part of a tag", () => {
    expect(filterMembers(rows, "2pp0").map((r) => r.name)).toEqual(["Shashi"]);
  });

  it("matches a full tag pasted with its hash", () => {
    expect(filterMembers(rows, "#PY0LQGRJ").map((r) => r.name)).toEqual(["SK FLASH"]);
  });

  it("matches a tag typed without its hash", () => {
    expect(filterMembers(rows, "py0lqgrj").map((r) => r.name)).toEqual(["SK FLASH"]);
  });

  it("returns nothing when nothing matches", () => {
    expect(filterMembers(rows, "nobody")).toEqual([]);
  });

  it("preserves the order it was given", () => {
    // The caller sorts before filtering, so a filter that reordered would undo it.
    expect(filterMembers(rows, "").map((r) => r.name)).toEqual([
      "SK FLASH",
      "Shashi",
      "Quiet One",
    ]);
  });

  // filterMembers works on a list the caller already holds, so there is no SQL
  // to inject and no LIKE to escape — but a term full of metacharacters must
  // still behave like a search for those characters rather than like a wildcard.
  it("treats a percent sign as an ordinary character", () => {
    const odd = [{ name: "100% effort", tag: "#AAA" }, { name: "Shashi", tag: "#BBB" }];
    expect(filterMembers(odd, "%").map((r) => r.name)).toEqual(["100% effort"]);
  });
});
