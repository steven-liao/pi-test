/**
 * Permission System Extension — Simple Line Diff Generator
 *
 * Produces terminal-friendly diff output for permission dialogs.
 * Uses a straightforward algorithm: find the differing region and
 * show removals then additions.
 */

export interface DiffLine {
  type: "context" | "add" | "remove";
  text: string;
}

export interface DiffResult {
  lines: DiffLine[];
  additions: number;
  removals: number;
  truncated: boolean;
}

const MAX_DIFF_LINES = 20;
const LINE_MAX_LENGTH = 80;

/**
 * Compute a simple line-based diff between two texts.
 * Finds the contiguous changed region and shows removals followed by additions.
 */
export function computeDiff(oldText: string, newText: string): DiffResult {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");

  // Find first differing line from start
  let start = 0;
  while (
    start < oldLines.length &&
    start < newLines.length &&
    oldLines[start] === newLines[start]
  ) {
    start++;
  }

  // Find first differing line from end
  let oldEnd = oldLines.length - 1;
  let newEnd = newLines.length - 1;
  while (
    oldEnd >= start &&
    newEnd >= start &&
    oldLines[oldEnd] === newLines[newEnd]
  ) {
    oldEnd--;
    newEnd--;
  }

  // Gather removed lines
  const removals: string[] = [];
  for (let i = start; i <= oldEnd && i < oldLines.length; i++) {
    removals.push(oldLines[i]);
  }

  // Gather added lines
  const additions: string[] = [];
  for (let i = start; i <= newEnd && i < newLines.length; i++) {
    additions.push(newLines[i]);
  }

  // Truncate long lines
  const trunc = (s: string) =>
    s.length > LINE_MAX_LENGTH ? s.slice(0, LINE_MAX_LENGTH - 3) + "..." : s;

  // Build interleaved diff: show removals then additions, with context lines
  // around the changed region for readability
  const allLines: DiffLine[] = [];

  // Show 1 line of context before the change (if available)
  if (start > 0 && start - 1 < oldLines.length) {
    allLines.push({ type: "context", text: trunc(oldLines[start - 1]) });
  }

  // Show removed lines
  for (const line of removals) {
    allLines.push({ type: "remove", text: trunc(line) });
  }

  // Separator between removals and additions (only if both exist)
  if (removals.length > 0 && additions.length > 0) {
    allLines.push({ type: "context", text: "---" });
  }

  // Show added lines
  for (const line of additions) {
    allLines.push({ type: "add", text: trunc(line) });
  }

  // Show 1 line of context after the change (if available)
  if (oldEnd + 1 < oldLines.length && newEnd + 1 < newLines.length) {
    const ctxLine =
      oldEnd + 1 < oldLines.length
        ? oldLines[oldEnd + 1]
        : newLines[newEnd + 1];
    allLines.push({ type: "context", text: trunc(ctxLine) });
  }

  const totalAdditions = additions.length;
  const totalRemovals = removals.length;

  // Truncate to MAX_DIFF_LINES
  let truncated = allLines.length > MAX_DIFF_LINES;
  let displayLines = allLines;
  if (truncated) {
    const half = Math.floor(MAX_DIFF_LINES / 2);
    displayLines = [
      ...allLines.slice(0, half),
      {
        type: "context",
        text: `  ... ${allLines.length - MAX_DIFF_LINES} more lines ...`,
      },
      ...allLines.slice(-half),
    ];
  }

  return {
    lines: displayLines,
    additions: totalAdditions,
    removals: totalRemovals,
    truncated,
  };
}

/**
 * Format a diff result into a terminal-friendly string.
 */
export function formatDiff(diff: DiffResult): string {
  if (diff.additions === 0 && diff.removals === 0) {
    return "(no changes)";
  }

  const summary = `${diff.additions} insertion${
    diff.additions !== 1 ? "s" : ""
  }, ${diff.removals} deletion${diff.removals !== 1 ? "s" : ""}`;
  const header = `─── Diff (${summary}) ───`;
  const body = diff.lines
    .map((l) => {
      switch (l.type) {
        case "add":
          return `+ ${l.text}`;
        case "remove":
          return `- ${l.text}`;
        case "context":
          return `  ${l.text}`;
      }
    })
    .join("\n");
  return `${header}\n${body}`;
}
