/**
 * Compose the email subject. Czech plurals:
 *   1            → "1 nová nabídka"
 *   2, 3, 4      → "{n} nové nabídky"
 *   5+ (and 0)   → "{n} nových nabídek"
 *
 * The watchdog's filter summary is appended after a colon so the
 * inbox preview includes both "what's new" and "what triggered it".
 */
export function composeSubject(displayedCount: number, summary: string): string {
  const trimmedSummary = (summary ?? "").trim();
  const tail = trimmedSummary ? `: ${trimmedSummary}` : "";

  if (displayedCount === 1) return `1 nová nabídka${tail}`;
  if (displayedCount >= 2 && displayedCount <= 4) {
    return `${displayedCount} nové nabídky${tail}`;
  }
  return `${displayedCount} nových nabídek${tail}`;
}
