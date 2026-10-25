import { describe, expect, it } from "vitest";
import { totp, verifyTotp } from "../crypto";
import { dayRange, e164, localDay, zonedToUtc } from "../format";

describe("format", () => {
  it("converts local wall time to UTC", () => {
    expect(zonedToUtc("2026-10-24", "09:30", "Africa/Lagos").toISOString()).toBe("2026-10-24T08:30:00.000Z");
    expect(zonedToUtc("2026-10-24", "09:30", "Africa/Accra").toISOString()).toBe("2026-10-24T09:30:00.000Z");
    expect(zonedToUtc("2026-01-15", "00:00", "Africa/Nairobi").toISOString()).toBe("2026-01-14T21:00:00.000Z");
  });
  it("computes local day ranges", () => {
    const r = dayRange("2026-10-24", "Africa/Nairobi");
    expect(r.start.toISOString()).toBe("2026-10-23T21:00:00.000Z");
    expect(r.end.toISOString()).toBe("2026-10-24T21:00:00.000Z");
    expect(localDay("Africa/Nairobi", new Date("2026-10-23T22:00:00Z"))).toBe("2026-10-24");
  });
  it("normalises phone numbers", () => {
    expect(e164("024 123 4567", "GH")).toBe("+233241234567");
    expect(e164("0803 123 4567", "NG")).toBe("+2348031234567");
    expect(e164("+254712345678", "GH")).toBe("+254712345678");
    expect(e164("", "GH")).toBeNull();
  });
});

describe("totp", () => {
  it("matches RFC 6238 test vector", () => {
    // secret "12345678901234567890" in base32
    expect(totp("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", 59_000)).toBe("287082");
    expect(verifyTotp("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", "287082", 59_000)).toBe(true);
  });
});

import { isPrivateAddress } from "../net";
describe("isPrivateAddress", () => {
  it("flags internal ranges", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "::1", "fd00::1", "::ffff:127.0.0.1"]) expect(isPrivateAddress(ip)).toBe(true);
    for (const ip of ["8.8.8.8", "172.32.0.1", "2001:4860::8888"]) expect(isPrivateAddress(ip)).toBe(false);
  });
});

import { hoursOn, parseHoursForm, weekdayOf, withinHours } from "../hours";
describe("opening hours", () => {
  it("reads the right weekday and window", () => {
    expect(weekdayOf("2026-10-24")).toBe("6"); // Saturday
    expect(hoursOn(undefined, "2026-10-25")).toEqual(["10:00", "16:00"]); // pharmacies open short hours on Sunday by default
    expect(withinHours(undefined, "2026-10-24", 8 * 60, 9 * 60)).toBe(true);
    expect(withinHours(undefined, "2026-10-24", 20 * 60 + 45, 21 * 60 + 15)).toBe(false); // Saturday closes 21:00
    expect(withinHours(undefined, "2026-10-25", 9 * 60, 10 * 60)).toBe(false);
  });
  it("validates the settings form", () => {
    const f: Record<string, string> = {};
    for (let d = 0; d < 7; d++) Object.assign(f, { [`open_${d}`]: "08:00", [`close_${d}`]: "16:30" });
    f.closed_0 = "on";
    const h = parseHoursForm(f);
    expect(h["0"]).toBeNull();
    expect(h["3"]).toEqual(["08:00", "16:30"]);
    expect(() => parseHoursForm({ ...f, close_2: "07:00" })).toThrow(/Tuesday/);
  });
});
