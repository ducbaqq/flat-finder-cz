/**
 * Terminal dashboard for the flat-finder-cz scraper.
 *
 * Renders a fixed table that redraws in-place using ANSI escape codes.
 * One row per source, with columns for status, category, counts, elapsed
 * time, and rate. Refreshes every 500ms.
 *
 * No external TUI libraries -- raw ANSI codes only.
 */

// ---------------------------------------------------------------------------
// ANSI escape sequences
// ---------------------------------------------------------------------------

const ESC = "\x1b";
const HIDE_CURSOR = `${ESC}[?25l`;
const SHOW_CURSOR = `${ESC}[?25h`;
const MOVE_HOME = `${ESC}[H`;
const CLEAR_SCREEN = `${ESC}[2J`;
const CLEAR_LINE = `${ESC}[K`;
const RESET = `${ESC}[0m`;
const BOLD = `${ESC}[1m`;
const DIM = `${ESC}[2m`;
const GREEN = `${ESC}[32m`;
const YELLOW = `${ESC}[33m`;
const RED = `${ESC}[31m`;
const CYAN = `${ESC}[36m`;
const WHITE = `${ESC}[37m`;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SourceStatus = "waiting" | "scanning" | "enriching" | "done" | "error";

export interface SourceState {
  source: string;
  status: SourceStatus;
  category: string;
  pagesFetched: number;
  listingsFound: number;
  newCount: number;
  updatedCount: number;
  errorCount: number;
  startTime: number | null;
  endTime: number | null;
}

// ---------------------------------------------------------------------------
// Dashboard class
// ---------------------------------------------------------------------------

export class Dashboard {
  private states: Map<string, SourceState> = new Map();
  private timer: ReturnType<typeof setInterval> | null = null;
  private sources: string[];
  private globalStartTime: number;
  private logBuffer: string[] = [];
  private maxLogLines = 5;
  private resizeHandler: (() => void) | null = null;

  constructor(sources: string[]) {
    this.sources = sources;
    this.globalStartTime = Date.now();

    // Initialize state for each source
    for (const source of sources) {
      this.states.set(source, {
        source,
        status: "waiting",
        category: "",
        pagesFetched: 0,
        listingsFound: 0,
        newCount: 0,
        updatedCount: 0,
        errorCount: 0,
        startTime: null,
        endTime: null,
      });
    }
  }

  // -----------------------------------------------------------------------
  // State update methods
  // -----------------------------------------------------------------------

  setStatus(source: string, status: SourceStatus): void {
    const s = this.states.get(source);
    if (!s) return;
    s.status = status;
    if (status === "scanning" && s.startTime === null) {
      s.startTime = Date.now();
    }
    if (status === "done" || status === "error") {
      s.endTime = Date.now();
    }
  }

  setCategory(source: string, category: string): void {
    const s = this.states.get(source);
    if (s) s.category = category;
  }

  addPageFetched(source: string, listingsOnPage: number): void {
    const s = this.states.get(source);
    if (!s) return;
    s.pagesFetched++;
    s.listingsFound += listingsOnPage;
  }

  addUpsertResults(
    source: string,
    newCount: number,
    updatedCount: number,
    errorCount: number,
  ): void {
    const s = this.states.get(source);
    if (!s) return;
    s.newCount += newCount;
    s.updatedCount += updatedCount;
    s.errorCount += errorCount;
  }

  addErrors(source: string, count: number): void {
    const s = this.states.get(source);
    if (s) s.errorCount += count;
  }

  /** Buffer a log line to show below the table. */
  log(source: string, msg: string): void {
    const t = new Date().toLocaleTimeString("en-GB", { hour12: false });
    this.logBuffer.push(`${DIM}${t} [${source}] ${msg}${RESET}`);
    if (this.logBuffer.length > this.maxLogLines) {
      this.logBuffer.shift();
    }
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  start(): void {
    // Hide cursor and clear screen
    process.stdout.write(HIDE_CURSOR + CLEAR_SCREEN);
    // Initial render
    this.render();
    // Start refresh loop at 500ms
    this.timer = setInterval(() => this.render(), 500);

    // Handle terminal resize
    this.resizeHandler = () => this.render();
    process.stdout.on("resize", this.resizeHandler);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.resizeHandler) {
      process.stdout.removeListener("resize", this.resizeHandler);
      this.resizeHandler = null;
    }
    // Final render
    this.render();
    // Show cursor and move below the table
    // 2 (title + blank) + 1 (header) + 1 (sep) + sources + 1 (sep) + 1 (footer) + 1 (blank) + maxLogLines
    const totalLines = 2 + 1 + 1 + this.sources.length + 1 + 1 + 1 + this.maxLogLines;
    process.stdout.write(`\x1b[${totalLines + 1};1H` + SHOW_CURSOR + "\n");
  }

