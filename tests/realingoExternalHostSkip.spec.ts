import { test, expect } from "@playwright/test";

// The helper is not exported — test it via a clone of the same logic.
// Keeping this file small and self-contained on purpose: the full shape
// of realingo.ts imports pLimit etc. that slow tests down.

const EXTERNALLY_COVERED_HOSTS = [
  "sreality.cz",
  "bezrealitky.cz",
  "ulovdomov.cz",
  "bazos.cz",
  "ereality.cz",
  "eurobydleni.cz",
  "ceskereality.cz",
  "realitymix.cz",
  "realitymix.com",
  "idnes.cz",
] as const;

function isExternallyCoveredUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  let hostname: string;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return EXTERNALLY_COVERED_HOSTS.some(
    (host) => hostname === host || hostname.endsWith(`.${host}`),
  );
}

test.describe("realingo external-host skip", () => {
  const cases: Array<[string | null | undefined, boolean]> = [
    // Directly-scraped hosts → skip
    ["https://www.sreality.cz/detail/prodej/byt/1+kk/x/12345", true],
    ["https://reality.bazos.cz/inzerat/216915749/pronajem-bytu-11-krnsko.php", true],
    ["https://stredo.ceskereality.cz/detail/flat-12345", true],
    ["https://severo.ceskereality.cz/prodej/...", true],
    ["https://jiho.ceskereality.cz/foo", true],
    ["https://reality.idnes.cz/detail/prodej/byt/.../abcd1234/", true],
    ["https://www.bezrealitky.cz/nemovitosti-byty-domy/1007075", true],
    ["https://www.ulovdomov.cz/inzerat/x/123", true],
    ["https://www.ereality.cz/detail/foo/hash", true],
    ["https://www.eurobydleni.cz/foo/detail/10112310/", true],
    ["https://realitymix.cz/detail/foo", true],

    // Not in our scraper set → keep
    ["https://jiho.moravskereality.cz/detail/foo", false],
    ["https://severo.moravskereality.cz/detail/foo", false],
    ["https://www.remax-czech.cz/reality/123", false],
    ["https://www.realcity.cz/nemovitost/abc", false],

    // Defensive cases
    [null, false],
    [undefined, false],
    ["", false],
    // Decoy: substring without a host separator — should NOT match
    ["https://my-bazos.cz-lookalike.com/foo", false],
    ["https://bazos.cz.phishing.example/foo", false],
  ];

  for (const [url, expected] of cases) {
    test(`${expected ? "skip" : "keep"}: ${String(url).slice(0, 60) || "(empty)"}`, () => {
      expect(isExternallyCoveredUrl(url)).toBe(expected);
    });
  }
});
