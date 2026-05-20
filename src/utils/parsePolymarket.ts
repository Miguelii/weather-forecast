import { readFile } from 'node:fs/promises';
import { Effect } from 'effect';
import { PolymarketParseError } from '#types.js';
import type { PolymarketLine } from '#types.js';

const LINE_RE = /^(\d+(?:\.\d+)?)\s*\|\s*YES\s*([\d.]+)\s*\|\s*NO\s*([\d.]+)/;

/**
 * Reads and parses a Polymarket odds file.
 *
 * Expected line format: `22 | YES 27 | NO 74`
 *
 * @param filePath - Absolute or relative path to the Polymarket odds file.
 * @returns Array of parsed threshold/probability lines.
 * @throws PolymarketParseError if the file cannot be read or contains no valid lines.
 */
export const parsePolymarket = Effect.fn('parsePolymarket')(function* (filePath: string) {
  const raw = yield* Effect.tryPromise({
    try: () => readFile(filePath, 'utf8'),
    catch: (err) =>
      new PolymarketParseError({
        cause: `Cannot read "${filePath}": ${err instanceof Error ? err.message : String(err)}`,
      }),
  });

  const lines = raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .reduce<PolymarketLine[]>((acc, line) => {
      const m = LINE_RE.exec(line);
      if (m) {
        acc.push({
          threshold: Number.parseFloat(m[1]),
          yesProb: Number.parseFloat(m[2]),
          noProb: Number.parseFloat(m[3]),
        });
      }
      return acc;
    }, []);

  if (!lines.length) {
    return yield* new PolymarketParseError({
      cause: `No valid lines found in "${filePath}". Expected format: "22 | YES 27 | NO 74"`,
    });
  }

  return lines;
});
