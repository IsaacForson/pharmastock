"use client";
import { Activity, Building2, CircleDollarSign, Coins, Gauge, ScrollText, Siren, Users } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "@/components/ui";

const ICONS = { Gauge, Building2, Siren, CircleDollarSign, Coins, Activity, Users, ScrollText };
export type AdminNavItem = { href: string; label: string; icon: keyof typeof ICONS };

export function AdminNav({ items }: { items: AdminNavItem[] }) {
  const path = usePathname();
  return (
    <nav aria-label="Control" className="flex h-10 items-stretch gap-1 overflow-x-auto">
      {items.map((i) => {
        const Icon = ICONS[i.icon];
        const active = i.href === "/admin" ? path === "/admin" : path.startsWith(i.href);
        return (
          <Link key={i.href} href={i.href} aria-current={active ? "page" : undefined}
            className={cx("-mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 px-2.5 text-[13px] transition-colors",
              active ? "border-accent font-semibold text-fg" : "border-transparent text-muted hover:text-fg")}>
            <Icon className={cx("h-[15px] w-[15px]", active ? "text-accent" : "text-subtle")} aria-hidden />{i.label}
          </Link>
        );
      })}
    </nav>
  );
}
