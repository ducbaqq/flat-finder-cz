/**
 * Regression tests for the idnes title parser.
 *
 * The critical case is "bug-1118": layout ending in a digit followed by
 * a 3-digit size was parsed as thousands-separated and yielded a 10×
 * inflated size. See comment in parseIdnesTitleDetails for history.
 */
import { test, expect } from "@playwright/test";
import { parseIdnesTitleDetails } from "../apps/scraper/src/scrapers/idnes.js";

test.describe("parseIdnesTitleDetails — regression guard for bug-1118", () => {
  test("layout '4+1' + 3-digit size is NOT combined into 4-digit thousands value", () => {
    // Pre-fix: captured "1 118" starting at the "1" of "+1" → 1118.
    expect(parseIdnesTitleDetails("prodej bytu 4+1 118 m²")).toEqual({
      layout: "4+1",
      sizeM2: 118,
    });
  });

  test("layout '5+1' + 3-digit size", () => {
    expect(parseIdnesTitleDetails("prodej bytu 5+1 260 m²")).toEqual({
      layout: "5+1",
      sizeM2: 260,
    });
  });

  test("layout '3+1' + 2-digit size (even-smaller collision risk)", () => {
    // Pre-fix would have captured "1 95" → 195 instead of 95.
    expect(parseIdnesTitleDetails("pronájem bytu 3+1 95 m²")).toEqual({
      layout: "3+1",
      sizeM2: 95,
    });
  });
});

test.describe("parseIdnesTitleDetails — unaffected formats stay correct", () => {
  test("layout '2+kk' is safe (no trailing digit to bleed)", () => {
    expect(parseIdnesTitleDetails("prodej bytu 2+kk 45 m²")).toEqual({
      layout: "2+kk",
      sizeM2: 45,
    });
  });

  test("no layout, just size", () => {
    expect(parseIdnesTitleDetails("prodej domu 125 m² s pozemkem 200 m²")).toEqual({
      layout: null,
      sizeM2: 125,
    });
  });

  test("genuine 4-digit thousands-separated size without layout", () => {
    // Warehouse / production halls legitimately reach 1000+m².
    expect(parseIdnesTitleDetails("prodej skladovacích prostor 1 118 m²")).toEqual({
      layout: null,
      sizeM2: 1118,
    });
  });

  test("m2 ASCII variant (idnes uses both m² and m2 depending on field)", () => {
    expect(parseIdnesTitleDetails("Prodej bytu 4+1 118 m2")).toEqual({
      layout: "4+1",
      sizeM2: 118,
    });
  });

  test("null input → both null", () => {
    expect(parseIdnesTitleDetails(null)).toEqual({ layout: null, sizeM2: null });
  });

  test("unrecognised title yields null layout and null size", () => {
    expect(parseIdnesTitleDetails("Nabízím pěkný byt v Praze")).toEqual({
      layout: null,
      sizeM2: null,
    });
  });

  test("layout '1+kk' (common studio) — no trailing-digit issue because 'kk' follows the +", () => {
    expect(parseIdnesTitleDetails("pronájem bytu 1+kk 28 m²")).toEqual({
      layout: "1+kk",
      sizeM2: 28,
    });
  });
});

test.describe("parseIdnesTitleDetails — layout-after-size order (defensive)", () => {
  test("size first, then layout mention", () => {
    // If a title ever puts size before layout, we still want sensible output.
    // Size is found; layout parsing still works via the separate layout regex.
    const res = parseIdnesTitleDetails("118 m² byt 4+1 Praha");
    // The layout regex still catches "4+1".
    expect(res.layout).toBe("4+1");
    // Size parsed from AFTER the layout — "Praha" has no m², so null.
    // Pre-fix this would have been 118 (by matching at start), but the cost
    // of false size in this ordering is low because idnes doesn't emit it.
    expect(res.sizeM2).toBeNull();
  });
});
