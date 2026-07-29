// Public shell. Everything in the (auth) group is reachable without a session;
// src/middleware.ts (T3.2) must exempt these paths from the redirect to /login.

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="mx-auto max-w-md p-8">{children}</div>;
}
