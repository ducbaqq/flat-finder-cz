import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Spravovat hlídač · Bytomat",
  // The page renders only a placeholder while the unsubscribe / pause /
  // manage flows are being built — keep it out of the search index.
  robots: { index: false, follow: false },
};

interface PageProps {
  // Next.js 15 server-component pattern: searchParams arrives as a Promise.
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * Stub landing for the URLs the watchdog notifier emits in
 * unsubscribe / pause / manage links. The notifier signs these with
 * HMAC-SHA256 (see apps/notifier/src/tokens.ts) but verification +
 * action handling lands with a follow-up agent. v1 just shows a
 * placeholder so the URLs in already-sent emails resolve to a real page
 * instead of 404.
 */
export default async function WatchdogManagePage({ searchParams }: PageProps) {
  const params = await searchParams;
  const hasToken =
    typeof params.token === "string" && params.token.length > 0;

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
          Tato stránka bude brzy aktivní.
        </h1>
        <p
          style={{
            margin: "0 0 16px 0",
            fontSize: 15,
            lineHeight: "24px",
            color: "#6E6657",
          }}
        >
          Pracujeme na samoobsluze pro pozastavení a odhlášení hlídače.
          Pokud potřebuješ provést změnu hned, napiš nám prosím na{" "}
          <a
            href="mailto:podpora@bytomat.com"
            style={{ color: "#1C5848", textDecoration: "underline" }}
          >
            podpora@bytomat.com
          </a>
          .
        </p>
        {hasToken ? (
          <p style={{ margin: 0, fontSize: 13, color: "#A89B82" }}>
            Tvůj odkaz jsme přijali a uložíme jej, jakmile bude správa hlídače
            spuštěna.
          </p>
        ) : null}
      </section>
    </main>
  );
}
