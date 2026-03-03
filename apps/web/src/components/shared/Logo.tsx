import Link from "next/link";
import { Home } from "lucide-react";
import { cn } from "@/lib/cn";

interface LogoProps {
  className?: string;
}

export function Logo({ className }: LogoProps) {
  return (
    <Link
      href="/"
      className={cn("flex items-center gap-2 text-foreground", className)}
    >
      <Home className="h-6 w-6 text-primary" />
      <span className="text-lg font-bold tracking-tight">
        flat<span className="text-primary">finder</span>
      </span>
    </Link>
  );
}
