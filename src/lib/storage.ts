// No "server-only" here: the background worker (plain Node via tsx) also stores files (data exports).
import { mkdir, readFile, rm, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomToken } from "./crypto";

/**
 * File storage for uploads, logos, prescription scans, delivery notes and data exports. Keys are always `<tenantId>/<yyyy-mm>/<random><ext>`.
 * Driver: Supabase Storage when SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are set (private bucket, server-side access only),
 * otherwise the local disk (development).
 */
const supabase = () => {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? { url, key, bucket: process.env.SUPABASE_STORAGE_BUCKET || "pharmacy-files" } : null;
};

const root = () => path.resolve(process.env.STORAGE_DIR || ".storage");
function safePath(key: string) {
  const p = path.resolve(root(), key);
  if (!p.startsWith(root() + path.sep)) throw new Error("Invalid storage key");
  return p;
}

const KEY_RE = /^[0-9a-f-]{36}\/\d{4}-\d{2}\/[\w-]+(\.\w{1,10})?$/;
const objectUrl = (s: NonNullable<ReturnType<typeof supabase>>, key: string) =>
  `${s.url}/storage/v1/object/${encodeURIComponent(s.bucket)}/${key.split("/").map(encodeURIComponent).join("/")}`;
const auth = (s: NonNullable<ReturnType<typeof supabase>>) => ({ Authorization: `Bearer ${s.key}`, apikey: s.key });

export async function putFile(tenantId: string, name: string, data: Buffer | Uint8Array, contentType = "application/octet-stream"): Promise<string> {
  const ext = path.extname(name).replace(/[^.\w]/g, "").slice(0, 10);
  const key = `${tenantId}/${new Date().toISOString().slice(0, 7)}/${randomToken(16)}${ext}`;
  const s = supabase();
  if (s) {
    const res = await fetch(objectUrl(s, key), {
      method: "POST", headers: { ...auth(s), "Content-Type": contentType, "x-upsert": "false", "Cache-Control": "private, max-age=0" },
      body: new Uint8Array(data),
    });
    if (!res.ok) throw new Error(`Storage upload failed (${res.status}): ${await res.text()}`);
    return key;
  }
  const p = safePath(key);
  await mkdir(path.dirname(p), { recursive: true });
  await writeFile(p, data);
  return key;
}

/** Reads a file; the key must belong to the tenant (keys are prefixed with tenant id). */
export async function getFile(tenantId: string, key: string): Promise<Buffer> {
  if (!key.startsWith(tenantId + "/") || !KEY_RE.test(key)) throw new Error("Not found");
  const s = supabase();
  if (s) {
    const res = await fetch(objectUrl(s, key), { headers: auth(s) });
    if (!res.ok) throw new Error(res.status === 404 || res.status === 400 ? "Not found" : `Storage read failed (${res.status})`);
    return Buffer.from(await res.arrayBuffer());
  }
  return readFile(safePath(key));
}

export async function deleteFile(tenantId: string, key: string) {
  if (!key.startsWith(tenantId + "/") || !KEY_RE.test(key)) return;
  const s = supabase();
  if (s) await fetch(`${s.url}/storage/v1/object/${encodeURIComponent(s.bucket)}`, { method: "DELETE", headers: { ...auth(s), "Content-Type": "application/json" }, body: JSON.stringify({ prefixes: [key] }) }).catch(() => {});
  else await unlink(safePath(key)).catch(() => {});
}

/** Removes every stored file of a pharmacy (used only when a pharmacy is permanently deleted on the owner's request). */
export async function deleteTenantFiles(tenantId: string) {
  if (!/^[0-9a-f-]{36}$/.test(tenantId)) throw new Error("Invalid tenant id");
  const s = supabase();
  if (!s) return rm(safePath(tenantId), { recursive: true, force: true });
  // List month folders, then the files in each, and delete in batches.
  const list = async (prefix: string) => {
    const res = await fetch(`${s.url}/storage/v1/object/list/${encodeURIComponent(s.bucket)}`, {
      method: "POST", headers: { ...auth(s), "Content-Type": "application/json" }, body: JSON.stringify({ prefix, limit: 1000, offset: 0 }),
    });
    if (!res.ok) throw new Error(`Storage list failed (${res.status})`);
    return (await res.json()) as { name: string; id: string | null }[];
  };
  const keys: string[] = [];
  for (const month of await list(`${tenantId}/`)) {
    if (month.id) { keys.push(`${tenantId}/${month.name}`); continue; } // a file at the top level
    for (const f of await list(`${tenantId}/${month.name}/`)) keys.push(`${tenantId}/${month.name}/${f.name}`);
  }
  for (let i = 0; i < keys.length; i += 500) {
    const res = await fetch(`${s.url}/storage/v1/object/${encodeURIComponent(s.bucket)}`, {
      method: "DELETE", headers: { ...auth(s), "Content-Type": "application/json" }, body: JSON.stringify({ prefixes: keys.slice(i, i + 500) }),
    });
    if (!res.ok) throw new Error(`Storage delete failed (${res.status})`);
  }
}

export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
export const ALLOWED_MIME = /^(image\/(png|jpe?g|webp|gif|heic)|application\/pdf|text\/plain|text\/csv)$/;
