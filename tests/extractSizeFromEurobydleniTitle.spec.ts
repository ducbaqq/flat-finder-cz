import { test, expect } from "@playwright/test";
import { extractSizeFromEurobydleniTitle } from "../apps/scraper/src/scrapers/eurobydleni.js";

// Titles below are verbatim from the 2026-04-20 audit of eurobydleni
// listings where size_m2 was NOT populated. Each case documents one of
// the phrasings the detail-page title uses.

test.describe("extractSizeFromEurobydleniTitle", () => {
  const cases: Array<[string, number | null]> = [
    ["Prodej bytu 2+1, 51 m, Aš, ul. Moravská", 51],
    ["Byt 4+1 na prodej Znojmo o výměře 156 m2 jenom za 8 990 000 Kč", 156],
    ["Prodej bytu 1+kk Prostějov, Vrahovice za pěkných 3 190 000 Kč s rozlohou 113 m2", 113],
    ["Byt 2+1 na prodej Brno, Maloměřice a plochou 79 m2 jenom za 6 790 000 Kč", 79],
    ["Prodej bytu 3+kk Brandýs nad Labem nyní za 9 490 000 Kč o velikosti 109 m2", 109],
    ["Byt 2+kk na prodej Brno, Líšeň a plochou 186 m2 nyní za 5 750 000 Kč", 186],
    ["Byt 3+1 na prodej Bohumín, Záblatí o ploše 78 m2 jenom za 3 500 000 Kč", 78],
    ["Prodej bytu 3+1 Černošice za pěkných 9 400 000 Kč s rozlohou 86 m2", 86],
    // Bare "m" without exponent, with a keyword earlier in the string.
    ["Prodej bytu 2+kk o ploše 42 m, Praha 4", 42],
    // No size mention at all.
    ["Prodej garáže Praha 2", null],
    // Purely numeric title without m unit — should not match.
    ["Listing 12345", null],
  ];

  for (const [title, expected] of cases) {
    test(`'${title.slice(0, 50)}…' → ${expected}`, () => {
      expect(extractSizeFromEurobydleniTitle(title)).toBe(expected);
    });
  }
});
