import type { Metadata } from "next";
import {
  verifyWatchdogToken,
  type WatchdogTokenAction,
} from "@/lib/watchdog-tokens";

export const metadata: Metadata = {
  title: "Spravovat hlídač · Bytomat",
  // Tokenized landing — never index.
  robots: { index: false, follow: false },
};

interface PageProps {
  // Next.js 15: searchParams arrives as a Promise.
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

type Outcome =
  | { kind: "deleted" }
  | { kind: "already_deleted" }
  | { kind: "paused" }
  | { kind: "manage_landing" }
  | { kind: "invalid_token" }
  | { kind: "no_token" }
  | { kind: "error" };

/**
 * Lazy import of `@flat-finder/db` to keep Next's build-time analyzer
 * from bundling the postgres-js + drizzle graph into the static page.
 * Same pattern the sitemap-listings route uses.
 */
async function performAction(
  watchdogId: number,
  action: WatchdogTokenAction,
): Promise<Outcome> {
  try {
    const dbModule = await import("@flat-finder/db");
    const { getDb, deleteWatchdog, toggleWatchdog } = dbModule;
    const db = getDb();

    if (action === "unsubscribe") {
      const ok = await deleteWatchdog(db, watchdogId);
      // deleteWatchdog returns true even on no-op (row exists, already
      // deleted). The caller cannot easily distinguish "just deleted"
      // from "already deleted" without a second read — and for the user
      // the experience is the same. We treat both as success.
      return ok ? { kind: "deleted" } : { kind: "already_deleted" };
    }
    if (action === "pause") {
      const result = await toggleWatchdog(db, watchdogId);
      return result ? { kind: "paused" } : { kind: "invalid_token" };
    }
    return { kind: "manage_landing" };
  } catch (err) {
    console.error("[watchdog/manage] action failed", err);
    return { kind: "error" };
  }
}

export default async function WatchdogManagePage({ searchParams }: PageProps) {
  const params = await searchParams;
  const tokenRaw =
    typeof params.token === "string" ? params.token : undefined;

  let outcome: Outcome;
  if (!tokenRaw) {
    outcome = { kind: "no_token" };
  } else {
    const payload = verifyWatchdogToken(
      tokenRaw,
      process.env.WATCHDOG_TOKEN_SECRET,
    );
    if (!payload) {
      outcome = { kind: "invalid_token" };
    } else {
      outcome = await performAction(payload.watchdogId, payload.action);
    }
  }

  const { headline, body } = renderCopy(outcome);

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#F9F4EA",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "32px 16px",
        fontFamily:
          "'Figtree', -apple-system, BlinkMacSystemFont, 'Helvetica Neue', Helvetica, Arial, sans-serif",
        color: "#241F18",
      }}
    >
      <section
        style={{
          width: "100%",
          maxWidth: 560,
          background: "#FFFFFF",
          padding: "48px 40px",
          borderRadius: 4,
          border: "1px solid #E8DDC9",
        }}
      >
        <p
          style={{
            margin: "0 0 12px 0",
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: "#1C5848",
          }}
        >
          Hlídač nemovitostí
        </p>
        <h1
          style={{
            margin: "0 0 20px 0",
            fontFamily:
              "'Bricolage Grotesque', 'Helvetica Neue', Helvetica, Arial, sans-serif",
            fontSize: 32,
            lineHeight: "38px",
            fontWeight: 600,
            letterSpacing: "-0.02em",
          }}
        >
          {headline}
        </h1>
        <p
          style={{
            margin: "0 0 24px 0",
            fontSize: 15,
            lineHeight: "24px",
            color: "#6E6657",
          }}
        >
          {body}
        </p>
        <a
          href="https://bytomat.com/"
          style={{
            display: "inline-block",
            background: "#1C5848",
            color: "#FFFFFF",
            fontSize: 14,
            fontWeight: 600,
            letterSpacing: "0.02em",
            padding: "12px 24px",
            textDecoration: "none",
          }}
        >
          Zpět na Bytomat.cz
        </a>
      </section>
    </main>
  );
}

function renderCopy(outcome: Outcome): { headline: string; body: string } {
  switch (outcome.kind) {
    case "deleted":
      return {
        headline: "Hlídač byl vypnut.",
        body: "Už ti nebudeme posílat e-maily k tomuto hlídači. Pokud sis to rozmyslel, můžeš si kdykoli vytvořit nový.",
      };
    case "already_deleted":
      return {
        headline: "Hlídač už byl vypnut.",
        body: "Tento hlídač jsme už dříve vypnuli. Žádné další e-maily ti k němu chodit nebudou.",
      };
    case "paused":
      return {
        headline: "Hlídač pozastaven.",
        body: "Pozastavili jsme tento hlídač. Můžeš ho kdykoli znovu spustit ve své správě hlídačů.",
      };
    case "manage_landing":
      return {
        headline: "Spravovat hlídač",
        body: "Otevři Bytomat.cz a v profilu hlídačů můžeš upravit filtry nebo svůj hlídač pozastavit.",
      };
    case "invalid_token":
      return {
        headline: "Tento odkaz je neplatný.",
        body: "Odkaz je poškozený, byl pozměněn nebo už neplatí. Pokud potřebuješ něco upravit, napiš nám na podpora@bytomat.com.",
      };
    case "no_token":
      return {
        headline: "Spravovat hlídač",
        body: "Tato stránka funguje pouze přes odkaz z e-mailu. Pokud chceš spravovat svého hlídače, klikni na odkaz v posledním e-mailu.",
      };
    case "error":
      return {
        headline: "Něco se nepovedlo.",
        body: "Při zpracování tvého požadavku došlo k chybě. Zkus to prosím znovu nebo nám napiš na podpora@bytomat.com.",
      };
  }
}
