import { describe, expect, it } from "vitest";
import {
  DEFAULT_QUERY,
  availabilityCounts,
  availabilityOf,
  builderSearch,
  filterPool,
  parseBuilderQuery,
  publishedSummary,
  seasonLabel,
  startableSeasons,
  type PoolEntry,
} from "./roster-view";

const CLAN_A = "aaaaaaaa-0000-4000-8000-0000000000a1";
const CLAN_B = "bbbbbbbb-0000-4000-8000-0000000000b1";

const pool: PoolEntry[] = [
  { name: "SK FLASH", tag: "#GJUUGRVCU", clanId: CLAN_A, answer: "In", assignedTo: null },
  { name: "Rap Boy", tag: "#PY0LQGRJ", clanId: CLAN_B, answer: "in", assignedTo: "roster-1" },
  { name: "Shaliya", tag: "#C2V89UGL", clanId: CLAN_A, answer: "Maybe", assignedTo: null },
  { name: "W.A.R", tag: "#L2QYGJ9P", clanId: CLAN_B, answer: null, assignedTo: null },
  { name: "Gone", tag: "#8QUCLJY0", clanId: CLAN_A, answer: "Out", assignedTo: null },
];

describe("availabilityOf", () => {
  it("reads the template's answers case-insensitively", () => {
    expect(availabilityOf("In")).toBe("in");
    expect(availabilityOf(" maybe ")).toBe("maybe");
    expect(availabilityOf("OUT")).toBe("out");
  });

  it("treats no answer and an edited option differently", () => {
    expect(availabilityOf(null)).toBe("none");
    expect(availabilityOf("Only day 1-3")).toBe("other");
  });
});

describe("parseBuilderQuery", () => {
  it("defaults to everyone, picked players hidden", () => {
    expect(parseBuilderQuery({})).toEqual(DEFAULT_QUERY);
  });

  it("drops what it does not recognise, because a hidden field is user input", () => {
    const query = parseBuilderQuery(
      new URLSearchParams("show=everyone&from=not-a-uuid&picked=maybe&q=" + "x".repeat(80)),
    );
    expect(query.show).toBe("all");
    expect(query.from).toBeNull();
    expect(query.picked).toBe("hide");
    expect(query.q).toHaveLength(40);
  });

  it("round-trips through builderSearch, including a # in the clan tag", () => {
    const query = parseBuilderQuery({ clan: "#2G8YQYRGJ", show: "in", q: "flash", from: CLAN_A, picked: "show" });
    expect(parseBuilderQuery(new URLSearchParams(builderSearch(query).slice(1)))).toEqual(query);
    expect(builderSearch(query)).toContain("clan=%232G8YQYRGJ");
  });

  it("writes nothing for the defaults", () => {
    expect(builderSearch(DEFAULT_QUERY)).toBe("");
    expect(builderSearch(DEFAULT_QUERY, { show: "out" })).toBe("?show=out");
  });
});

describe("filterPool", () => {
  it("hides players already picked unless asked to show them", () => {
    expect(filterPool(pool, DEFAULT_QUERY).map((p) => p.name)).not.toContain("Rap Boy");
    expect(filterPool(pool, { ...DEFAULT_QUERY, picked: "show" }).map((p) => p.name)).toContain("Rap Boy");
  });

  it("filters by availability and by current clan", () => {
    expect(filterPool(pool, { ...DEFAULT_QUERY, show: "none" }).map((p) => p.name)).toEqual(["W.A.R"]);
    expect(filterPool(pool, { ...DEFAULT_QUERY, from: CLAN_A }).map((p) => p.name)).toEqual([
      "SK FLASH",
      "Shaliya",
      "Gone",
    ]);
  });

  it("searches names and tags, with or without the #", () => {
    expect(filterPool(pool, { ...DEFAULT_QUERY, q: "flash" }).map((p) => p.name)).toEqual(["SK FLASH"]);
    expect(filterPool(pool, { ...DEFAULT_QUERY, q: "#c2v8" }).map((p) => p.name)).toEqual(["Shaliya"]);
    expect(filterPool(pool, { ...DEFAULT_QUERY, q: "c2v8" }).map((p) => p.name)).toEqual(["Shaliya"]);
  });
});

describe("availabilityCounts", () => {
  it("counts what each chip would show under the other filters", () => {
    expect(availabilityCounts(pool, DEFAULT_QUERY)).toEqual({ all: 4, in: 1, maybe: 1, none: 1, out: 1 });
    expect(availabilityCounts(pool, { ...DEFAULT_QUERY, from: CLAN_B })).toEqual({
      all: 1,
      in: 0,
      maybe: 0,
      none: 1,
      out: 0,
    });
  });
});

describe("seasons", () => {
  it("names a season as a month", () => {
    expect(seasonLabel("2026-09")).toBe("September 2026");
    expect(seasonLabel("2026-13")).toBe("2026-13");
    expect(seasonLabel("next")).toBe("next");
  });

  it("offers this month and next, across a year boundary", () => {
    expect(startableSeasons(new Date("2026-12-31T23:00:00Z"))).toEqual(["2026-12", "2027-01"]);
  });
});

describe("publishedSummary", () => {
  it.each([
    [0, 0, "No lineups"],
    [0, 1, "Draft, not published yet"],
    [0, 4, "4 drafts, none published yet"],
    [1, 4, "1 of 4 published"],
    [4, 4, "All 4 published"],
    [1, 1, "Published"],
  ])("%i of %i → %s", (published, total, text) => {
    expect(publishedSummary(published, total)).toBe(text);
  });
});
