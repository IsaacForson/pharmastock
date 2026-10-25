import { Tabs } from "@/components/ui";

export const MessageTabs = ({ current }: { current: "log" | "inbox" | "send" | "templates" }) => (
  <Tabs current={current} tabs={[
    { key: "log", href: "/messages", label: "Message log" },
    { key: "inbox", href: "/messages/inbox", label: "Inbox" },
    { key: "send", href: "/messages/send", label: "Send message" },
    { key: "templates", href: "/messages/templates", label: "Templates" },
  ]} />
);

/** Purposes staff can pick for a one-off message. Refill, balance and announcements need the customer's opt-in. */
export const PURPOSE_LABELS = {
  service: "Customer service", order: "Order update", refill: "Refill reminder", balance: "Account balance", marketing: "Announcement",
} as const;
export const NEEDS_OPT_IN = new Set(["refill", "balance", "marketing"]);

/** Labels for every purpose that can appear in the log (system ones included). */
export const ALL_PURPOSE_LABELS: Record<string, string> = {
  ...PURPOSE_LABELS, receipt: "Receipt", operations: "Owner summary", purchase_order: "Purchase order", reply: "Reply",
};
