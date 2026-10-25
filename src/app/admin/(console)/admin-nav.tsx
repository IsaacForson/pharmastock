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
    <nav aria-label="Control" className="flex gap-1 overflow-x-auto lg:flex-col">
      {items.map((i) => {
        const Icon = ICONS[i.icon];
        const active = i.href === "/admin" ? path === "/admin" : path.startsWith(i.href);
        return (
          <Link key={i.href} href={i.href} aria-current={active ? "page" : undefined}
            className={cx("relative flex items-center gap-3 whitespace-nowrap rounded-2xl px-3 py-2.5 text-[13.5px] font-medium transition",
              active ? "bg-surface-3 text-fg" : "text-muted hover:bg-surface-2 hover:text-fg")}>
            {active && <span className="absolute inset-0 rounded-2xl ring-aurora" aria-hidden />}
            <Icon className={cx("h-[18px] w-[18px]", active ? "text-accent-2" : "text-subtle")} aria-hidden />{i.label}
          </Link>
        );
      })}
    </nav>
  );
}
