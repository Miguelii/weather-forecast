import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { Effect } from 'effect';
import type { CorrectedForecast, EnsembleResult, Location } from '#types.js';
import { SnapshotWriteError } from '#types/errors.js';
import { PREDICTS_DIR, MONTH_NAMES } from '#utils/constants.js';

/**
 * Builds a Markdown snapshot string for one forecast run.
 *
 * @param location - Resolved city location.
 * @param date - Target date in `YYYY-MM-DD` format.
 * @param corrected - Bias-corrected forecasts from all NWP models.
 * @param ensemble - Ensemble statistics computed by the voting system.
 * @param polymarketUrl - The Polymarket event URL this snapshot was compared against.
 * @returns A Markdown string ready to be appended to the snapshot file.
 */
function buildSnapshotMarkdown(
  location: Location,
  date: string,
  corrected: CorrectedForecast[],
  ensemble: EnsembleResult,
  polymarketUrl: string,
): string {
  const ts = new Date().toISOString();
  const parts: string[] = [];

  parts.push('---');
  parts.push('');
  parts.push(`## Run: ${ts} · ${location.name}, ${location.country} · ${date}`);
  parts.push('');
  parts.push(`**Polymarket URL:** ${polymarketUrl}`);
  parts.push('');

  // Model table
  parts.push('| Model | Raw Max | Bias | Corr Max |');
  parts.push('|-------|---------|------|----------|');
  for (const f of corrected) {
    if (f.error) {
      parts.push(`| ${f.model.toUpperCase()} | ERROR: ${f.error} | — | — |`);
    } else {
      const rawMax = f.rawTempMax !== null ? `${f.rawTempMax}°C` : 'n/a';

      const biasStrCond = f.bias > 0 ? `+${f.bias}` : `${f.bias}`;

      const biasStr = f.bias === 0 ? '0.0' : biasStrCond;

      const corrMax = f.tempMax !== null ? `${f.tempMax}°C` : 'n/a';

      parts.push(`| ${f.model.toUpperCase()} | ${rawMax} | ${biasStr} | ${corrMax} |`);
    }
  }
  parts.push('');

  // Ensemble summary
  const { p10, p25, p50, p75, p90 } = ensemble.maxPercentiles;
  parts.push(
    `**Ensemble** — Mean: ${ensemble.maxMean}°C | σ: ±${ensemble.maxSpread}°C | Models: ${ensemble.modelsUsed}/${ensemble.modelsUsed + ensemble.modelsFailed}`,
  );
  parts.push(
    `**Percentiles** — P10: ${p10}°C | P25: ${p25}°C | P50: ${p50}°C | P75: ${p75}°C | P90: ${p90}°C`,
  );
  parts.push('');

  // Probability bars — kept in the same visual format as the console output
  if (ensemble.probabilities.length) {
    parts.push('Probabilities — P(max temp > X)');
    parts.push('─────────────────────────────────────────────────────');
    for (const { threshold, probAbove } of ensemble.probabilities) {
      const bar = '█'.repeat(Math.round(probAbove / 5)).padEnd(20, '░');
      parts.push(`  P(max > ${threshold}°C):  ${bar} ${probAbove}%`);
    }
    parts.push('');
  }

  parts.push('FINAL RESULT: ', '\n');

  return `${parts.join('\n')}\n`;
}

/**
 * Derives the snapshot file path from a date string.
 *
 * @example
 * snapshotPath('2026-05-22') // → '/path/to/predicts/may-22.md'
 */
function snapshotPath(date: string): string {
  const [, monthStr, dayStr] = date.split('-');
  const monthIndex = Number.parseInt(monthStr, 10) - 1;
  const day = Number.parseInt(dayStr, 10);
  return join(PREDICTS_DIR, `${MONTH_NAMES[monthIndex]}-${day}.md`);
}

/**
 * Appends a forecast snapshot to the daily `predicts/<month>-<day>.md` file.
 *
 * Creates the file (and `predicts/` directory) if they do not yet exist.
 * Each call appends a new dated section so multiple runs accumulate in one file.
 *
 * @param location - Resolved city location.
 * @param date - Target date in `YYYY-MM-DD` format.
 * @param corrected - Bias-corrected forecasts from all NWP models.
 * @param ensemble - Ensemble statistics computed by the voting system.
 * @param polymarketUrl - The Polymarket event URL this snapshot was compared against.
 * @throws SnapshotWriteError if the file cannot be written.
 */
export const appendForecastSnapshot = Effect.fn('appendForecastSnapshot')(function* (
  location: Location,
  date: string,
  corrected: CorrectedForecast[],
  ensemble: EnsembleResult,
  polymarketUrl: string,
) {
  const filePath = snapshotPath(date);
  const markdown = buildSnapshotMarkdown(location, date, corrected, ensemble, polymarketUrl);

  yield* Effect.tryPromise({
    try: () => mkdir(PREDICTS_DIR, { recursive: true }),
    catch: (err) =>
      new SnapshotWriteError({ cause: `Could not create predicts dir: ${String(err)}` }),
  });

  const existing = yield* Effect.either(
    Effect.tryPromise({
      try: () => readFile(filePath, 'utf8'),
      catch: (err) => new SnapshotWriteError({ cause: String(err) }),
    }),
  );
  const prev = existing._tag === 'Right' ? existing.right : '';

  yield* Effect.tryPromise({
    try: () => writeFile(filePath, prev + markdown, 'utf8'),
    catch: (err) => new SnapshotWriteError({ cause: `Could not write snapshot: ${String(err)}` }),
  });

  process.stdout.write(`  ✓ Snapshot saved → ${filePath}\n`);
});
