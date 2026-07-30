// Generate SYNTHETIC fixtures so the offline path works before a real capture.
//
//   npm run fixtures:seed
//
// These are NOT real API responses. They are shaped from Supercell's documented
// schemas so that USE_FIXTURES=true, the mappers and the sync jobs can all be
// exercised end to end today, without an API key.
//
// Every file carries a `_synthetic` marker. `npm run fixtures:capture` overwrites
// them with real data and validates the result against the schemas, which is the
// step that turns the shapes in coc-schemas.ts from documented into verified.

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const DIR = join(process.cwd(), "fixtures");

/** The marker every synthetic fixture carries, so nothing mistakes one for real data. */
export const SYNTHETIC_MARKER = "_synthetic";

const note =
  "SYNTHETIC — generated from documented API shapes, not captured from Supercell. " +
  "Replace with `npm run fixtures:capture` (T2.1).";

const CLAN_TAG = "#2PP0JCCL";
const OPPONENT_TAG = "#8QUCLJY0";

function member(n: number, role: string, th: number) {
  return {
    tag: `#PY0LQGR${"JCUV0289"[n % 8]}`,
    name: `Player ${String(n + 1).padStart(2, "0")}`,
    role,
    townHallLevel: th,
    expLevel: 180 + n,
    league: { id: 29000022, name: "Legend League" },
    trophies: 5200 - n * 40,
    clanRank: n + 1,
    previousClanRank: n + 1,
    donations: 1200 - n * 90,
    donationsReceived: 800 + n * 60,
  };
}

const members = [
  member(0, "leader", 16),
  member(1, "coLeader", 15),
  member(2, "admin", 15), // Elder on the wire
  member(3, "member", 14),
  member(4, "member", 13),
];

function warMember(n: number, attacked: boolean) {
  const base = {
    tag: members[n]!.tag,
    name: members[n]!.name,
    townhallLevel: members[n]!.townHallLevel, // lowercase 'h' on war endpoints
    mapPosition: n + 1,
    opponentAttacks: 0,
  };
  if (!attacked) return base; // the API OMITS `attacks` entirely — never sends []
  return {
    ...base,
    attacks: [
      {
        attackerTag: members[n]!.tag,
        defenderTag: `#C2V89UG${"LJCUV028"[n % 8]}`,
        stars: 3 - (n % 3),
        destructionPercentage: 100 - n * 7,
        order: n + 1,
        duration: 90 + n,
      },
    ],
  };
}

