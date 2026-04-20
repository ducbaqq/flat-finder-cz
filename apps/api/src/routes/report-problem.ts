import { Hono } from "hono";
import { getEnv } from "@flat-finder/config";

const app = new Hono();

const MAX_DESCRIPTION = 5000;
const MAX_SIGNATURE = 200;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

app.post("/", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }

  const { description, signature, page_url } = (body ?? {}) as {
    description?: unknown;
    signature?: unknown;
    page_url?: unknown;
  };

  if (typeof description !== "string" || !description.trim()) {
    return c.json({ error: "Description is required." }, 400);
  }
  if (description.length > MAX_DESCRIPTION) {
    return c.json({ error: "Description too long." }, 400);
  }

  const sig =
    typeof signature === "string" ? signature.trim().slice(0, MAX_SIGNATURE) : "";
  const pageUrl =
    typeof page_url === "string" ? page_url.trim().slice(0, 500) : "";
  const userAgent = c.req.header("user-agent")?.slice(0, 300) ?? "";
  const ip =
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
    c.req.header("x-real-ip") ||
    "unknown";

  const env = getEnv();
  if (!env.BREVO_API_KEY) {
    console.error("[report-problem] BREVO_API_KEY not set — cannot send email");
    return c.json({ error: "Reporting is not configured." }, 503);
  }

  const subject = `[Bytomat] Nahlášený problém${sig ? ` — ${sig.slice(0, 60)}` : ""}`;
  const descText = description.trim();
  const textContent = [
    descText,
    "",
    "---",
    sig ? `Podpis: ${sig}` : "Podpis: (anonymní)",
    pageUrl ? `Stránka: ${pageUrl}` : "",
    `IP: ${ip}`,
    `User-Agent: ${userAgent}`,
    `Čas: ${new Date().toISOString()}`,
  ]
    .filter(Boolean)
    .join("\n");

  const htmlContent = `
    <div style="font-family:system-ui,sans-serif;line-height:1.5">
      <h2 style="margin:0 0 12px">Nahlášený problém</h2>
      <div style="white-space:pre-wrap;border-left:3px solid #d97757;padding:8px 12px;background:#fafafa;margin-bottom:16px">${escapeHtml(descText)}</div>
      <table style="font-size:13px;color:#555;border-collapse:collapse">
        <tr><td style="padding:2px 8px 2px 0"><b>Podpis</b></td><td>${sig ? escapeHtml(sig) : "<i>anonymní</i>"}</td></tr>
        ${pageUrl ? `<tr><td style="padding:2px 8px 2px 0"><b>Stránka</b></td><td><a href="${escapeHtml(pageUrl)}">${escapeHtml(pageUrl)}</a></td></tr>` : ""}
        <tr><td style="padding:2px 8px 2px 0"><b>IP</b></td><td>${escapeHtml(ip)}</td></tr>
        <tr><td style="padding:2px 8px 2px 0"><b>User-Agent</b></td><td>${escapeHtml(userAgent)}</td></tr>
        <tr><td style="padding:2px 8px 2px 0"><b>Čas</b></td><td>${new Date().toISOString()}</td></tr>
      </table>
    </div>`.trim();

  const payload: Record<string, unknown> = {
    to: [{ email: env.REPORT_PROBLEM_EMAIL }],
    sender: { email: env.BREVO_SENDER_EMAIL, name: env.BREVO_SENDER_NAME },
    subject,
    htmlContent,
    textContent,
  };

  // If the signature looks like an email, let the recipient hit Reply-To
  // to contact the reporter directly.
  if (sig && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(sig)) {
    payload.replyTo = { email: sig };
  }

  try {
    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "api-key": env.BREVO_API_KEY,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error(
        `[report-problem] Brevo HTTP ${res.status}: ${text.slice(0, 500)}`,
      );
      return c.json({ error: "Nepodařilo se odeslat. Zkuste to prosím znovu." }, 502);
    }

    return c.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[report-problem] Brevo network error: ${msg}`);
    return c.json({ error: "Nepodařilo se odeslat. Zkuste to prosím znovu." }, 502);
  }
});

export default app;
