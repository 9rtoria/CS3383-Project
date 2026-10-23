import { describe, expect, it } from "vitest";
import { appendAfter, firstPosition, positionBetween, positionsBetween, prependBefore, sortByPosition } from "@/lib/fractional";

describe("fractional ordering (FR-004, invariant 2)", () => {
  it("creates keys strictly between neighbours", () => {
    const first = firstPosition();
    const last = appendAfter(first);
    const middle = positionBetween(first, last);
    expect(first < middle).toBe(true);
    expect(middle < last).toBe(true);
    expect(prependBefore(first) < first).toBe(true);
  });

  it("supports repeated inserts without renumbering", () => {
    let left = firstPosition();
    const right = appendAfter(left);
    const inserted: string[] = [];
    for (let i = 0; i < 30; i++) {
      left = positionBetween(left, right);
      inserted.push(left);
    }
    expect(new Set(inserted).size).toBe(30);
    for (let i = 1; i < inserted.length; i++) {
      expect(inserted[i - 1]! < inserted[i]!).toBe(true);
      expect(inserted[i]! < right).toBe(true);
    }
  });

  it("creates an ordered batch between boundaries", () => {
    const start = firstPosition();
    const end = appendAfter(start);
    const keys = positionsBetween(start, end, 20);
    expect(keys).toHaveLength(20);
    expect([start, ...keys, end].sort()).toEqual([start, ...keys, end]);
    expect(positionsBetween(null, null, 0)).toEqual([]);
  });

  it("rejects inverted boundaries and sorts equal positions by id", () => {
    expect(() => positionBetween("z", "a")).toThrow(/before must sort before after/);
    expect(sortByPosition([{ id: "b", position: "a0" }, { id: "a", position: "a0" }]).map((item) => item.id)).toEqual(["a", "b"]);
  });
});
