import { describe, expect, it } from "vitest";
import { loginError } from "./login-errors";

describe("loginError", () => {
  it("has a sentence for each code the callback sends", () => {
    expect(loginError("expired")).toMatch(/newest email/);
    expect(loginError("no-code")).toMatch(/without a sign-in code/);
    expect(loginError("incomplete")).toMatch(/did not complete/);
  });

  it("shows nothing for text somebody put in a link", () => {
    expect(loginError("Your account is locked. Call 555-0100.")).toBeNull();
  });

  it("is not fooled by what every object inherits", () => {
    expect(loginError("constructor")).toBeNull();
    expect(loginError("toString")).toBeNull();
  });

  it("shows nothing when there is no code", () => {
    expect(loginError(null)).toBeNull();
    expect(loginError("")).toBeNull();
  });
});
