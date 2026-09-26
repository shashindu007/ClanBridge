// The open-redirect guard, shared by every path that sends a member onward
// after signing them in.
//
// Extracted from auth/callback/route.ts when T10.4 added a second sign-in route.
// Two copies of a redirect guard is one copy that gets fixed and one that does
// not, and this is the guard for the whole product: `next` arrives in a URL that
// is emailed out, and reaches the login form as a query parameter anyone can
// set.

/**
 * Only ever redirect within this site.
 *
 * Treating `next` as a bare destination would turn every magic link into an open
 * redirect: a link that genuinely comes from ClanBridge, genuinely signs the
 * member in, and then drops them on someone else's page. Anything not a
 * single-slash-prefixed relative path is discarded rather than repaired.
 *
 * `//evil.com` is the case worth naming. It is protocol-relative, so a browser
 * reads it as an absolute URL to another host, and it passes a plain
 * `startsWith("/")`.
 */
export function safeNext(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/";
  // `/\evil.com` is the same trick with the other slash: browsers normalise a
  // backslash to a forward slash in the authority position.
  if (raw.startsWith("/\\")) return "/";
  // Tabs, newlines and other control characters are STRIPPED by the browser's
  // URL parser before it reads the path, so `/<TAB>/evil.com` passes both checks
  // above and then becomes `//evil.com`. No real in-app path contains one, and
  // a backslash anywhere is the same normalisation trick one character later.
  if (/[\u0000-\u001f\u007f\\]/.test(raw)) return "/";
  return raw;
}
