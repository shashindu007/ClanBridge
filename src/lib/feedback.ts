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
  "bonus-awarded": "Medal awarded.",
  "bonus-withdrawn": "Medal taken back.",

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

  // Managing accounts after approval (T12.2) and the notification feed (T12.3).
  "message-sent": "Message sent. It is in their notifications now.",
  // Says what actually happened rather than "Account deleted": R4 keeps the
  // row, and the member sees a page explaining they were removed.
  "account-removed": "Access removed. Their clan roles are revoked and the reason is on the record.",
  "account-restored": "Account restored. It is back in the approval queue and needs approving again.",
  "notifications-cleared": "All caught up.",

  // Member feedback (T12.5).
  "feedback-sent": "Thank you. The platform owner will read it.",
  "feedback-approved": "Approved. It is on the public home page now.",
  "feedback-hidden": "Kept private. It will not appear on the home page.",

  // Clan roles (T12.9).
  "role-updated": "Role saved. It takes effect on their next page load.",
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
  // CWL report.
  "bad-order": "The medal place must be a whole number, 1 or more.",
  // Create poll.
  "no-title": "Give the poll a title so members know what they are answering.",
  "need-options": "A poll needs at least two answers to choose from.",
  "duplicate-options": "Two answers have the same wording, which makes the result unreadable.",
  "bad-type": "That kind of poll is not one this system knows.",
  // Poll page. Rendered by the page itself until the redesign; the toast is now the one place.
  incomplete: "Pick an answer before saving.",
  closed: "This poll has closed, so there is nothing to remind anyone about.",
  // War board: an assign or claim with no base chosen, or one outside the war.
  "pick-a-base": "Choose a base from the list first.",
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

  // Managing accounts after approval (T12.2). Every one of these is the
  // database having refused, and none of them names which check said no — the
  // difference between "no such account" and "not yours to touch" is precisely
  // what somebody probing this screen wants to learn.
  "no-subject": "Give the message a subject so they know what it is about.",
  "no-body": "Write the message before sending it.",
  "message-too-long": "That message is too long. Keep it under 2000 characters.",
  "send-failed":
    "That message was not sent. You can only write to accounts in a clan you lead.",
  "remove-refused":
    "The database refused that. You can only remove accounts in a clan you lead, you cannot remove your own, and the platform owner's account can never be removed.",
  "restore-refused":
    "The database refused that. Either that account was not removed, or it is not one you administer.",
  "no-reason": "Say why you are removing this account. It goes on the record.",

  // Member feedback (T12.5).
  "feedback-no-rating": "Pick a rating from one to five stars.",
  "feedback-too-short": "Write a little more — at least 10 characters.",
  "feedback-too-long": "That is too long. Keep it under 500 characters.",
  "feedback-refused": "That was not sent. Only approved members can send feedback.",
  "bad-request": "Something was missing from that request.",

  // Clan roles (T12.9). One sentence for every refusal, naming the rules
  // rather than which one said no.
  "role-refused":
    "That role was not saved. You can only change roles in a clan you lead, never your own, and only the platform owner can make or unmake a leader.",
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
