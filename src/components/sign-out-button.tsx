// T10.3 — the way out, shared by both shells.
//
// Lives in components/ rather than in (app)/layout.tsx because /verify renders
// through (auth)/layout.tsx instead, and a member who signed in as the wrong
// account on the verification screen needs the button as much as anyone.
//
// A plain form, not a client component and not a fetch. No JavaScript, no
// hydration, nothing to fail — the one control in the product whose whole job is
// to work when the session is in a bad state should not depend on the session
// being in a good state.
//
// POST, because /auth/sign-out refuses GET. See that route on why.

export function SignOutButton({
  className = "",
  children,
}: {
  className?: string;
  /**
   * Defaults to the words "Sign out". Passed in by the account menu, which
   * needs an icon beside the label and styles the row itself.
   *
   * The underline is the DEFAULT rather than unconditional, because in the menu
   * this sits in a column of links that are not underlined and an odd one out
   * reads as a different kind of control. Callers passing children own the
   * appearance; callers passing none get what they always got.
   */
  children?: React.ReactNode;
}) {
  return (
    <form action="/auth/sign-out" method="post" className="contents">
      <button
        type="submit"
        className={(children ? className : `hover:underline ${className}`).trim()}
      >
        {children ?? "Sign out"}
      </button>
    </form>
  );
}
