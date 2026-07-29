// T3.6 — Authenticated shell and clan switcher.
//
// Shows only the clans the signed-in user may see, resolved from clan_roles (R3).
// Never build the switcher from a hardcoded list of three clans — read the user's
// memberships, or a leader of clan A will be handed a link into clan B (T3.7).
//
// T3.8 — users in the pending state are redirected to /pending from here.

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen">
      {/* Clan switcher navigation goes here. */}
      {children}
    </div>
  );
}
