import { describe, expect, it } from "vitest";
import { FEATURE_LABELS, planHighlights, planLimitsLine } from "../pricing";
import { PLANS } from "@/lib/plans";

describe("plan copy", () => {
  it("labels every feature", () => {
    for (const f of PLANS.chain.features) expect(FEATURE_LABELS[f as keyof typeof FEATURE_LABELS]).toBeTruthy();
  });
  it("lists only what each plan adds", () => {
    expect(planHighlights("starter").lead).toBeNull();
    expect(planHighlights("pro").features).toContain("Controlled-drug register");
    expect(planHighlights("pro").features).not.toContain("Free full data export");
    expect(planHighlights("chain").lead).toBe("Everything in Pro, plus");
    expect(planLimitsLine("starter")).toBe("1 branch, 2 staff accounts");
    expect(planLimitsLine("chain")).toMatch(/minimum 3/);
  });
});
