"use server";
import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { apiKeys } from "@/db/schema";
import { run, UserError, type ActionState } from "@/lib/action";
import { API_RESOURCES, newApiKey, WRITABLE } from "@/lib/api-auth";
import { audit, requireWrite, tx } from "@/lib/auth";
import { hasFeature } from "@/lib/plans";

const ALLOWED = new Set(API_RESOURCES.flatMap((r) => [`${r}:read`, ...(WRITABLE.includes(r) ? [`${r}:write`] : [])]));

export async function createApiKeyAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await requireWrite("api.manage");
    if (!hasFeature(ctx.tenant, "api")) throw new UserError("The API is available on the Chain plan.");
    const name = z.string().trim().min(1, "Give the key a name").max(80).parse(fd.get("name"));
    const scopes = [...new Set(fd.getAll("scopes").map(String))].filter((s) => ALLOWED.has(s));
    if (!scopes.length) throw new UserError("Choose at least one permission");
    const { key, prefix, keyHash } = newApiKey();
    await tx(ctx, async (t) => {
      const [k] = await t.insert(apiKeys).values({ tenantId: ctx.tenant.id, name, prefix, keyHash, scopes, createdBy: ctx.user.id }).returning({ id: apiKeys.id });
      await audit(t, ctx, "create", "api_key", k.id, { details: { name, scopes } });
    });
    revalidatePath("/settings/api");
    return { ok: true, message: `Your new API key (copy it now — it won't be shown again): ${key}` };
  });
}

export async function revokeApiKeyAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await requireWrite("api.manage");
    const id = z.string().uuid().parse(fd.get("id"));
    await tx(ctx, async (t) => {
      await t.update(apiKeys).set({ revokedAt: new Date() }).where(and(eq(apiKeys.id, id), isNull(apiKeys.revokedAt)));
      await audit(t, ctx, "revoke", "api_key", id);
    });
    revalidatePath("/settings/api");
  });
}
