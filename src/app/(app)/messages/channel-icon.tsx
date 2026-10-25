import { Mail, MessageCircle, Smartphone } from "lucide-react";
import { cx } from "@/components/ui";

const MAP = {
  whatsapp: { icon: MessageCircle, cls: "bg-ok/12 text-ok border-ok/25", label: "WhatsApp" },
  sms: { icon: Smartphone, cls: "bg-info/12 text-info border-info/25", label: "SMS" },
  email: { icon: Mail, cls: "bg-accent/12 text-accent border-accent/25", label: "Email" },
} as const;

/** Small tile for a message channel; falls back to SMS styling for unknown channels. */
export function ChannelIcon({ channel, withLabel }: { channel: string; withLabel?: boolean }) {
  const c = MAP[channel as keyof typeof MAP] ?? MAP.sms;
  const Icon = c.icon;
  return (
    <span className="inline-flex items-center gap-2" title={c.label}>
      <span className={cx("grid h-7 w-7 shrink-0 place-items-center rounded-lg border", c.cls)}><Icon className="h-3.5 w-3.5" aria-label={withLabel ? undefined : c.label} /></span>
      {withLabel && <span className="text-sm text-fg">{c.label}</span>}
    </span>
  );
}
