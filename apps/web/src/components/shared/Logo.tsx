import Link from "next/link";
import { cn } from "@/lib/cn";

interface LogoProps {
  className?: string;
}

export function Logo({ className }: LogoProps) {
  return (
    <Link
      href="/"
      className={cn("flex items-center gap-2 text-foreground", className)}
      data-testid="logo"
    >
      <span
        className="font-display text-xl font-semibold tracking-tight"
        data-testid="logo-text"
      >
        bytomat
        <span className="text-primary">.cz</span>
      </span>
    </Link>
  );
}
