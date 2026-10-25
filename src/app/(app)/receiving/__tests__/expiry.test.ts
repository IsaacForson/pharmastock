import { describe, expect, it } from "vitest";
import { parseExpiry } from "../expiry";

describe("parseExpiry", () => {
  it("reads month/year as the end of that month", () => {
    expect(parseExpiry("03/27")).toBe("2027-03-31");
    expect(parseExpiry("2/2028")).toBe("2028-02-29");
    expect(parseExpiry("2027-11")).toBe("2027-11-30");
    expect(parseExpiry("06-27")).toBe("2027-06-30");
  });
  it("reads full dates day-first or ISO", () => {
    expect(parseExpiry("15/03/2027")).toBe("2027-03-15");
    expect(parseExpiry("2027-03-15")).toBe("2027-03-15");
  });
  it("rejects nonsense", () => {
    expect(parseExpiry("13/27")).toBeNull();
    expect(parseExpiry("31/02/2027")).toBeNull();
    expect(parseExpiry("abc")).toBeNull();
    expect(parseExpiry("")).toBeNull();
  });
});
