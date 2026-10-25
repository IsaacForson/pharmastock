import { describe, expect, it } from "vitest";
import { extractParams } from "../handlers";
import { parseCommand, senderE164 } from "../inbound";
import { backoffMs } from "../runner";

describe("parseCommand", () => {
  it("recognises refill replies and opt-out / opt-in", () => {
    for (const s of ["1", "yes", " Yes ", "YES!", "refill"]) expect(parseCommand(s)).toEqual({ kind: "refill" });
    expect(parseCommand("stop")).toEqual({ kind: "stop" });
    expect(parseCommand("Unsubscribe")).toEqual({ kind: "stop" });
    expect(parseCommand("START")).toEqual({ kind: "start" });
    expect(parseCommand("2")).toEqual({ kind: "unknown" });
    expect(parseCommand("hello, do you have amoxicillin?")).toEqual({ kind: "unknown" });
  });
  it("normalises sender ids", () => {
    expect(senderE164("233241234567")).toBe("+233241234567");
    expect(senderE164("+254712345678")).toBe("+254712345678");
  });
});

describe("backoff", () => {
  it("doubles and caps at an hour", () => {
    expect([1, 2, 3, 4].map(backoffMs)).toEqual([60_000, 120_000, 240_000, 480_000]);
    expect(backoffMs(20)).toBe(3600_000);
  });
});

describe("extractParams", () => {
  it("recovers WhatsApp template parameters from the rendered body", () => {
    const tpl = "Hello {{name}}, your appointment at {{clinic}} on {{date}} at {{time}}{{with}}.";
    expect(extractParams(tpl, "Hello Ama, your appointment at Ridge Clinic on 24 Oct 2026 at 09:30 with Dr. Mensah."))
      .toEqual(["Ama", "Ridge Clinic", "24 Oct 2026", "09:30", "with Dr. Mensah"]);
    expect(extractParams(tpl, "Hello Ama, your appointment at Ridge Clinic on 24 Oct 2026 at 09:30.")).toEqual(["Ama", "Ridge Clinic", "24 Oct 2026", "09:30", "-"]);
  });
});

describe("extractParams trailing placeholder", () => {
  it("captures a final placeholder with spaces", () => {
    expect(extractParams("Hi {{name}}: {{link}}", "Hi Ama Owusu: https://x.y/z q")).toEqual(["Ama Owusu", "https://x.y/z q"]);
  });
});
