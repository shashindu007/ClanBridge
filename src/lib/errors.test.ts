// T10.8d — what a member is allowed to be told when a write fails.

import { afterEach, describe, expect, it, vi } from "vitest";
import { isUniqueViolation, safeMessage } from "@/lib/errors";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("isUniqueViolation", () => {
  const taken = {
    message:
      'duplicate key value violates unique constraint "users_username_key"',
  };

  it("recognises a duplicate key", () => {
    expect(isUniqueViolation(taken)).toBe(true);
  });

  // The constraint name is the only thing that says WHICH uniqueness broke.
  // "that username is taken" and "you have already voted" are the same error
  // class and completely different sentences.
  it("distinguishes one constraint from another", () => {
    expect(isUniqueViolation(taken, "users_username_key")).toBe(true);
    expect(isUniqueViolation(taken, "base_layout_votes_one_per_member")).toBe(false);
  });

  it("is false for anything else", () => {
    expect(isUniqueViolation({ message: "permission denied for table users" })).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation(undefined)).toBe(false);
    expect(isUniqueViolation({})).toBe(false);
  });
});

describe("safeMessage", () => {
  it("returns the fallback and never the raw text", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const raw = 'new row violates row-level security policy for table "clan_roles"';

    const shown = safeMessage("grant-role", { message: raw }, "You cannot do that.");

    expect(shown).toBe("You cannot do that.");
    expect(shown).not.toContain("row-level security");
    expect(shown).not.toContain("clan_roles");
  });

  // The raw text has to go somewhere or this helper trades a leak for an
  // undebuggable product.
  it("logs the raw text with its context", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    safeMessage("add-clan", { message: "duplicate key" }, "Could not add that clan.");

    expect(spy).toHaveBeenCalledWith("add-clan: duplicate key");
  });

  // The default must be the safe one. A helper that passed unrecognised messages
  // through would leak exactly the set of errors nobody thought to map, which is
  // the set worth not leaking.
  it("says nothing at all when there is nothing to log", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(safeMessage("x", null, "Fallback.")).toBe("Fallback.");
    expect(spy).not.toHaveBeenCalled();
  });
});
