import { Logo } from "./Logo";

export function Footer() {
  return (
    <footer
      className="border-t border-divider bg-background pb-20 md:pb-0"
      data-testid="app-footer"
    >
      <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          <div data-testid="footer-about">
            <Logo className="mb-4" />
            <p className="max-w-xs text-sm leading-relaxed text-muted-foreground">
              Prohledáváme 10 největších českých realitních portálů na jednom
              místě. Byty, domy, pronájem i prodej.
            </p>
          </div>

          <div data-testid="footer-navigation">
            <h3 className="mb-3 text-sm font-semibold tracking-wide uppercase text-muted-foreground">
              Navigace
            </h3>
            <ul className="space-y-2.5 text-sm">
              <li>
                <a
                  href="/"
                  className="text-foreground/70 transition-colors hover:text-foreground"
                  data-testid="footer-link-home"
                >
                  Domů
                </a>
              </li>
              <li>
                <a
                  href="/search"
                  className="text-foreground/70 transition-colors hover:text-foreground"
                  data-testid="footer-link-search"
                >
                  Hledat
                </a>
              </li>
              <li>
                <a
                  href="/filter"
                  className="text-foreground/70 transition-colors hover:text-foreground"
                  data-testid="footer-link-filter"
                >
                  Filtry
                </a>
              </li>
            </ul>
          </div>

          <div data-testid="footer-sources">
            <h3 className="mb-3 text-sm font-semibold tracking-wide uppercase text-muted-foreground">
              Zdroje
            </h3>
            <ul className="space-y-2.5 text-sm">
              <li>
                <a
                  href="https://www.sreality.cz"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-foreground/70 transition-colors hover:text-foreground"
                >
                  sreality.cz
                </a>
              </li>
              <li>
                <a
                  href="https://www.bezrealitky.cz"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-foreground/70 transition-colors hover:text-foreground"
                >
                  bezrealitky.cz
                </a>
              </li>
              <li>
                <a
                  href="https://www.ulovdomov.cz"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-foreground/70 transition-colors hover:text-foreground"
                >
                  ulovdomov.cz
                </a>
              </li>
            </ul>
          </div>

          <div data-testid="footer-contact">
            <h3 className="mb-3 text-sm font-semibold tracking-wide uppercase text-muted-foreground">
              O projektu
            </h3>
            <p className="text-sm leading-relaxed text-foreground/70">
              Bytomat.cz je nekomerční projekt pro agregaci nabídek nemovitostí v
              České republice.
            </p>
          </div>
        </div>

        <div
          className="mt-10 border-t border-divider pt-6 text-center text-xs text-muted-foreground"
          data-testid="footer-copyright"
        >
          &copy; {new Date().getFullYear()} bytomat.com
        </div>
      </div>
    </footer>
  );
}
