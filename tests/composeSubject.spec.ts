import { test, expect } from "@playwright/test";
import { composeSubject } from "../apps/notifier/src/subject.js";

test.describe("composeSubject (Czech plurals)", () => {
  const summary = "Praha · Pronájem · 2+kk";

  const cases: Array<[number, string]> = [
    [1, `1 nová nabídka: ${summary}`],
    [2, `2 nové nabídky: ${summary}`],
    [3, `3 nové nabídky: ${summary}`],
    [4, `4 nové nabídky: ${summary}`],
    [5, `5 nových nabídek: ${summary}`],
    [10, `10 nových nabídek: ${summary}`],
    [100, `100 nových nabídek: ${summary}`],
  ];

  for (const [count, expected] of cases) {
    test(`count=${count}`, () => {
      expect(composeSubject(count, summary)).toBe(expected);
    });
  }

  test("empty summary still produces a valid subject (no trailing colon)", () => {
    expect(composeSubject(1, "")).toBe("1 nová nabídka");
    expect(composeSubject(3, "  ")).toBe("3 nové nabídky");
    expect(composeSubject(5, "")).toBe("5 nových nabídek");
  });
});
