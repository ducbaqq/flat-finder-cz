import Link from "next/link";
import { Home } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 text-center" data-testid="not-found-page">
      <h1 className="text-6xl font-bold text-primary" data-testid="not-found-code">404</h1>
      <h2 className="mt-4 text-2xl font-semibold" data-testid="not-found-title">Stránka nenalezena</h2>
      <p className="mt-2 max-w-md text-muted-foreground" data-testid="not-found-message">
        Omlouváme se, ale stránka kterou hledáte neexistuje nebo byla
        přesunuta.
      </p>
      <Button asChild className="mt-6" data-testid="not-found-home-button">
        <Link href="/">
          <Home className="mr-2 h-4 w-4" />
          Zpět na hlavní stránku
        </Link>
      </Button>
    </div>
  );
}
