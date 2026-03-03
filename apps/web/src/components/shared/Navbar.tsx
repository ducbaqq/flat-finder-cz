"use client";

import Link from "next/link";
import { Dog, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Logo } from "./Logo";
import { ThemeToggle } from "./ThemeToggle";
import { useUiStore } from "@/store/ui-store";
import { useWatchdogs } from "@/hooks/useWatchdogs";

export function Navbar() {
  const toggleWatchdogModal = useUiStore((s) => s.toggleWatchdogModal);
  const { activeCount } = useWatchdogs();

  return (
    <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur-md supports-[backdrop-filter]:bg-background/60">
      <nav className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
        <Logo />

        <div className="hidden items-center gap-1 md:flex">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/search">
              <Search className="mr-1.5 h-4 w-4" />
              Hledat
            </Link>
          </Button>
        </div>

        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="relative h-9 w-9"
            onClick={toggleWatchdogModal}
          >
            <Dog className="h-4 w-4" />
            {activeCount > 0 && (
              <Badge className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px]">
                {activeCount}
              </Badge>
            )}
            <span className="sr-only">Hlídací pes</span>
          </Button>
          <ThemeToggle />
        </div>
      </nav>
    </header>
  );
}
