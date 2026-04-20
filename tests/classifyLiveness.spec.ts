import { test, expect } from "@playwright/test";
import type { LivenessResponse } from "../apps/scraper/src/base-scraper.js";
import { SrealityScraper } from "../apps/scraper/src/scrapers/sreality.js";
import { IdnesScraper } from "../apps/scraper/src/scrapers/idnes.js";
import { BezrealitkyScraper } from "../apps/scraper/src/scrapers/bezrealitky.js";

const commonOpts = {
  rps: 1,
  concurrency: 1,
  maxRetries: 0,
  retryBaseMs: 0,
  timeoutMs: 1_000,
};

function res(partial: Partial<LivenessResponse>): LivenessResponse {
  return {
    status: 200,
    location: "",
    url: "",
    body: "",
    networkError: false,
    ...partial,
  };
}

test.describe("classifyLiveness — sreality", () => {
  const sreality = new SrealityScraper({ ...commonOpts });

  test("410 Gone → dead", () => {
    expect(sreality.classifyLiveness(res({ status: 410 }))).toBe("dead");
  });

  test("404 Not Found → dead", () => {
    expect(sreality.classifyLiveness(res({ status: 404 }))).toBe("dead");
  });

  test("200 OK → alive", () => {
    expect(sreality.classifyLiveness(res({ status: 200 }))).toBe("alive");
  });

  test("301 to /detail/ slug-correction → alive", () => {
    expect(
      sreality.classifyLiveness(
        res({
          status: 301,
          location:
            "https://www.sreality.cz/detail/prodej/byt/3+kk/praha-vinohrady/970748748",
        }),
      ),
    ).toBe("alive");
  });

  test("301 to search landing → dead", () => {
    expect(
      sreality.classifyLiveness(
        res({
          status: 301,
          location: "https://www.sreality.cz/hledani/prodej/byty",
        }),
      ),
    ).toBe("dead");
  });

  test("301 to root → dead", () => {
    expect(
      sreality.classifyLiveness(
        res({ status: 301, location: "https://www.sreality.cz/" }),
      ),
    ).toBe("dead");
  });

  test("500 → unknown (don't deactivate on transient errors)", () => {
    expect(sreality.classifyLiveness(res({ status: 500 }))).toBe("unknown");
  });

  test("network error → unknown", () => {
    expect(
      sreality.classifyLiveness(res({ status: 0, networkError: true })),
    ).toBe("unknown");
  });
});

test.describe("classifyLiveness — idnes", () => {
  const idnes = new IdnesScraper({ ...commonOpts, skipEnrichmentHours: 24 });

  test("404 → dead", () => {
    expect(idnes.classifyLiveness(res({ status: 404 }))).toBe("dead");
  });

  test("200 + removal banner Czech → dead (soft-404)", () => {
    expect(
      idnes.classifyLiveness(
        res({
          status: 200,
          body: "<html>tato nabídka již není inzerována, zkuste jinou</html>",
        }),
      ),
    ).toBe("dead");
  });

  test("200 + 'inzerát byl ukončen' → dead", () => {
    expect(
      idnes.classifyLiveness(
        res({ status: 200, body: "bla bla inzerát byl ukončen, atd." }),
      ),
    ).toBe("dead");
  });

  test("200 + normal listing body → alive", () => {
    expect(
      idnes.classifyLiveness(
        res({
          status: 200,
          body: "<html>pronájem bytu praha ... kontakt realitní makléř</html>",
        }),
      ),
    ).toBe("alive");
  });

  test("301 to category landing → dead", () => {
    expect(
      idnes.classifyLiveness(
        res({
          status: 301,
          location: "https://reality.idnes.cz/s/pronajem/",
        }),
      ),
    ).toBe("dead");
  });

  test("301 to another detail → alive", () => {
    expect(
      idnes.classifyLiveness(
        res({
          status: 301,
          location:
            "https://reality.idnes.cz/detail/pronajem/byt/praha/2+kk/abcd1234/",
        }),
      ),
    ).toBe("alive");
  });

  test("429 → unknown (don't deactivate under rate limiting)", () => {
    expect(idnes.classifyLiveness(res({ status: 429 }))).toBe("unknown");
  });
});

test.describe("classifyLiveness — bezrealitky", () => {
  const br = new BezrealitkyScraper({ ...commonOpts });

  test("404 → dead", () => {
    expect(br.classifyLiveness(res({ status: 404 }))).toBe("dead");
  });

  test("301 to /nemovitosti-byty-domy/ detail → alive", () => {
    expect(
      br.classifyLiveness(
        res({
          status: 301,
          location:
            "https://www.bezrealitky.cz/nemovitosti-byty-domy/abcd-1234",
        }),
      ),
    ).toBe("alive");
  });

  test("301 to category landing → dead", () => {
    expect(
      br.classifyLiveness(
        res({ status: 301, location: "https://www.bezrealitky.cz/vypis" }),
      ),
    ).toBe("dead");
  });

  test("403 → unknown (could be IP block, not dead listing)", () => {
    expect(br.classifyLiveness(res({ status: 403 }))).toBe("unknown");
  });

  test("200 → alive", () => {
    expect(br.classifyLiveness(res({ status: 200 }))).toBe("alive");
  });
});
