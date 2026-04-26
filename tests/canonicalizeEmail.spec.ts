import { test, expect } from "@playwright/test";
import { canonicalizeEmail } from "../packages/db/src/utils/canonicalize-email.js";

test.describe("canonicalizeEmail", () => {
  const ok: Array<[string, string]> = [
    // case + whitespace
    ["Foo@Example.COM", "foo@example.com"],
    ["  user@host.com  ", "user@host.com"],
    // gmail +alias and dots
    ["email+1@gmail.com", "email@gmail.com"],
    ["e.m.a.i.l@gmail.com", "email@gmail.com"],
    // non-gmail dots are preserved
    ["first.last@example.com", "first.last@example.com"],
    // googlemail unification
    ["foo@googlemail.com", "foo@gmail.com"],
    ["First.Last+work@GoogleMail.com", "firstlast@gmail.com"],
    // realistic input
    ["JOHN.DOE+newsletter@gmail.com", "johndoe@gmail.com"],
  ];

  for (const [input, expected] of ok) {
    test(`canonicalizes "${input}" → "${expected}"`, () => {
      expect(canonicalizeEmail(input)).toBe(expected);
    });
  }

  const errs: Array<[string | unknown, string]> = [
    ["+only@gmail.com", "empty local after +alias strip"],
    ["noatsign", "missing @"],
    ["a@b@c", "multiple @"],
    ["@host", "empty local"],
    ["local@", "empty domain"],
    ["", "empty input"],
    ["   ", "whitespace-only"],
  ];

  for (const [input, why] of errs) {
    test(`throws for ${why}: ${JSON.stringify(input)}`, () => {
      expect(() => canonicalizeEmail(input as string)).toThrow(/invalid email/);
    });
  }

  test("throws for non-string input", () => {
    expect(() => canonicalizeEmail(undefined as unknown as string)).toThrow(
      /invalid email/,
    );
    expect(() => canonicalizeEmail(null as unknown as string)).toThrow(
      /invalid email/,
    );
  });
});
