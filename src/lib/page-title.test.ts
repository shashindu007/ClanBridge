import { describe, expect, it } from "vitest";
import { pageTitle } from "./page-title";

describe("pageTitle", () => {
  it.each([
    ["/dashboard", "Home"],
    ["/notifications", "Notifications"],
    ["/admin", "Admin"],
    ["/admin/members", "Accounts"],
    ["/admin/members/some-user", "Accounts"],
    ["/rating", "Player rating"],
    ["/rating/war", "War rating"],
    ["/roster/2026-10", "CWL lineups"],
    ["/settings/account", "Sign-in and password"],
  ])("names %s", (path, title) => {
    expect(pageTitle(path)).toBe(title);
  });

  it.each([
    ["/%232PP0JCCL", "Clan"],
    ["/%232PP0JCCL/members", "Members"],
    ["/%232PP0JCCL/war", "War"],
    ["/%232PP0JCCL/war/lineup", "War lineup"],
    ["/%232PP0JCCL/war/report", "War report"],
    ["/%232PP0JCCL/cwl/2026-10/standings", "CWL"],
    ["/%232PP0JCCL/player/%23ABC", "Player"],
    ["/%232PP0JCCL/layouts/upload", "Bases"],
  ])("names the clan page %s", (path, title) => {
    expect(pageTitle(path)).toBe(title);
  });

  it("falls back to the product name with no path", () => {
    expect(pageTitle("/")).toBeNull();
    expect(pageTitle(null)).toBeNull();
  });

  it("is not fooled by what every object inherits", () => {
    expect(pageTitle("/constructor")).toBe("Clan");
    expect(pageTitle("/%232PP/constructor")).toBe("Clan");
  });
});
