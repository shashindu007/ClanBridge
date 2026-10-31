// A title for every page, from its path.
//
// Only four pages ever set one, so every tab and history entry read "ClanBridge".
// It matters more for a screen reader: Next announces a client navigation by
// reading the new title, so with one title for the whole app it announced nothing,
// and moving between pages was silent.
//
// One function rather than a metadata export on sixty pages, because most of these
// are one word. A page that has more to say still exports its own, and that wins.

const TOP_LEVEL: Record<string, string> = {
  dashboard: "Home",
  notifications: "Notifications",
  people: "People",
  search: "Search",
  feedback: "Feedback",
  guide: "Guide",
  pending: "Waiting for approval",
  account: "Your bases",
  roster: "CWL lineups",
  rating: "Player rating",
  admin: "Admin",
  settings: "Settings",
};

const SUB_PAGES: Record<string, string> = {
  "settings/account": "Sign-in and password",
  "settings/notifications": "Notification settings",
  "account/setup": "Finish your account",
  "admin/members": "Accounts",
  "admin/audit": "Audit log",
  "admin/feedback": "Feedback received",
  "rating/donations": "Season donations",
  "rating/war": "War rating",
  "rating/cwl": "CWL rating",
  "rating/games": "Clan Games rating",
  "rating/raids": "Raids rating",
};

const CLAN_SECTIONS: Record<string, string> = {
  members: "Members",
  player: "Player",
  war: "War",
  cwl: "CWL",
  raids: "Raids",
  games: "Clan Games",
  polls: "Polls",
  notices: "Notices",
  layouts: "Bases",
};

const WAR_PAGES: Record<string, string> = {
  lineup: "War lineup",
  history: "War history",
  report: "War report",
  rating: "War rating",
};

/** The page's own title, or null to fall back to the product name. */
export function pageTitle(pathname: string | null | undefined): string | null {
  const parts = (pathname ?? "").split("/").filter(Boolean);
  const [first, second, third] = parts;
  if (!first) return null;

  if (first in TOP_LEVEL && Object.hasOwn(TOP_LEVEL, first)) {
    const key = `${first}/${second ?? ""}`;
    return Object.hasOwn(SUB_PAGES, key) ? SUB_PAGES[key]! : TOP_LEVEL[first]!;
  }

  // Everything else is /[clanTag]/...
  if (!second) return "Clan";
  if (second === "war" && third && Object.hasOwn(WAR_PAGES, third)) return WAR_PAGES[third]!;
  return Object.hasOwn(CLAN_SECTIONS, second) ? CLAN_SECTIONS[second]! : "Clan";
}
