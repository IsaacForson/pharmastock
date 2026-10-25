import type { Tone } from "@/components/ui";

export const STATUS_TONE: Record<string, Tone> = { completed: "green", partially_returned: "yellow", returned: "gray", voided: "red" };
