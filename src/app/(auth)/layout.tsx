// Unauthenticated shell — the sign-in and verification screens.
//
// NOT wholly public, despite the group name. PUBLIC_PATHS in
// lib/supabase/middleware.ts exempts /login and /auth only. /verify (T3.4) is in
// this group for its layout, but it requires a session: it links a game account
// to *your* user, so there is nobody to link without one.
//
// Route groups do not appear in the URL, so membership here says nothing about
// access. The middleware's list is the only thing that decides that.

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="mx-auto max-w-md p-8">{children}</div>;
}
