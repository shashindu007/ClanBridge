// One answer form for a member with several villages: which village it shows,
// and where Save moves it next. Pure, so pinned without a database.

import { describe, expect, it } from "vitest";
import { chooseBase, nextUnanswered } from "@/services/polls";

const A = { id: "a", name: "Main" };
const B = { id: "b", name: "Alt" };
const C = { id: "c", name: "Mini" };
const mine = [A, B, C];

describe("chooseBase", () => {
  it("shows the village asked for", () => {
    expect(chooseBase(mine, new Set(), "b")).toBe(B);
  });

  it("otherwise lands on the first village still owing an answer", () => {
    expect(chooseBase(mine, new Set(["a"]), null)).toBe(B);
    expect(chooseBase(mine, new Set(["a", "b"]))).toBe(C);
  });

  it("falls back to the first when every village has answered, or the ask is stale", () => {
    expect(chooseBase(mine, new Set(["a", "b", "c"]))).toBe(A);
    expect(chooseBase(mine, new Set(), "not-mine")).toBe(A);
  });

  it("has nothing to show without a village", () => {
    expect(chooseBase([], new Set())).toBeNull();
  });
});

describe("nextUnanswered", () => {
  it("moves on to the next village that still owes an answer", () => {
    expect(nextUnanswered(mine, new Set(["a"]), "a")).toBe(B);
    expect(nextUnanswered(mine, new Set(["a", "b"]), "b")).toBe(C);
  });

  it("wraps round to one skipped earlier", () => {
    expect(nextUnanswered(mine, new Set(["b", "c"]), "c")).toBe(A);
  });

  it("is null once every village has answered", () => {
    expect(nextUnanswered(mine, new Set(["a", "b", "c"]), "c")).toBeNull();
  });

  it("never offers the village just answered", () => {
    expect(nextUnanswered([A], new Set(), "a")).toBeNull();
  });
});
