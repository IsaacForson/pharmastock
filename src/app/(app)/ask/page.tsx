import { KeyRound, Sparkles } from "lucide-react";
import { notFound } from "next/navigation";
import { Callout, PageHeader } from "@/components/ui";
import { aiConfigured } from "@/lib/ai-ask";
import { branchScope } from "@/lib/analytics";
import { requireCtx } from "@/lib/auth";
import { hasFeature } from "@/lib/plans";
import { AskBox } from "./ask-box";

export const metadata = { title: "Ask PharmaStock" };

export default async function AskPage() {
  const ctx = await requireCtx("ai.ask");
  if (!hasFeature(ctx.tenant, "ai")) notFound();
  const scope = branchScope({ role: ctx.user.role, consolidated: hasFeature(ctx.tenant, "consolidated"), branches: ctx.branches, current: ctx.branchId, defaultAll: true });
  const options = [...(scope.canAll ? [{ id: "all", name: "All branches" }] : []), ...ctx.branches];
  return (
    <>
      <PageHeader icon={<Sparkles />} eyebrow="Insights" title="Ask PharmaStock"
        subtitle="Ask about your sales, stock, expiry and reordering in plain words. Answers come from your live data." />
      {aiConfigured() ? (
        <AskBox branches={options.length > 1 ? options : []} defaultBranch={scope.all ? "all" : ctx.branchId} />
      ) : (
        <Callout tone="yellow" icon={<KeyRound />}>
          Ask PharmaStock isn&apos;t switched on for this server yet. Your PharmaStock administrator needs to add an Anthropic API key (<code className="font-mono text-xs">ANTHROPIC_API_KEY</code>).
        </Callout>
      )}
      <p className="mt-6 text-xs text-subtle">For business questions only. It doesn&apos;t give dosing or medical advice; that stays with your pharmacist. Questions are recorded in the audit log.</p>
    </>
  );
}
