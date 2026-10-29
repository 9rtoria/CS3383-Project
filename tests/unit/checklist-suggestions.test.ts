import { describe, expect, it } from "vitest";
import { suggestChecklistItems } from "@/lib/checklist-suggestions";

describe("checklist suggestions", () => {
  it("returns deterministic, relevant suggestions without duplicates", () => {
    const suggestions = suggestChecklistItems("Write the launch announcement", "", ["Outline the key points"]);
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions).not.toContain("Outline the key points");
    expect(new Set(suggestions).size).toBe(suggestions.length);
  });

  it("returns no suggestions for unrelated work", () => {
    expect(suggestChecklistItems("Water the plants", "")).toEqual([]);
  });
});
