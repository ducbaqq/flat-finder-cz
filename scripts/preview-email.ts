#!/usr/bin/env tsx
/**
 * Preview the watchdog notification email locally.
 *
 *   npx tsx scripts/preview-email.ts             → renders HTML to tmp/preview.html
 *   npx tsx scripts/preview-email.ts --txt       → also writes tmp/preview.txt
 *   npx tsx scripts/preview-email.ts --variant=1 → single listing
 *   npx tsx scripts/preview-email.ts --variant=hasmore → 10 shown, 17 total
 *
 * The renderer is a small Brevo-Jinja2 subset — just enough for THIS template:
 *   {{ x.y[0].z }} · {% if/elif/else/endif %} · {% for x in y %} (with loop.{index,first,last,index0})
 *   operators: and  or  not  ==  !=  >=  <=  >  <  +  -    pipes: | length
 *
 * Production rendering still happens on Brevo's real engine; this is for spot-checks only.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ─────────────────────────────────────────────────────────────────────────────
// Mini Jinja2-subset renderer
// ─────────────────────────────────────────────────────────────────────────────

type Token =
  | { kind: "text"; value: string }
  | { kind: "var"; expr: string }
  | { kind: "tag"; value: string };

type Node =
  | { kind: "text"; value: string }
  | { kind: "var"; expr: string }
  | { kind: "for"; varName: string; iterable: string; body: Node[] }
  | { kind: "if"; branches: Array<{ cond: string | null; body: Node[] }> };

type Ctx = Record<string, unknown>;

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  const re = /\{\{([\s\S]+?)\}\}|\{%([\s\S]+?)%\}/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    if (m.index > last) tokens.push({ kind: "text", value: src.slice(last, m.index) });
    if (m[1] !== undefined) tokens.push({ kind: "var", expr: m[1].trim() });
    else tokens.push({ kind: "tag", value: m[2].trim() });
    last = m.index + m[0].length;
  }
  if (last < src.length) tokens.push({ kind: "text", value: src.slice(last) });
  return tokens;
}

function parse(tokens: Token[], idx: { i: number } = { i: 0 }, stops: string[] = []): Node[] {
  const nodes: Node[] = [];
  while (idx.i < tokens.length) {
    const t = tokens[idx.i];
    if (t.kind === "text") {
      nodes.push({ kind: "text", value: t.value });
      idx.i++;
      continue;
    }
    if (t.kind === "var") {
      nodes.push({ kind: "var", expr: t.expr });
      idx.i++;
      continue;
    }
    const head = t.value.split(/\s+/, 1)[0];
    if (stops.includes(head)) return nodes;

    if (head === "for") {
      const m = t.value.match(/^for\s+(\w+)\s+in\s+(.+)$/);
      if (!m) throw new Error(`bad for tag: ${t.value}`);
      idx.i++;
      const body = parse(tokens, idx, ["endfor"]);
      if (tokens[idx.i]?.value !== "endfor") throw new Error("missing endfor");
      idx.i++;
      nodes.push({ kind: "for", varName: m[1], iterable: m[2].trim(), body });
      continue;
    }

    if (head === "if") {
      const branches: Array<{ cond: string | null; body: Node[] }> = [];
      branches.push({ cond: t.value.slice(2).trim(), body: [] });
      idx.i++;
      while (true) {
        const body = parse(tokens, idx, ["elif", "else", "endif"]);
        branches[branches.length - 1].body = body;
        const next = tokens[idx.i];
        if (!next || next.kind !== "tag") throw new Error("unterminated if");
        if (next.value === "endif") {
          idx.i++;
          break;
        }
        if (next.value === "else") {
          branches.push({ cond: null, body: [] });
          idx.i++;
          continue;
        }
        if (next.value.startsWith("elif")) {
          branches.push({ cond: next.value.slice(4).trim(), body: [] });
          idx.i++;
          continue;
        }
        throw new Error(`unexpected tag in if: ${next.value}`);
      }
      nodes.push({ kind: "if", branches });
      continue;
    }

    throw new Error(`unknown tag: ${t.value}`);
  }
  return nodes;
}

function lookup(path: string, ctx: Ctx): unknown {
  // Walks dotted/bracketed paths: foo.bar[0].baz
  const parts = path.split(/(\.|\[|\])/g).filter((p) => p && !/^[.\[\]]$/.test(p));
  let cur: unknown = ctx;
  for (const raw of parts) {
    if (cur == null) return undefined;
    const key = raw.replace(/^['"]|['"]$/g, "").trim();
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

function evalExpr(rawExpr: string, ctx: Ctx): unknown {
  const expr = rawExpr.trim();
  if (!expr) return undefined;

  // Parenthesised expression
  if (expr.startsWith("(") && matchingClose(expr, 0) === expr.length - 1) {
    return evalExpr(expr.slice(1, -1), ctx);
  }

  // String literal
  if ((expr.startsWith("'") && expr.endsWith("'")) || (expr.startsWith('"') && expr.endsWith('"'))) {
    return expr.slice(1, -1);
  }
  // Numeric literal
  if (/^-?\d+(\.\d+)?$/.test(expr)) return Number(expr);
  if (expr === "true") return true;
  if (expr === "false") return false;
  if (expr === "none" || expr === "null") return null;

  // Binary operators in precedence order (low → high)
  // Each one finds the LAST matching split outside brackets/strings.
  const binaryOps: Array<{ op: string; apply: (a: unknown, b: unknown) => unknown }> = [
    { op: " or ", apply: (a, b) => (a as boolean) || (b as boolean) },
    { op: " and ", apply: (a, b) => (a as boolean) && (b as boolean) },
    { op: "==", apply: (a, b) => a == b },
    { op: "!=", apply: (a, b) => a != b },
    { op: ">=", apply: (a, b) => (a as number) >= (b as number) },
    { op: "<=", apply: (a, b) => (a as number) <= (b as number) },
    { op: ">", apply: (a, b) => (a as number) > (b as number) },
    { op: "<", apply: (a, b) => (a as number) < (b as number) },
    { op: "+", apply: (a, b) => (a as number) + (b as number) },
    { op: "-", apply: (a, b) => (a as number) - (b as number) },
  ];
  for (const { op, apply } of binaryOps) {
    const split = splitTopLevel(expr, op);
    if (split) return apply(evalExpr(split[0], ctx), evalExpr(split[1], ctx));
  }

  // Unary not
  if (expr.startsWith("not ")) return !evalExpr(expr.slice(4), ctx);

  // Pipe filter (left-to-right)
  const pipeIdx = topLevelIndex(expr, "|");
  if (pipeIdx !== -1) {
    const left = expr.slice(0, pipeIdx).trim();
    const filter = expr.slice(pipeIdx + 1).trim();
    const v = evalExpr(left, ctx);
    if (filter === "length") {
      if (Array.isArray(v) || typeof v === "string") return v.length;
      return v == null ? 0 : Object.keys(v as object).length;
    }
    if (filter === "upper") return String(v ?? "").toUpperCase();
    if (filter === "lower") return String(v ?? "").toLowerCase();
    return v;
  }

  // Variable path
  return lookup(expr, ctx);
}

/** Find the index of `op` at the top level of `expr` (outside brackets/strings). Right-most match wins so left-associative. */
function topLevelIndex(expr: string, op: string): number {
  let depth = 0;
  let str: string | null = null;
  let last = -1;
  for (let i = 0; i <= expr.length - op.length; i++) {
    const ch = expr[i];
    if (str) {
      if (ch === str && expr[i - 1] !== "\\") str = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      str = ch;
      continue;
    }
    if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth--;
    else if (depth === 0 && expr.slice(i, i + op.length) === op) last = i;
  }
  return last;
}

