import { describe, expect, it } from "vitest";
import { parseAlertDays, percentToBp } from "../rules";

describe("settings rules parsers", () => {
  it("turns percentages into basis points", () => {
    expect(percentToBp("15")).toBe(1500);
    expect(percentToBp("12.5%")).toBe(1250);
    expect(percentToBp("")).toBe(0);
    expect(() => percentToBp("120")).toThrow(/between 0 and 100/);
    expect(() => percentToBp("abc")).toThrow();
  });
  it("normalises expiry alert days", () => {
    expect(parseAlertDays("30, 90 60, 90")).toEqual([90, 60, 30]);
    expect(() => parseAlertDays("")).toThrow(/at least one/);
    expect(() => parseAlertDays("0")).toThrow(/between 1 and 365/);
    expect(() => parseAlertDays("1 2 3 4 5 6")).toThrow(/Up to 5/);
  });
});
