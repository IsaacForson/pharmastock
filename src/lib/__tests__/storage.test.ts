import { afterEach, describe, expect, it, vi } from "vitest";
import { getFile, putFile } from "../storage";

const T = "11111111-2222-3333-4444-555555555555";

describe("Supabase storage driver", () => {
  afterEach(() => { vi.unstubAllGlobals(); delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SERVICE_ROLE_KEY; });

  it("uploads to a tenant-prefixed key in the private bucket and reads it back", async () => {
    process.env.SUPABASE_URL = "https://proj.supabase.co/";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
    delete process.env.SUPABASE_STORAGE_BUCKET; // the default bucket name is what is under test
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return init?.method === "POST" ? new Response("{}", { status: 200 }) : new Response(new Uint8Array([1, 2, 3]), { status: 200 });
    }));
    const key = await putFile(T, "scan.pdf", Buffer.from("x"), "application/pdf");
    expect(key).toMatch(new RegExp(`^${T}/\\d{4}-\\d{2}/[\\w-]+\\.pdf$`));
    expect(calls[0].url).toBe(`https://proj.supabase.co/storage/v1/object/pharmacy-files/${key}`);
    expect((calls[0].init?.headers as Record<string, string>).Authorization).toBe("Bearer service-key");
    expect((calls[0].init?.headers as Record<string, string>)["Content-Type"]).toBe("application/pdf");
    expect([...(await getFile(T, key))]).toEqual([1, 2, 3]);
  });

  it("refuses keys of another tenant or malformed keys", async () => {
    await expect(getFile(T, "99999999-2222-3333-4444-555555555555/2026-10/abc.pdf")).rejects.toThrow("Not found");
    await expect(getFile(T, `${T}/../../etc/passwd`)).rejects.toThrow("Not found");
  });
});
