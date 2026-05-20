import { readFile } from 'node:fs/promises';
import { Effect } from 'effect';
import { PolymarketParseError } from '#types.js';
import type { PolymarketLine } from '#types.js';

// New format: "22 | EXACT | YES 25.5 | NO 74.5"
const LINE_RE_NEW =
  /^([\d.]+)\s*\|\s*(BELOW|EXACT|ABOVE)\s*\|\s*YES\s*([\d.]+)\s*\|\s*NO\s*([\d.]+)/i;

// Old format (backward compat): "22 | YES 27 | NO 74" — defaults to kind='above'
const LINE_RE_OLD = /^([\d.]+)\s*\|\s*YES\s*([\d.]+)\s*\|\s*NO\s*([\d.]+)/;

function parseLine(line: string): PolymarketLine | null {
  const mNew = LINE_RE_NEW.exec(line);
  if (mNew) {
    return {
      threshold: Number.parseFloat(mNew[1]),
      kind: mNew[2].toLowerCase() as PolymarketLine['kind'],
      yesProb: Number.parseFloat(mNew[3]),
      noProb: Number.parseFloat(mNew[4]),
    };
  }
  const mOld = LINE_RE_OLD.exec(line);
  if (mOld) {
    return {
      threshold: Number.parseFloat(mOld[1]),
      kind: 'above', // legacy files treated everything as P(max > X)
      yesProb: Number.parseFloat(mOld[2]),
      noProb: Number.parseFloat(mOld[3]),
    };
  }
  return null;
}

/**
 * Reads and parses a Polymarket odds file.
 *
 * Supported formats:
 * - New: `22 | EXACT | YES 25.5 | NO 74.5`
 * - Old (backward compat): `22 | YES 27 | NO 74` — treated as kind='above'
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
      const parsed = parseLine(line);
      if (parsed) acc.push(parsed);
      return acc;
    }, []);

  if (!lines.length) {
    return yield* new PolymarketParseError({
      cause: `No valid lines found in "${filePath}". Expected format: "22 | EXACT | YES 25.5 | NO 74.5"`,
    });
  }

  return lines;
});