  /** Restore terminal state -- call on SIGINT/SIGTERM. */
  cleanup(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.resizeHandler) {
      process.stdout.removeListener("resize", this.resizeHandler);
      this.resizeHandler = null;
    }
    process.stdout.write(SHOW_CURSOR + RESET + "\n");
  }

  // -----------------------------------------------------------------------
  // Rendering
  // -----------------------------------------------------------------------

  private render(): void {
    const termWidth = process.stdout.columns || 120;
    const lines: string[] = [];

    // Title bar
    const elapsed = this.formatElapsed(Date.now() - this.globalStartTime);
    const title = " Flat Finder CZ - Scraper Dashboard";
    const titleRight = `Elapsed: ${elapsed} `;
    const titlePad = Math.max(0, termWidth - title.length - titleRight.length);
    lines.push(
      `${BOLD}${CYAN}${title}${" ".repeat(titlePad)}${titleRight}${RESET}`,
    );
    lines.push("");

    // Column definitions: [label, width]
    const cols: [string, number][] = [
      ["Source", 15],
      ["Status", 11],
      ["Category", 22],
      ["Pages", 7],
      ["Found", 7],
      ["New", 7],
      ["Updated", 9],
      ["Errors", 8],
      ["Elapsed", 9],
      ["Rate", 8],
    ];

    // Header
    let header = "";
    for (const [label, width] of cols) {
      header += label.padEnd(width);
    }
    lines.push(`${BOLD}${WHITE}${header}${RESET}`);

    // Separator
    const sepLen = Math.min(termWidth, header.length);
    lines.push(`${DIM}${"─".repeat(sepLen)}${RESET}`);

    // Rows -- one per source
    const totals = {
      pagesFetched: 0,
      listingsFound: 0,
      newCount: 0,
      updatedCount: 0,
      errorCount: 0,
    };

    for (const source of this.sources) {
      const s = this.states.get(source)!;
      totals.pagesFetched += s.pagesFetched;
      totals.listingsFound += s.listingsFound;
      totals.newCount += s.newCount;
      totals.updatedCount += s.updatedCount;
      totals.errorCount += s.errorCount;

      const elapsedStr = this.getSourceElapsed(s);
      const rate = this.getRate(s);
      const statusColored = this.colorStatus(s.status);

      // Truncate category to fit column (plain text, no ANSI)
      const catMaxLen = cols[2][1] - 2;
      const catDisplay =
        s.category.length > catMaxLen
          ? s.category.slice(0, catMaxLen - 1) + "~"
          : s.category;

      let row = "";
      row += s.source.padEnd(cols[0][1]);
      // Status column: colored text + padding to fill the column width
      row += statusColored + " ".repeat(Math.max(0, cols[1][1] - this.plainLen(s.status)));
      row += catDisplay.padEnd(cols[2][1]);
      row += String(s.pagesFetched).padStart(cols[3][1] - 2).padEnd(cols[3][1]);
      row += String(s.listingsFound).padStart(cols[4][1] - 2).padEnd(cols[4][1]);
      row += String(s.newCount).padStart(cols[5][1] - 2).padEnd(cols[5][1]);
      row += String(s.updatedCount).padStart(cols[6][1] - 2).padEnd(cols[6][1]);
      row += this.colorErrors(s.errorCount, cols[7][1]);
      row += elapsedStr.padStart(cols[8][1] - 2).padEnd(cols[8][1]);
      row += rate.padStart(cols[9][1] - 2).padEnd(cols[9][1]);

      lines.push(row);
    }

    // Footer separator
    lines.push(`${DIM}${"─".repeat(sepLen)}${RESET}`);

    // Footer totals
    const totalRate = this.getTotalRate(totals.listingsFound);
    let footer = "";
    footer += `${BOLD}${"TOTAL".padEnd(cols[0][1])}${RESET}`;
    footer += " ".repeat(cols[1][1]); // empty status
    footer += " ".repeat(cols[2][1]); // empty category
    footer += `${BOLD}${String(totals.pagesFetched).padStart(cols[3][1] - 2).padEnd(cols[3][1])}${RESET}`;
    footer += `${BOLD}${String(totals.listingsFound).padStart(cols[4][1] - 2).padEnd(cols[4][1])}${RESET}`;
    footer += `${BOLD}${GREEN}${String(totals.newCount).padStart(cols[5][1] - 2).padEnd(cols[5][1])}${RESET}`;
    footer += `${BOLD}${String(totals.updatedCount).padStart(cols[6][1] - 2).padEnd(cols[6][1])}${RESET}`;
    footer += this.colorErrors(totals.errorCount, cols[7][1]);
    footer += `${BOLD}${this.formatElapsed(Date.now() - this.globalStartTime).padStart(cols[8][1] - 2).padEnd(cols[8][1])}${RESET}`;
    footer += `${BOLD}${totalRate.padStart(cols[9][1] - 2).padEnd(cols[9][1])}${RESET}`;
    lines.push(footer);

    // Empty line before logs
    lines.push("");

    // Log buffer
    for (const logLine of this.logBuffer) {
      lines.push(this.truncateAnsi(logLine, termWidth));
    }
    // Pad remaining log lines so old content gets cleared
    for (let i = this.logBuffer.length; i < this.maxLogLines; i++) {
      lines.push("");
    }

    // Compose output: move to home, write each line with clear-to-end-of-line
    let output = MOVE_HOME;
    for (const line of lines) {
      output += line + CLEAR_LINE + "\n";
    }

    process.stdout.write(output);
  }

  // -----------------------------------------------------------------------
  // Formatting helpers
  // -----------------------------------------------------------------------

  private colorStatus(status: SourceStatus): string {
    switch (status) {
      case "waiting":
        return `${DIM}waiting${RESET}`;
      case "scanning":
        return `${YELLOW}scanning${RESET}`;
      case "enriching":
        return `${YELLOW}enriching${RESET}`;
      case "done":
        return `${GREEN}done${RESET}`;
      case "error":
        return `${RED}error${RESET}`;
    }
  }

  private colorErrors(count: number, width: number): string {
    const padded = String(count).padStart(width - 2).padEnd(width);
    if (count > 0) {
      return `${RED}${padded}${RESET}`;
    }
    return padded;
  }

  private getSourceElapsed(s: SourceState): string {
    if (s.startTime === null) return "--:--";
    const end = s.endTime ?? Date.now();
    return this.formatElapsed(end - s.startTime);
  }

  private formatElapsed(ms: number): string {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  private getRate(s: SourceState): string {
    if (s.startTime === null || s.listingsFound === 0) return "--";
    const end = s.endTime ?? Date.now();
    const minutes = (end - s.startTime) / 60000;
    if (minutes < 0.01) return "--";
    const rate = Math.round(s.listingsFound / minutes);
    return `${rate}/m`;
  }

  private getTotalRate(totalFound: number): string {
    const minutes = (Date.now() - this.globalStartTime) / 60000;
    if (minutes < 0.01 || totalFound === 0) return "--";
    const rate = Math.round(totalFound / minutes);
    return `${rate}/m`;
  }

  /**
   * Truncate a string that may contain ANSI escape codes to a max visible
   * width. Returns the truncated string with a RESET appended.
   */
  private truncateAnsi(str: string, maxLen: number): string {
    let visible = 0;
    let i = 0;
    while (i < str.length && visible < maxLen) {
      if (str[i] === "\x1b") {
        // Skip the entire ANSI escape sequence (ESC[...m)
        const end = str.indexOf("m", i);
        if (end !== -1) {
          i = end + 1;
          continue;
        }
      }
      visible++;
      i++;
    }
    if (i >= str.length) return str; // no truncation needed
    return str.slice(0, i) + RESET;
  }

  /** Get the visible character length of a plain (non-ANSI) string. */
  private plainLen(str: string): number {
    return str.length;
  }
}
