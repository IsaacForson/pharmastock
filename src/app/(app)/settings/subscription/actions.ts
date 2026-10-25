"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { formObject, run, UserError, type ActionState } from "@/lib/action";
import { AuthError, getCtx, tx } from "@/lib/auth";
import { pharmacyBilling } from "@/lib/currency";
import { subscriptionTotal } from "@/lib/money";
import { initializePayment } from "@/lib/paystack";
import { can } from "@/lib/permissions";
import { billableBranches } from "@/lib/plans";
import { currentSeats, limitError } from "../limits";
import { SETUP_TIERS } from "./pricing";

// Not requireWrite: a read-only (unpaid) account must still be able to pay.
async function billingCtx() {
  const ctx = await getCtx();
  if (!ctx) throw new AuthError("Your session has expired. Please sign in again.");
  if (ctx.impersonatedBy) throw new AuthError("Support view is read-only.");
  if (!can(ctx.user.role, "subscription.manage")) throw new AuthError("Only the owner can change the plan or pay.");
  const email = ctx.user.email ?? ctx.tenant.email;
  if (!email) throw new UserError("Add an email address to your account or pharmacy profile first — Paystack sends the receipt there.");
  return { ctx, email };
}

const callbackUrl = () => (process.env.APP_URL ? `${process.env.APP_URL}/settings/subscription?paid=1` : undefined);

export async function checkoutAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const { ctx, email } = await billingCtx();
    const o = z.object({ plan: z.enum(["starter", "pro", "chain"]), cycle: z.enum(["monthly", "annual"]) }).parse(formObject(fd));
    const seats = await tx(ctx, (t) => currentSeats(t, ctx.tenant.id));
    const err = limitError({ plan: o.plan, planStatus: "active" }, seats);
    if (err) throw new UserError(`You currently use more than this plan allows: ${err}`);
    const branches = billableBranches(o.plan, seats.branches);
    // Charged in the pharmacy's own currency (USD only where Paystack can't take that currency).
    const { charge } = await pharmacyBilling(ctx.tenant.currency);
    const r = await initializePayment({
      tenantId: null, email, amountMinor: subscriptionTotal(charge, o.plan, o.cycle, branches), currency: charge.currency, callbackUrl: callbackUrl(),
      metadata: { kind: "subscription", tenantId: ctx.tenant.id, plan: o.plan, cycle: o.cycle, branches },
    });
    if (!r) throw new UserError("Online payment isn't available right now. Please contact support to renew.");
    redirect(r.url);
  });
}

export async function setupCheckoutAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const { ctx, email } = await billingCtx();
    const tier = z.enum(Object.keys(SETUP_TIERS) as [keyof typeof SETUP_TIERS]).parse(fd.get("tier"));
    const { charge } = await pharmacyBilling(ctx.tenant.currency);
    const r = await initializePayment({
      tenantId: null, email, amountMinor: charge.setup[tier], currency: charge.currency, callbackUrl: callbackUrl(),
      metadata: { kind: "setup", tenantId: ctx.tenant.id, tier },
    });
    if (!r) throw new UserError("Online payment isn't available right now. Please contact support.");
    redirect(r.url);
  });
}
