// Unauthenticated shell — the sign-in and verification screens.
//
// NOT wholly public, despite the group name. PUBLIC_PATHS in
// lib/supabase/middleware.ts exempts /login, /auth and /api/auth only. /verify
// (T3.4) is in this group for its layout, but it requires a session: it links a
// game account to *your* user, so there is nobody to link without one.
//
// Route groups do not appear in the URL, so membership here says nothing about
// access. The middleware's list is the only thing that decides that.
//
// T10.9 — DELIBERATELY SYNCHRONOUS, and it briefly was not.
//
// T10.3 put the sign-out button here, so that /verify — the one authenticated
// page outside the app shell — had a way out. That made the layout async and
// gave it a getUser() call, which added a network round trip to Supabase's auth
// server to every render of /login. /login is the page a member is staring at
// while they wait to get in, and it is the page whose speed they judge the whole
// product by.
//
// The button now lives in the /verify page itself, which is the only page in
// this group that ever needed it. /login renders with no database call at all.

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="mx-auto max-w-md p-8">{children}</div>;
}
