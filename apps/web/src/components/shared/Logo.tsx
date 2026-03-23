import Link from "next/link";
import { cn } from "@/lib/cn";

interface LogoProps {
  className?: string;
}

export function Logo({ className }: LogoProps) {
  return (
    <Link
      href="/"
      className={cn("flex items-center gap-2.5 text-foreground", className)}
      data-testid="logo"
    >
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-lg font-bold text-white font-display" data-testid="logo-icon">
        D
      </div>
      <div className="flex flex-col leading-none">
        <span className="text-lg font-bold tracking-tight font-display" data-testid="logo-text">
          Domov.cz
        </span>
        <span className="text-[10px] text-muted-foreground" data-testid="logo-tagline">Najděte svůj domov</span>
      </div>
    </Link>
  );
}
