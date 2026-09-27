import { describe, expect, it } from "vitest";
import {
  DEFAULT_QUERY,
  availabilityCounts,
  availabilityOf,
  builderSearch,
  lineupDeadline,
  filterPool,
  parseBuilderQuery,
  publishedSummary,
  seasonLabel,
  startableSeasons,
  lineupFocusSeason,
  nextSeason,
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

  it("keeps the Add players dialog open across a redirect, and only for pick=1", () => {
    const open = parseBuilderQuery({ pick: "1", show: "in" });
    expect(open.pick).toBe(true);
    expect(builderSearch(open)).toContain("pick=1");
    expect(parseBuilderQuery(new URLSearchParams(builderSearch(open).slice(1)))).toEqual(open);
    expect(parseBuilderQuery({ pick: "yes" }).pick).toBe(false);
    expect(builderSearch(open, { pick: false })).not.toContain("pick");
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

  it("offers the focus season and the one after, across a year boundary", () => {
    // December's CWL is long over on the 31st, so January leads.
    expect(startableSeasons(new Date("2026-12-31T23:00:00Z"))).toEqual(["2027-01", "2027-02"]);
    // During December's war week, December is still the one to work on.
    expect(startableSeasons(new Date("2026-12-05T12:00:00Z"))).toEqual(["2026-12", "2027-01"]);
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

describe("lineupDeadline", () => {
  it("is the start of the 2nd of the season's month, Sri Lanka time", () => {
    // 00:00 on 2 Oct in Colombo (UTC+05:30) is 18:30 UTC on 1 Oct.
    expect(lineupDeadline("2026-10")?.toISOString()).toBe("2026-10-01T18:30:00.000Z");
  });

  it("refuses anything that is not a season key", () => {
    expect(lineupDeadline("October")).toBeNull();
  });
});

describe("lineupFocusSeason", () => {
  it("moves to next month once this month's CWL is over", () => {
    expect(lineupFocusSeason(new Date("2026-09-27T10:00:00Z"))).toBe("2026-10");
  });

  it("stays on this month while its CWL is running", () => {
    expect(lineupFocusSeason(new Date("2026-10-05T10:00:00Z"))).toBe("2026-10");
  });

  it("rolls the year", () => {
    expect(nextSeason("2026-12")).toBe("2027-01");
  });
});
