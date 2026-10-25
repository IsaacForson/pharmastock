import { describe, expect, it } from "vitest";
import { signReceipt, verifyReceipt } from "./token";

const id = "3f2b8c1a-1d2e-4f50-8a9b-0c1d2e3f4a5b";

describe("receipt links", () => {
  it("round-trips a sale id", () => {
    expect(verifyReceipt(signReceipt(id))).toBe(id);
  });
  it("rejects tampered or malformed tokens", () => {
    const t = signReceipt(id);
    expect(verifyReceipt(t.replace(/^3/, "4"))).toBeNull();
    expect(verifyReceipt(t.slice(0, -1) + (t.endsWith("A") ? "B" : "A"))).toBeNull();
    expect(verifyReceipt("nope")).toBeNull();
  });
});