function splitTopLevel(expr: string, op: string): [string, string] | null {
  const i = topLevelIndex(expr, op);
  if (i === -1) return null;
  return [expr.slice(0, i), expr.slice(i + op.length)];
}

function matchingClose(s: string, openIdx: number): number {
  let depth = 0;
  for (let i = openIdx; i < s.length; i++) {
    if (s[i] === "(") depth++;
    else if (s[i] === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function render(nodes: Node[], ctx: Ctx): string {
  let out = "";
  for (const n of nodes) {
    if (n.kind === "text") out += n.value;
    else if (n.kind === "var") {
      const v = evalExpr(n.expr, ctx);
      if (v != null) out += String(v);
    } else if (n.kind === "for") {
      const items = evalExpr(n.iterable, ctx);
      const arr = Array.isArray(items) ? items : [];
      for (let i = 0; i < arr.length; i++) {
        out += render(n.body, {
          ...ctx,
          [n.varName]: arr[i],
          loop: { index: i + 1, index0: i, first: i === 0, last: i === arr.length - 1 },
        });
      }
    } else if (n.kind === "if") {
      for (const b of n.branches) {
        const ok = b.cond === null || !!evalExpr(b.cond, ctx);
        if (ok) {
          out += render(b.body, ctx);
          break;
        }
      }
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Mock data
// ─────────────────────────────────────────────────────────────────────────────

const APP = "https://bytomat.com";

const sampleListings = [
  {
    title: "Pronájem byt 2+kk, 50 m², Praha 6 – Břevnov",
    price_formatted: "25 000 Kč/měsíc",
    size_m2: 50,
    layout: "2+kk",
    address: "Bělohorská 234, Praha 6",
    thumbnail_url:
      "https://images.unsplash.com/photo-1502672023488-70e25813eb80?w=1040&q=80&auto=format&fit=crop",
    detail_url: `${APP}/listing/843201`,
    transaction_label: "Pronájem",
    sources: [
      { name: "sreality.cz", url: "https://www.sreality.cz/detail/example/843201" },
      { name: "idnes.cz", url: "https://reality.idnes.cz/example/843201" },
      { name: "bezrealitky.cz", url: "https://www.bezrealitky.cz/example/843201" },
    ],
  },
  {
    title: "Pronájem byt 1+kk, 32 m², Praha 6 – Dejvice",
    price_formatted: "18 500 Kč/měsíc",
    size_m2: 32,
    layout: "1+kk",
    address: "Jugoslávských partyzánů 12, Praha 6",
    thumbnail_url:
      "https://images.unsplash.com/photo-1493809842364-78817add7ffb?w=1040&q=80&auto=format&fit=crop",
    detail_url: `${APP}/listing/843404`,
    transaction_label: "Pronájem",
    sources: [{ name: "ulovdomov.cz", url: "https://www.ulovdomov.cz/example/843404" }],
  },
  {
    title: "Pronájem byt 3+1, 78 m², Praha 6 – Bubeneč",
    price_formatted: "Cena na dotaz",
    size_m2: 78,
    layout: "3+1",
    address: "Korunovační 23, Praha 6",
    thumbnail_url: null as string | null,
    detail_url: `${APP}/listing/843788`,
    transaction_label: "Pronájem",
    sources: [
      { name: "bezrealitky.cz", url: "https://www.bezrealitky.cz/example/843788" },
      { name: "realitymix.cz", url: "https://www.realitymix.cz/example/843788" },
    ],
  },
  {
    title: "Pronájem byt 2+1, m² nezjištěno, Praha 6 – Hanspaulka",
    price_formatted: "27 000 Kč/měsíc",
    size_m2: 0,
    layout: "2+1",
    address: "U Hanspaulky 4, Praha 6",
    thumbnail_url:
      "https://images.unsplash.com/photo-1505691938895-1758d7feb511?w=1040&q=80&auto=format&fit=crop",
    detail_url: `${APP}/listing/843910`,
    transaction_label: "Pronájem",
    sources: [{ name: "sreality.cz", url: "https://www.sreality.cz/detail/example/843910" }],
  },
];

function buildVariant(name: string) {
  let listings = sampleListings;
  let total = 4;

  if (name === "1") {
    listings = sampleListings.slice(0, 1);
    total = 1;
  } else if (name === "2") {
    listings = sampleListings.slice(0, 2);
    total = 2;
  } else if (name === "hasmore") {
    listings = [...sampleListings, ...sampleListings, ...sampleListings.slice(0, 2)]; // 10 entries
    total = 17;
  } else if (name === "no-label") {
    listings = sampleListings.slice(0, 3);
    total = 3;
  }

  return {
    params: {
      watchdog_label: name === "no-label" ? null : "Praha 6 byty",
      watchdog_filters_summary: "Byty · Pronájem · Praha 6 · 50 m²+ · do 30 000 Kč",
      total_count: total,
      displayed_count: listings.length,
      has_more: total > listings.length,
      more_url: `${APP}/search?property_type=flat&transaction_type=rent&location=Praha+6&size_min=50&price_max=30000`,
      app_url: APP,
      unsubscribe_url: `${APP}/watchdog/unsubscribe?token=mock-token-abc`,
      pause_url: `${APP}/watchdog/pause?token=mock-token-abc`,
      manage_url: `${APP}/watchdog/manage?token=mock-token-abc`,
      recipient_email: "tester@example.com",
      listings,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

const args = process.argv.slice(2);
const variant = args.find((a) => a.startsWith("--variant="))?.split("=")[1] ?? "default";
const writeTxt = args.includes("--txt");

const htmlSrc = readFileSync(
  resolve(repoRoot, "apps/notifier/src/templates/email_template.html"),
  "utf8",
);
const txtSrc = readFileSync(
  resolve(repoRoot, "apps/notifier/src/templates/email_template.txt"),
  "utf8",
);

const ctx = buildVariant(variant) as unknown as Ctx;

const html = render(parse(tokenize(htmlSrc)), ctx);
const txt = render(parse(tokenize(txtSrc)), ctx);

const outDir = resolve(repoRoot, "tmp");
mkdirSync(outDir, { recursive: true });
const htmlOut = resolve(outDir, "preview.html");
writeFileSync(htmlOut, html, "utf8");

console.log(`✓ wrote ${htmlOut}  (variant=${variant}, listings=${(ctx.params as { listings: unknown[] }).listings.length})`);

if (writeTxt) {
  const txtOut = resolve(outDir, "preview.txt");
  writeFileSync(txtOut, txt, "utf8");
  console.log(`✓ wrote ${txtOut}`);
}

console.log(`\nopen: file://${htmlOut}`);
