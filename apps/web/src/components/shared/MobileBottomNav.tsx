"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Search, Map, Bell } from "lucide-react";
import { cn } from "@/lib/cn";
import { useUiStore } from "@/store/ui-store";

const items = [
  { href: "/", icon: Home, label: "Domov" },
  { href: "/search", icon: Search, label: "Hledat" },
  { href: "/search?view=map", icon: Map, label: "Mapa" },
] as const;

export function MobileBottomNav() {
  const pathname = usePathname();
  const toggleWatchdogModal = useUiStore((s) => s.toggleWatchdogModal);

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 border-t border-divider bg-background/90 backdrop-blur-xl md:hidden"
      data-testid="mobile-bottom-nav"
    >
      <div className="flex h-14 items-center justify-around">
        {items.map(({ href, icon: Icon, label }) => {
          const isActive =
            href === "/"
              ? pathname === "/"
              : pathname.startsWith(href.split("?")[0]);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex flex-col items-center gap-0.5 px-3 py-1.5 text-[11px] font-medium transition-colors",
                isActive
                  ? "text-primary"
                  : "text-muted-foreground"
              )}
              data-testid={`mobile-nav-${label.toLowerCase()}`}
            >
              <Icon className="h-5 w-5" strokeWidth={isActive ? 2.5 : 1.5} />
              {label}
            </Link>
          );
        })}
        <button
          onClick={toggleWatchdogModal}
          className="flex flex-col items-center gap-0.5 px-3 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors"
          data-testid="mobile-nav-alerts"
        >
          <Bell className="h-5 w-5" strokeWidth={1.5} />
          Alerty
        </button>
      </div>
    </nav>
  );
}
