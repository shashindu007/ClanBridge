// /rating, rendered with the stored rows handed in.
//
// repositories/player-ratings.ts is covered against real Postgres in
// family-ratings.test.ts. This is what the page does with what comes back, and
// the part that matters most is the links: the ranking holds every clan, and a
// player's profile is a 404 in a clan the viewer is not in.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { RatedPlayer } from "@/repositories/player-ratings";

const CLAN_A = "aaaaaaaa-0000-4000-8000-000000000001";
const CLAN_B = "bbbbbbbb-0000-4000-8000-000000000001";

const mocks = vi.hoisted(() => ({
  months: vi.fn(),
  ratings: vi.fn(),
  clans: vi.fn(),
  bases: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
vi.mock("@/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth")>()),
  currentUserId: async () => "user-1",
}));
vi.mock("@/lib/clans", () => ({ visibleClans: mocks.clans }));
vi.mock("@/repositories/account-bases", () => ({ basesForUser: mocks.bases }));
vi.mock("@/repositories/player-ratings", () => ({
  ratingMonths: mocks.months,
  familyRatings: mocks.ratings,
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect ${to}`);
  },
  usePathname: () => "/rating",
}));

const { default: PlayerRatingPage } = await import("@/app/(app)/rating/page");

const none = { donations: 0, war: 0, cwl: 0, games: 0, raids: 0 };

function player(over: Partial<RatedPlayer>): RatedPlayer {
  return {
    playerId: "p",
    clanId: CLAN_A,
    clanTag: "#2PP0JCCL",
    clanName: "Dark Hell",
    tag: "#PY0LQGRJ",
    name: "Ann",
    thLevel: 16,
    marks: { ...none, donations: 10 },
    shares: { ...none, donations: 0.5 },
    rating: 0.1,
    computedAt: "2026-10-31T06:02:00Z",
    familyRank: 2,
    familySize: 2,
    tied: false,
    clanRank: 1,
    clanSize: 1,
    ratedPlayers: 2,
    ...over,
  };
}

const ann = player({ playerId: "ann" });
const ben = player({
  familyRank: 1,
  playerId: "ben",
  clanId: CLAN_B,
  clanTag: "#20PP0JCC",
  clanName: "DH CWL ONLY",
  tag: "#C2V89UGL",
  name: "Ben",
  marks: { ...none, donations: -2, war: 5 },
  shares: { ...none, donations: -0.1, war: 2.5 },
  rating: 0.48,
});

async function render(search: { clan?: string; month?: string; q?: string | string[] } = {}): Promise<string> {
  return renderToStaticMarkup(await PlayerRatingPage({ searchParams: Promise.resolve(search) }));
}

describe("the Player rating page", () => {
  beforeEach(() => {
    mocks.clans.mockResolvedValue([
      { id: CLAN_A, tag: "#2PP0JCCL", name: "Dark Hell", badgeUrl: null, role: "member" },
    ]);
    mocks.months.mockResolvedValue(["2026-10", "2026-09"]);
    mocks.ratings.mockResolvedValue([ben, ann]);
    mocks.bases.mockResolvedValue([]);
  });

  it("shows the database's rank, so two tied players get the same number", async () => {
    mocks.ratings.mockResolvedValue([
      player({ playerId: "a", name: "Ann", familyRank: 4, tied: true }),
      player({ playerId: "b", name: "Bob", familyRank: 4, tied: true, tag: "#C2V89UGL" }),
      player({ playerId: "c", name: "Cat", familyRank: 6, tag: "#L2QYGJ9P" }),
    ]);
    const html = await render();

    expect(html.match(/>4<\/span>/g)).toHaveLength(2);
    expect(html).toContain(">6</span>");
    expect(html).not.toContain(">5</span>");
    expect(html.match(/Tied/g)).toHaveLength(2);
  });

  it("gives no medal to a place with no marks behind it", async () => {
    mocks.ratings.mockResolvedValue([player({ familyRank: 1, marks: none, rating: 0 })]);
    const html = await render();
    expect(html).not.toContain("data-tier");
    // Nor a place on the podium.
    expect(html).not.toContain("Top of the ranking");
  });

  it("stands the top three on a podium, which a search takes away", async () => {
    const html = await render();
    expect(html).toContain('aria-label="Top of the ranking"');
    expect(html).toContain('data-place="1"');
    expect(html).toContain('data-place="2"');
    // Still a link only where the profile is open to this viewer.
    expect(html).not.toContain(`/player/${encodeURIComponent("#C2V89UGL")}`);

    expect(await render({ q: "ann" })).not.toContain("Top of the ranking");
  });

  it("puts one clan's own top three on the podium, saying the family rank in words", async () => {
    mocks.ratings.mockResolvedValue([player({ playerId: "ann", familyRank: 7, clanRank: 1, clanSize: 3 })]);
    const html = await render({ clan: "#2PP0JCCL" });
    expect(html).toContain('data-place="1"');
    expect(html).toContain("#7 of 2 in the family");
  });

  it("fades a section nobody has marks in yet, and keeps its column", async () => {
    const html = await render();
    expect(html).toContain("Nothing counted yet this month");
    expect(html).toContain('data-label="CWL"');
  });

  it("keeps the family rank when one clan is shown, and says the clan place in words", async () => {
    mocks.ratings.mockResolvedValue([
      ben,
      player({ playerId: "ann", familyRank: 7, clanRank: 2, clanSize: 3 }),
    ]);
    const html = await render({ clan: "#2PP0JCCL" });

    expect(html).toContain(">7</span>");
    expect(html).toContain("#2 of 3 in Dark Hell");
  });

  it("finds a player by name or tag without renumbering anyone", async () => {
    const byName = await render({ q: "ann" });
    expect(byName).toContain(">2</span>");
    expect(byName).not.toContain("Ben");

    expect(await render({ q: "#C2V" })).toContain("Ben");
    expect(await render({ q: ["ann", "ben"] })).not.toContain("Ben");
  });

  it("says when a search finds nobody", async () => {
    const html = await render({ q: "zzz" });
    expect(html).toContain("No player matches");
    expect(html).toContain("Show everyone");
  });

  it("marks your own villages, and links each to its row", async () => {
    mocks.bases.mockResolvedValue([{ playerId: "ann", tag: "#PY0LQGRJ" }]);
    const html = await render();

    expect(html).toContain("Your rank");
    expect(html).toContain("#2 of 2 in the family");
    expect(html).toContain('href="/rating#rank-PY0LQGRJ"');
    expect(html).toContain('id="rank-PY0LQGRJ"');
    expect(html).toContain(">You<");
  });

  it("leaves Your rank out for someone with no village in the month", async () => {
    expect(await render()).not.toContain("Your rank");
  });

  it("says whether the month is final", async () => {
    expect(await render({ month: "2026-09" })).toContain("final");
  });

  it("shows every clan's players, each section's weight, and the rating", async () => {
    const html = await render();

    expect(html).toContain("Ann");
    expect(html).toContain("Ben");
    expect(html).toContain("DH CWL ONLY");
    expect(html).toContain("October 2026");
    expect(html).toContain("0.50%");
    expect(html).toContain("0.48%");
    expect(html).toContain("+10.00");
    expect(html).toContain("−0.10%");
    for (const weight of ["20%", "30%", "10%"]) expect(html).toContain(weight);
  });

  it("links a player only in a clan the viewer belongs to", async () => {
    const html = await render();

    expect(html).toContain(`href="/${encodeURIComponent("#2PP0JCCL")}/player/${encodeURIComponent("#PY0LQGRJ")}"`);
    expect(html).not.toContain(`/player/${encodeURIComponent("#C2V89UGL")}`);
  });

  it("says which sections have nothing counted yet", async () => {
    const html = await render();
    expect(html).toContain("Nothing counted yet for CWL, Clan Games, Raids.");
  });

  it("narrows to one clan, and ignores a tag it does not know", async () => {
    expect(await render({ clan: "#2PP0JCCL" })).not.toContain("Ben");
    expect(await render({ clan: "#NOPE" })).toContain("Ben");
  });

  it("reads the month asked for, and falls back to the latest", async () => {
    await render({ month: "2026-09" });
    expect(mocks.ratings).toHaveBeenLastCalledWith(expect.anything(), "2026-09");

    await render({ month: "1999-01" });
    expect(mocks.ratings).toHaveBeenLastCalledWith(expect.anything(), "2026-10");
  });

  it("prints the donation rule from the constants", async () => {
    const html = await render();
    expect(html).toContain("Every 1,000 donated in the family");
    expect(html).toContain("Every 2,000 received");
    expect(html).toContain("Every 2,000 donated in other clans");
  });

  it("says so before the first ranking exists", async () => {
    mocks.months.mockResolvedValue([]);
    const html = await render();

    expect(html).toContain("No ranking yet");
    expect(mocks.ratings).not.toHaveBeenCalledWith(expect.anything(), undefined);
  });

  it("does not offer a ranking to an account in no clan", async () => {
    mocks.clans.mockResolvedValue([]);
    expect(await render()).toContain("You are not in a clan yet");
  });
});
