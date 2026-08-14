// T3.8 — the approval gate's exempt list.
//
// These tests exist because of a specific defect, not for coverage. /admin was
// missing from GATE_EXEMPT, which made the platform impossible to bootstrap:
//
//   the first user signs in       -> users.status = 'pending'
//   the gate sees 'pending'       -> redirect to /pending
//   /pending has no claim button  -> the only one is on /admin
//   /admin is behind the gate     -> unreachable
//   nobody can approve them       -> no admin exists yet to do it
//
// Every unit test passed. claim_platform_ownership() was correct and well
// tested. The route that reaches it was simply unreachable, and nothing in the
// suite asserted reachability.

import { describe, expect, it } from "vitest";
import { GATE_EXEMPT, isGateExempt, isSetupExempt, SETUP_EXEMPT } from "@/lib/gate";

describe("T3.8 — the approval gate", () => {
  // The regression. If this fails, a fresh deployment cannot be claimed.
  it("lets an unapproved account reach /admin, or nobody can ever claim the platform", () => {
    expect(isGateExempt("/admin")).toBe(true);
  });

  it("covers the pages an unapproved account legitimately needs", () => {
    expect(isGateExempt("/pending")).toBe(true); // or the redirect loops forever
    expect(isGateExempt("/verify")).toBe(true); // how they become approvable
    expect(isGateExempt("/guide")).toBe(true); // how to get in is not clan data
  });

  it("covers nested paths under an exempt route", () => {
    expect(isGateExempt("/admin/members")).toBe(true);
    expect(isGateExempt("/admin/audit")).toBe(true);
  });

  // Segment-matched, not prefix-matched. A plain startsWith would wave
  // "/adminfoo" through the gate.
  it("does not exempt a lookalike path", () => {
    expect(isGateExempt("/adminfoo")).toBe(false);
    expect(isGateExempt("/pendingxyz")).toBe(false);
  });

  // The gate's actual job: everything holding clan data stays behind it.
  it.each([
    "/",
    "/%232PP0JCCL",
    "/%232PP0JCCL/cwl",
    "/%232PP0JCCL/cwl/2026-08",
    "/%232PP0JCCL/members",
    "/%232PP0JCCL/player/%23ABC",
    "/%232PP0JCCL/notices",
    "/search",
    "/report",
    "/roster",
  ])("keeps %s behind the gate", (path) => {
    expect(isGateExempt(path)).toBe(false);
  });

  it("exempts exactly five routes, so adding one is a deliberate act", () => {
    expect([...GATE_EXEMPT]).toEqual([
      "/pending",
      "/verify",
      "/guide",
      "/admin",
      "/account",
    ]);
  });
});

// T10.5 — the setup gate, which runs BEFORE the approval gate above.
//
// Same defect class as the /admin one, one phase later, and it would have been
// worse: /admin locked out the first user, this would lock out every user. A
// brand-new account is 'pending' by definition, so if /account/setup were not
// exempt from BOTH gates the member is bounced to /pending, the setup they are
// being held for is unreachable, the Sign in button never works for anybody, and
// the magic link stays the only door — which is the whole thing T10 exists to
// change. Nothing would fail loudly; every other test would pass.
describe("T10.5 — the setup gate", () => {
  it("lets an account with no password reach the page that gives it one", () => {
    expect(isSetupExempt("/account/setup")).toBe(true);
  });

  // The regression, stated as one assertion because it is one bug.
  it("exempts /account/setup from the approval gate too, or setup is unreachable", () => {
    expect(isSetupExempt("/account/setup")).toBe(true);
    expect(isGateExempt("/account/setup")).toBe(true);
  });

  // The mirror of the /admin case: setup must not be an escape from the gate.
  it.each([
    "/",
    "/roster",
    "/report",
    "/%232PP0JCCL/members",
    "/settings/notifications",
    "/pending",
    "/admin",
  ])("keeps %s behind the setup gate", (path) => {
    expect(isSetupExempt(path)).toBe(false);
  });

  // /settings/account changes the same two values, but only for an account that
  // already has them. Exempting it would let a half-made account wander into the
  // shell, which renders a nav for a member the layout has not finished checking.
  it("does not exempt the settings page that changes the same values", () => {
    expect(isSetupExempt("/settings/account")).toBe(false);
  });

  it("is segment-matched like the other list", () => {
    expect(isSetupExempt("/account/setupfoo")).toBe(false);
    expect(isSetupExempt("/account")).toBe(false);
  });

  it("exempts exactly one route — there is nowhere else to go, on purpose", () => {
    expect([...SETUP_EXEMPT]).toEqual(["/account/setup"]);
  });
});
