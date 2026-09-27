// Home's newer halves: which base is "main", the cross-clan announcement feed,
// and the "3h ago" wording both of them lean on.

import { describe, expect, it } from "vitest";
import { announcementFeed, mainBase, timeAgo, type FeedNotice, type MainBaseCandidate } from "@/services/home";

function base(over: Partial<MainBaseCandidate> = {}): MainBaseCandidate {
  return {
    tag: "#A",
    nickname: null,
    thLevel: 15,
    verified: false,
    clanId: "c1",
    leftAt: null,
    ...over,
  };
}

describe("mainBase", () => {
  it("is null with no bases", () => {
    expect(mainBase([])).toBeNull();
  });

  it("takes a base the member labelled main, whatever its Town Hall", () => {
    const labelled = base({ tag: "#B", nickname: "Main account", thLevel: 12 });
    expect(mainBase([base({ thLevel: 17 }), labelled])).toBe(labelled);
  });

  it("does not read 'mainly' or 'domain' as main", () => {
    const high = base({ tag: "#H", thLevel: 17 });
    expect(mainBase([base({ tag: "#M", nickname: "mainly farming", thLevel: 9 }), high])).toBe(high);
  });

  it("otherwise takes the highest Town Hall still playing in a clan here", () => {
    const left = base({ tag: "#L", thLevel: 18, leftAt: "2026-09-01T00:00:00Z" });
    const playing = base({ tag: "#P", thLevel: 16 });
    expect(mainBase([left, playing])).toBe(playing);
  });

  it("falls back to the highest Town Hall when none is playing here", () => {
    const a = base({ tag: "#A", thLevel: 11, clanId: null });
    const b = base({ tag: "#B", thLevel: 14, clanId: null });
    expect(mainBase([a, b])).toBe(b);
  });

  it("breaks a tie on verified, then keeps the list's order", () => {
    const first = base({ tag: "#1", thLevel: 16 });
    const verified = base({ tag: "#2", thLevel: 16, verified: true });
    const third = base({ tag: "#3", thLevel: 16 });
    expect(mainBase([first, verified, third])).toBe(verified);
    expect(mainBase([first, third])).toBe(first);
  });
});

function notice(id: string, createdAt: string, over: Partial<FeedNotice> = {}): FeedNotice {
  return {
    id,
    title: id,
    body: "",
    pinned: false,
    createdAt,
    clanId: "c1",
    clanTag: "#C1",
    clanName: "Dark Hell",
    ...over,
  };
}

describe("announcementFeed", () => {
  it("is newest first across clans, and a pin does not hold the top", () => {
    const feed = announcementFeed([
      notice("old-pin", "2026-08-01T00:00:00Z", { pinned: true }),
      notice("today", "2026-09-27T08:00:00+00:00", { clanId: "c2" }),
      notice("yesterday", "2026-09-26T08:00:00Z"),
    ]);
    expect(feed.map((n) => n.id)).toEqual(["today", "yesterday", "old-pin"]);
  });

  it("keeps only the first few", () => {
    const many = Array.from({ length: 9 }, (_, i) => notice(`n${i}`, `2026-09-0${i + 1}T00:00:00Z`));
    expect(announcementFeed(many)).toHaveLength(4);
    expect(announcementFeed(many, 2).map((n) => n.id)).toEqual(["n8", "n7"]);
  });
});

describe("timeAgo", () => {
  const now = new Date("2026-09-27T12:00:00Z");

  it("says it in the fewest words", () => {
    expect(timeAgo("2026-09-27T11:59:40Z", now)).toBe("just now");
    expect(timeAgo("2026-09-27T11:20:00Z", now)).toBe("40m ago");
    expect(timeAgo("2026-09-27T07:00:00Z", now)).toBe("5h ago");
    expect(timeAgo("2026-09-24T12:00:00Z", now)).toBe("3d ago");
  });

  it("gives a date past a week, and nothing for garbage", () => {
    // "Sep" or "Sept", depending on the runtime's ICU data.
    expect(timeAgo("2026-09-12T06:00:00Z", now)).toMatch(/^12 Sept?$/);
    expect(timeAgo("nonsense", now)).toBe("");
  });
});
