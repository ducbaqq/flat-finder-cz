"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Search, Map, Dog } from "lucide-react";
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
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t bg-background/95 backdrop-blur-md md:hidden">
      <div className="flex h-16 items-center justify-around">
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
                "flex flex-col items-center gap-0.5 px-3 py-2 text-xs transition-colors",
                isActive
                  ? "text-primary"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon className="h-5 w-5" />
              {label}
            </Link>
          );
        })}
        <button
          onClick={toggleWatchdogModal}
          className="flex flex-col items-center gap-0.5 px-3 py-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <Dog className="h-5 w-5" />
          Hlídací pes
        </button>
      </div>
    </nav>
  );
}
