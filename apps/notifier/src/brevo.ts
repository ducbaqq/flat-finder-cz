import { getEnv } from "@flat-finder/config";

/**
 * Send a transactional email via Brevo (Sendinblue) API.
 * Returns true on success, false on failure.
 */
export async function sendBrevoEmail(
  toEmail: string,
  templateId: number,
  params: Record<string, unknown>,
): Promise<boolean> {
  const env = getEnv();

  const payload = {
    to: [{ email: toEmail }],
    templateId,
    params,
    sender: {
      email: env.BREVO_SENDER_EMAIL,
      name: env.BREVO_SENDER_NAME,
    },
  };

  try {
    const response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "api-key": env.BREVO_API_KEY,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30_000),
    });

    if (response.ok) {
      console.log(`[INFO] Brevo API responded ${response.status} for ${toEmail}`);
      return true;
    }

    const body = await response.text().catch(() => "");
    console.error(
      `[ERROR] Brevo API HTTP ${response.status} for ${toEmail}: ${body.slice(0, 500)}`,
    );
    return false;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[ERROR] Brevo API network error for ${toEmail}: ${message}`);
    return false;
  }
}
