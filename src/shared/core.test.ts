import { describe, expect, it } from "vitest";
import { shouldFillConfidence } from "./core";

describe("shouldFillConfidence", () => {
  it("keeps conservative mode limited to high-confidence matches", () => {
    expect(shouldFillConfidence("high", "conservative")).toBe(true);
    expect(shouldFillConfidence("medium", "conservative")).toBe(false);
    expect(shouldFillConfidence("low", "conservative")).toBe(false);
  });

  it("allows medium-confidence matches in neutral mode", () => {
    expect(shouldFillConfidence("high", "neutral")).toBe(true);
    expect(shouldFillConfidence("medium", "neutral")).toBe(true);
    expect(shouldFillConfidence("low", "neutral")).toBe(false);
  });

  it("allows every matched confidence in liberal mode", () => {
    expect(shouldFillConfidence("high", "liberal")).toBe(true);
    expect(shouldFillConfidence("medium", "liberal")).toBe(true);
    expect(shouldFillConfidence("low", "liberal")).toBe(true);
    expect(shouldFillConfidence("unmatched", "liberal")).toBe(false);
  });
});
