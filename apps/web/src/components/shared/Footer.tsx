import { Logo } from "./Logo";

export function Footer() {
  return (
    <footer className="border-t bg-card">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <Logo className="mb-3" />
            <p className="text-sm text-muted-foreground">
              Hledáte byt nebo dům v Česku? Prohledáváme 3 největší portály na
              jednom místě.
            </p>
          </div>

          <div>
            <h3 className="mb-3 text-sm font-semibold">Navigace</h3>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li>
                <a href="/" className="hover:text-foreground transition-colors">
                  Domů
                </a>
              </li>
              <li>
                <a
                  href="/search"
                  className="hover:text-foreground transition-colors"
                >
                  Hledat
                </a>
              </li>
            </ul>
          </div>

          <div>
            <h3 className="mb-3 text-sm font-semibold">Zdroje</h3>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li>
                <a
                  href="https://www.sreality.cz"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-foreground transition-colors"
                >
                  sreality.cz
                </a>
              </li>
              <li>
                <a
                  href="https://www.bezrealitky.cz"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-foreground transition-colors"
                >
                  bezrealitky.cz
                </a>
              </li>
              <li>
                <a
                  href="https://www.ulovdomov.cz"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-foreground transition-colors"
                >
                  ulovdomov.cz
                </a>
              </li>
            </ul>
          </div>

          <div>
            <h3 className="mb-3 text-sm font-semibold">Kontakt</h3>
            <p className="text-sm text-muted-foreground">
              Flat Finder CZ je nekomerční projekt pro agregaci nabídek
              nemovitostí.
            </p>
          </div>
        </div>

        <div className="mt-8 border-t pt-6 text-center text-xs text-muted-foreground">
          © {new Date().getFullYear()} Flat Finder CZ. Všechna práva vyhrazena.
        </div>
      </div>
    </footer>
  );
}