const FIXTURES: Record<string, unknown> = {
  "clan.json": {
    [SYNTHETIC_MARKER]: note,
    tag: CLAN_TAG,
    name: "Synthetic Clan",
    clanLevel: 18,
    badgeUrls: {
      small: "https://api-assets.clashofclans.com/badges/70/x.png",
      medium: "https://api-assets.clashofclans.com/badges/200/x.png",
    },
    warLeague: { id: 48000012, name: "Crystal League I" },
    // T0.1 — the API reports this, so sync:clans can verify it rather than
    // relying on a one-off manual check.
    isWarLogPublic: true,
    type: "inviteOnly",
    warWins: 142,
    warWinStreak: 3,
    members: members.length,
    memberList: members,
  },

  "currentwar.json": {
    [SYNTHETIC_MARKER]: note,
    state: "inWar",
    teamSize: 5,
    attacksPerMember: 2,
    preparationStartTime: "20260728T060000.000Z",
    startTime: "20260729T060000.000Z",
    endTime: "20260730T060000.000Z",
    clan: {
      tag: CLAN_TAG,
      name: "Synthetic Clan",
      clanLevel: 18,
      attacks: 3,
      stars: 8,
      destructionPercentage: 87.4,
      // Members 3 and 4 have NOT attacked — `attacks` is absent on them, which
      // is what makes missed-attack derivation testable (T4.3).
      members: [warMember(0, true), warMember(1, true), warMember(2, true), warMember(3, false), warMember(4, false)],
    },
    opponent: {
      tag: OPPONENT_TAG,
      name: "Synthetic Opponent",
      clanLevel: 16,
      attacks: 4,
      stars: 6,
      destructionPercentage: 71.2,
      members: [],
    },
  },

  "cwlgroup.json": {
    [SYNTHETIC_MARKER]: note,
    state: "inWar",
    season: "2026-07",
    clans: [
      { tag: CLAN_TAG, name: "Synthetic Clan", clanLevel: 18, members: members.map((m) => ({ tag: m.tag, name: m.name })) },
      { tag: OPPONENT_TAG, name: "Synthetic Opponent", clanLevel: 16, members: [] },
    ],
    rounds: [
      { warTags: ["#8G9QRVJL", "#9CUVPYQ2"] },
      // '#0' is the placeholder for a round that has not started. Fetching one
      // is a guaranteed 404, so the mapper must filter it out.
      { warTags: ["#0", "#0"] },
    ],
  },

  "cwlwar.json": {
    [SYNTHETIC_MARKER]: note,
    state: "warEnded",
    teamSize: 5,
    attacksPerMember: 1,
    preparationStartTime: "20260701T060000.000Z",
    startTime: "20260702T060000.000Z",
    endTime: "20260703T060000.000Z",
    warTag: "#8G9QRVJL",
    clan: {
      tag: CLAN_TAG,
      name: "Synthetic Clan",
      clanLevel: 18,
      attacks: 4,
      stars: 11,
      destructionPercentage: 94.8,
      members: [warMember(0, true), warMember(1, true), warMember(2, true), warMember(3, true), warMember(4, false)],
    },
    opponent: {
      tag: OPPONENT_TAG,
      name: "Synthetic Opponent",
      clanLevel: 17,
      attacks: 5,
      stars: 9,
      destructionPercentage: 88.1,
      members: [],
    },
  },

  "capitalraids.json": {
    [SYNTHETIC_MARKER]: note,
    items: [
      {
        state: "ended",
        startTime: "20260725T070000.000Z",
        endTime: "20260728T070000.000Z",
        capitalTotalLoot: 148000,
        raidsCompleted: 4,
        totalAttacks: 42,
        offensiveReward: 180,
        defensiveReward: 95,
        members: members.map((m, i) => ({
          tag: m.tag,
          name: m.name,
          attacks: 6 - i,
          attackLimit: 5,
          bonusAttackLimit: 1,
          capitalResourcesLooted: 24000 - i * 3000,
        })),
      },
    ],
    paging: {},
  },

  "player.json": {
    [SYNTHETIC_MARKER]: note,
    tag: members[0]!.tag,
    name: members[0]!.name,
    townHallLevel: 16,
    expLevel: 240,
    trophies: 5200,
    warStars: 1420,
    donations: 1200,
    donationsReceived: 800,
    role: "leader",
    clan: { tag: CLAN_TAG, name: "Synthetic Clan" },
    league: { id: 29000022, name: "Legend League" },
    achievements: [
      { name: "Friend in Need", stars: 3, value: 45000, target: 25000, village: "home" },
      // T7.4 differences this value between two snapshots to derive a season score.
      { name: "Games Champion", stars: 1, value: 21000, target: 25000, village: "home" },
      { name: "War Hero", stars: 3, value: 1420, target: 1000, village: "home" },
    ],
  },
};

async function main(): Promise<void> {
  await mkdir(DIR, { recursive: true });

  for (const [file, body] of Object.entries(FIXTURES)) {
    await writeFile(join(DIR, file), `${JSON.stringify(body, null, 2)}\n`, "utf8");
    console.log(`  wrote  ${file}`);
  }

  console.log(
    `\n${Object.keys(FIXTURES).length} SYNTHETIC fixtures written.\n\n` +
      "These are shaped from Supercell's documented schemas, not captured from the\n" +
      "live API. They make the offline path runnable today, but the shapes are\n" +
      "unverified. Replace them as soon as you have a key:\n\n" +
      "  npm run fixtures:capture -- '#YOURCLANTAG'\n\n" +
      "That command validates what it captures against src/integration/coc-schemas.ts\n" +
      "and reports any field where reality disagrees with these assumptions.",
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
