import type { Tone } from "@/components/ui";

export const CLAIM_TONE: Record<string, Tone> = { draft: "gray", submitted: "blue", partially_paid: "yellow", paid: "green", rejected: "red" };
export const ITEM_TONE: Record<string, Tone> = { pending: "gray", paid: "green", partially_paid: "yellow", rejected: "red" };
