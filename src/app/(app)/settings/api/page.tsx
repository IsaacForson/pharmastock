import { desc } from "drizzle-orm";
import { BookOpen, KeyRound, Plus, Sparkles } from "lucide-react";
import Link from "next/link";
import { ActionButton, Submit } from "@/components/form";
import { A, Badge, Callout, Check, cx, EmptyState, Field, Input, Panel, Table, Td } from "@/components/ui";
import { apiKeys } from "@/db/schema";
import { API_RESOURCES, RATE_LIMIT, WRITABLE } from "@/lib/api-auth";
import { requireCtx, tx } from "@/lib/auth";
import { dateTime } from "@/lib/format";
import { hasFeature } from "@/lib/plans";
import { SecretActionForm } from "../secret-form";
import { createApiKeyAction, revokeApiKeyAction } from "./actions";


export const metadata = { title: "API keys" };
export default async function ApiKeysPage() {
  const ctx = await requireCtx("api.manage");
  const keys = await tx(ctx, (t) => t.select().from(apiKeys).orderBy(desc(apiKeys.createdAt)));
  const enabled = hasFeature(ctx.tenant, "api");
  const tz = ctx.tenant.timezone;
  const code = "rounded-md border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-xs text-accent-2";
  return (
    <>
      <div className="glass flex flex-wrap items-center gap-4 p-5 animate-rise">
        <span className="grid h-11 w-11 place-items-center rounded-2xl border border-accent/25 bg-accent/15 text-accent" aria-hidden><BookOpen className="h-5 w-5" /></span>
        <p className="min-w-0 flex-1 text-sm leading-relaxed text-muted">
          Connect other software with the REST API at <code className={code}>/api/v1</code> (<A href="/api/v1/openapi.json">OpenAPI spec</A>).
          Send <code className={code}>Authorization: Bearer ps_live_…</code> · limit <span className="font-medium text-fg tabular-nums">{RATE_LIMIT}</span> requests per minute per key.
        </p>
      </div>
      {!enabled && (
        <Callout tone="yellow" icon={<Sparkles />}>
          API access is part of the <Link href="/settings/subscription" className="font-medium underline underline-offset-4">Chain plan</Link>. Existing keys stop working on other plans.
        </Callout>
      )}

      <Panel title="API keys" eyebrow={`${keys.filter((k) => !k.revokedAt).length} active`} icon={<KeyRound />}>
        {keys.length === 0 ? (
          <EmptyState compact icon={<KeyRound />} title="No API keys yet">{enabled ? "Create a key below for your website shop, accounting tool or a wholesaler integration." : "Upgrade to Chain to create keys."}</EmptyState>
        ) : (
          <Table head={["Name", "Key", "Permissions", "Last used", "Created", ""]}>
            {keys.map((k) => (
              <tr key={k.id} className={cx(k.revokedAt && "opacity-50")}>
                <Td className="font-medium">{k.name}</Td>
                <Td className="font-mono text-xs text-muted">{k.prefix}…</Td>
                <Td className="whitespace-normal">
                  <div className="flex max-w-sm flex-wrap gap-1">{k.scopes.map((s) => <span key={s} className="rounded-md bg-surface-3 px-1.5 py-0.5 font-mono text-[10px] text-muted">{s}</span>)}</div>
                </Td>
                <Td className="text-muted tabular-nums">{dateTime(k.lastUsedAt, tz) || "Never"}</Td>
                <Td className="text-muted tabular-nums">{dateTime(k.createdAt, tz)}</Td>
                <Td className="text-right">{k.revokedAt ? <Badge>Revoked</Badge> : <ActionButton action={revokeApiKeyAction} fields={{ id: k.id }} variant="danger" confirm={`Revoke "${k.name}"? Apps using it will stop working immediately.`}>Revoke</ActionButton>}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>

      {enabled && (
        <Panel title="Create an API key" eyebrow="Shown once" icon={<Plus />} glow>
          <SecretActionForm action={createApiKeyAction} resetOnSuccess>
            <Field label="Name" hint="Where it's used, e.g. 'Lab system' or 'Website booking'"><Input name="name" required className="max-w-sm" /></Field>
            <fieldset>
              <legend className="mb-2 text-xs font-medium tracking-wide text-muted">Permissions</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {API_RESOURCES.map((r) => (
                  <div key={r} className="flex items-center justify-between gap-4 rounded-xl border border-line bg-surface px-3.5 py-2.5">
                    <span className="text-sm font-medium capitalize text-fg">{r}</span>
                    <span className="flex gap-4">
                      <Check name="scopes" value={`${r}:read`} defaultChecked label={<span className="text-xs text-muted">Read</span>} />
                      {WRITABLE.includes(r) && <Check name="scopes" value={`${r}:write`} label={<span className="text-xs text-muted">Write</span>} />}
                    </span>
                  </div>
                ))}
              </div>
            </fieldset>
            <div className="flex justify-end"><Submit>Create key</Submit></div>
          </SecretActionForm>
        </Panel>
      )}
    </>
  );
}
