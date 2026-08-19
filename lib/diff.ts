/**
 * Simple line-by-line diff utility
 */

export type DiffLine = {
  type: "added" | "removed" | "unchanged";
  oldLine?: number;
  newLine?: number;
  content: string;
};

export function computeDiff(oldText: string, newText: string): DiffLine[] {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  const diff: DiffLine[] = [];

  // Simple LCS-based diff
  const m = oldLines.length;
  const n = newLines.length;
  const lcs: number[][] = Array(m + 1)
    .fill(null)
    .map(() => Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        lcs[i][j] = lcs[i - 1][j - 1] + 1;
      } else {
        lcs[i][j] = Math.max(lcs[i - 1][j], lcs[i][j - 1]);
      }
    }
  }

  // Backtrack to build diff
  let i = m;
  let j = n;
  const result: DiffLine[] = [];

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      result.unshift({
        type: "unchanged",
        oldLine: i,
        newLine: j,
        content: oldLines[i - 1],
      });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || lcs[i][j - 1] >= lcs[i - 1][j])) {
      result.unshift({
        type: "added",
        newLine: j,
        content: newLines[j - 1],
      });
      j--;
    } else if (i > 0) {
      result.unshift({
        type: "removed",
        oldLine: i,
        content: oldLines[i - 1],
      });
      i--;
    }
  }

  return result;
}

export function applyDiff(diff: DiffLine[]): string {
  return diff
    .filter((d) => d.type !== "removed")
    .map((d) => d.content)
    .join("\n");
}
