import "server-only";
import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { AuthError } from "./auth";

export type ActionState = { ok?: boolean; error?: string; message?: string; id?: string } | undefined;

/** Error whose message is safe to show the user. */
export class UserError extends Error {}

/** Wraps a server action body: known errors become form messages, redirects pass through. */
export async function run(fn: () => Promise<ActionState | void>): Promise<ActionState> {
  try {
    return (await fn()) ?? { ok: true };
  } catch (e) {
    unstable_rethrow(e);
    if (e instanceof AuthError || e instanceof UserError) return { error: e.message };
    if (e instanceof z.ZodError) {
      const i = e.issues[0];
      return { error: i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message };
    }
    console.error(e);
    return { error: "Something went wrong. Please try again." };
  }
}

/** FormData -> plain object; empty strings become undefined so optional zod fields work. */
export function formObject(fd: FormData): Record<string, string | undefined> {
  const o: Record<string, string | undefined> = {};
  for (const [k, v] of fd.entries()) if (typeof v === "string" && !k.startsWith("$ACTION")) o[k] = v.trim() === "" ? undefined : v.trim();
  return o;
}

export const zMoney = z.string().regex(/^\d+(\.\d{1,2})?$/, "Enter an amount like 25 or 25.50").transform((s) => Math.round(Number(s) * 100));
export const zInt = z.coerce.number().int();
export const zBool = z.string().optional().transform((v) => v === "on" || v === "true" || v === "1");
