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

export function SignOutButton({ className = "" }: { className?: string }) {
  return (
    <form action="/auth/sign-out" method="post" className="contents">
      <button
        type="submit"
        className={`hover:underline ${className}`.trim()}
      >
        Sign out
      </button>
    </form>
  );
}
