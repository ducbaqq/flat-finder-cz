import { Logo } from "./Logo";

const SOURCES = [
  { label: "sreality.cz", href: "https://www.sreality.cz" },
  { label: "reality.idnes.cz", href: "https://reality.idnes.cz" },
  { label: "reality.bazos.cz", href: "https://reality.bazos.cz" },
  { label: "ceskereality.cz", href: "https://www.ceskereality.cz" },
  { label: "bezrealitky.cz", href: "https://www.bezrealitky.cz" },
  { label: "ulovdomov.cz", href: "https://www.ulovdomov.cz" },
  { label: "realitymix.cz", href: "https://realitymix.cz" },
  { label: "ereality.cz", href: "https://www.ereality.cz" },
  { label: "eurobydleni.cz", href: "https://www.eurobydleni.cz" },
  { label: "realingo.cz", href: "https://www.realingo.cz" },
];

export function Footer() {
  return (
    <footer className="border-t border-divider bg-card pb-20 md:pb-0" data-testid="app-footer">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          <div data-testid="footer-about">
            <Logo className="mb-3" />
            <p className="text-sm text-muted-foreground">
              Hledáte byt nebo dům v Česku? Prohledáváme všechny největší
              portály na jednom místě.
            </p>
          </div>

          <div data-testid="footer-navigation">
            <h3 className="mb-3 text-sm font-semibold font-display">
              Navigace
            </h3>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li>
                <a
                  href="/"
                  className="transition-colors hover:text-foreground"
                  data-testid="footer-link-home"
                >
                  Domů
                </a>
              </li>
              <li>
                <a
                  href="/search"
                  className="transition-colors hover:text-foreground"
                  data-testid="footer-link-search"
                >
                  Hledat
                </a>
              </li>
            </ul>
          </div>

          <div data-testid="footer-sources">
            <h3 className="mb-3 text-sm font-semibold font-display">Zdroje</h3>
            <ul className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm text-muted-foreground">
              {SOURCES.map(({ label, href }) => (
                <li key={href}>
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="transition-colors hover:text-foreground"
                  >
                    {label}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          <div data-testid="footer-contact">
            <h3 className="mb-3 text-sm font-semibold font-display">
              Kontakt
            </h3>
            <p className="text-sm text-muted-foreground">
              Bytomat.cz je nekomerční projekt pro agregaci nabídek nemovitostí.
            </p>
          </div>
        </div>

        <div className="mt-8 border-t border-divider pt-6 text-center text-xs text-muted-foreground" data-testid="footer-copyright">
          &copy; {new Date().getFullYear()} bytomat.cz
        </div>
      </div>
    </footer>
  );
}
