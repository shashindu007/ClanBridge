// What the app says back after you do something.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY THE CODES AND THE SENTENCES LIVE TOGETHER
//
// A mutation in this product is a <form> posting to a Server Action, which ends
// in `redirect(here + "?error=" + code)` or, from now on, "?ok=" + code. The
// page then renders that code as a sentence.
//
// Those sentences were written inline, per page. admin/page.tsx carried a
// ten-deep nested ternary translating `bad-tag`, `duplicate`, `forbidden`,
// `rate-limited` and the rest, and every other page that redirected with an
// error either repeated the wording or showed the raw code. The result was that
// the same failure read differently depending on which page you were standing
// on, and a new action's code showed up as a hyphenated slug until somebody
// remembered to add a branch for it.
//
// So: one map, read by the toast that renders it and named by the actions that
// set it.
//
// AN UNKNOWN CODE IS SHOWN AS ITSELF, deliberately, rather than swallowed into
// "something went wrong". admin already relied on that for dispatchWorkflow's
// `detail`, and roster's double-booking guard passes through a message naming
// the clashing clan — "Already in the DH v2 roster" is actionable in a way no
// generic sentence is. A slug leaking to a member is a bug; a sentence this
// project wrote reaching them unchanged is the feature.
// ─────────────────────────────────────────────────────────────────────────────

/** Something finished. Green, and gone in a few seconds. */
export const OK_MESSAGES: Record<string, string> = {
  // Roster building (T4B.7). These fire in bursts — a leader assigns twenty
  // players in a row — so they are short by design. A sentence you read once is
  // a sentence you resent on the twentieth repeat.
  "roster-added": "Added to the roster.",
  "roster-dropped": "Removed from the roster.",
  "roster-published": "Roster published — members can see it now.",
  "roster-unpublished": "Back to draft. Members can no longer see it.",
  "roster-started": "Roster started for this season.",

  // War (Phase 6).
  "lineup-started": "Lineup started. Add players to it.",
  "lineup-added": "Added to the lineup.",
  "lineup-removed": "Removed from the lineup.",
  "lineup-published": "Lineup published. Everyone in the clan can see it now.",
  "lineup-unpublished": "Back to draft. Members can no longer see it.",
  "lineup-linked": "Lineup linked to the war.",
  "target-assigned": "Target assigned.",
  "target-cleared": "Target cleared.",
  "target-claimed": "Base claimed. It is yours unless leadership reassigns it.",
  "target-released": "Base released. Anyone can claim it now.",

  // Polls (Phase 4B).
  "poll-opened": "Poll is open. Members can answer it now.",
  "poll-answered": "Answer recorded.",
  "poll-closed": "Poll closed.",

  // Announcements (Phase 5).
  "notice-posted": "Announcement posted.",
  // togglePin sends this for both directions: the page it returns to shows
  // the current state plainly, so naming which way it went adds nothing.
  "notice-pinned": "Pin updated.",
  "notice-removed": "Announcement removed.",

  // CWL bonus medals (T4.7).
  "bonus-awarded": "Bonus recorded.",

  // Base layouts (Phase 8).
  voted: "Vote counted.",
  unvoted: "Vote withdrawn.",
  "layout-removed": "Layout removed.",

  // Account and settings (Phase 10).
  "username-saved": "Username saved.",
  "password-saved": "Password changed.",
  "notifications-saved": "Notification settings saved.",

  // Admin.
  "clan-added": "Clan added. The next sync fills in its details.",
  "member-updated": "Account updated.",
  // T10.8d — set by dispatchWorkflow when GitHub accepts the run.
  dispatched: "Sync started. It takes a minute or two to show up.",
};

/**
 * Something failed.
 *
 * Lifted from the nested ternary that lived in admin/page.tsx, so the wording
 * that was already carefully written survives rather than being paraphrased.
 */
export const ERROR_MESSAGES: Record<string, string> = {
  "bad-tag":
    "That is not a valid clan tag. Tags start with # and never contain the letter O — what looks like an O is a zero.",
  duplicate: "That clan has already been added.",
  "not-owner":
    "This account is not the configured owner. Set OWNER_EMAIL to the address you sign in with.",
  "no-name": "Give the clan a name.",
  forbidden: "You do not have permission to do that.",
  "unknown-job": "That is not a job that can be started by hand.",
  "unknown-action": "That is not something this page can do.",
  // /roster. The page used to render these itself from its own table; the toast
  // already shows every ?error=, so the page said the same thing twice.
  "bad-season": "Pick this month or next month from the list.",
  "not-leadership": "Only clan leadership can start a season.",
  "rate-limited":
    "Too many manual runs. A sync is a repair, not a routine — wait an hour.",
  "claim-failed":
    "The ownership claim was refused. Either this platform already has an admin, or something went wrong — check the server log.",
  "add-clan-failed": "Could not add that clan. Check the server log for why.",
  "grant-failed":
    "Could not grant you leader of that clan. You need to be the platform admin or already lead it.",
};

/**
 * The sentence for a code, or the code itself when it is already a sentence.
 *
 * @param kind which map to read. Kept explicit rather than merging the two,
 * because a success and a failure can legitimately share a word and the caller
 * always knows which it has.
 */
export function messageFor(kind: "ok" | "error", code: string): string {
  const table = kind === "ok" ? OK_MESSAGES : ERROR_MESSAGES;
  return table[code] ?? code;
}

/**
 * Is this a code we have wording for?
 *
 * Used by the test to hold the two maps and the actions that set them in step;
 * not needed at runtime, where an unknown code is shown as itself.
 */
export function isKnown(kind: "ok" | "error", code: string): boolean {
  return code in (kind === "ok" ? OK_MESSAGES : ERROR_MESSAGES);
}
