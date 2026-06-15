import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Effect } from 'effect';
import type { ForecastLogEntry } from '#types.js';
import { ForecastLogError } from '#types/errors.js';
import { FORECAST_LOG_PATH } from '#utils/constants.js';

/**
 * Appends one forecast record to the structured JSONL log (B1).
 *
 * Creates the `data/` directory and file on first write. Each call adds a single line so records
 * accumulate without a read-modify-write race (unlike the shared daily snapshot file).
 *
 * @param entry - The forecast record to persist (`observed` starts null, filled later by B2).
 * @throws ForecastLogError if the directory or file cannot be written.
 */
export const appendForecastLog = Effect.fn('appendForecastLog')(function* (
  entry: ForecastLogEntry,
) {
  yield* Effect.tryPromise({
    try: () => mkdir(dirname(FORECAST_LOG_PATH), { recursive: true }),
    catch: (err) => new ForecastLogError({ cause: `Could not create data dir: ${String(err)}` }),
  });

  yield* Effect.tryPromise({
    try: () => appendFile(FORECAST_LOG_PATH, `${JSON.stringify(entry)}\n`, 'utf8'),
    catch: (err) => new ForecastLogError({ cause: `Could not append to log: ${String(err)}` }),
  });
});

/**
 * Reads and parses every record from the forecast log.
 *
 * A missing file is a valid initial state (returns `[]`). Blank lines are skipped; a malformed
 * line fails loudly so a corrupt log is never silently treated as empty.
 *
 * @returns All {@link ForecastLogEntry} records in file order.
 * @throws ForecastLogError if the file exists but a line cannot be parsed.
 */
export const readForecastLog = Effect.fn('readForecastLog')(function* () {
  const result = yield* Effect.either(
    Effect.tryPromise({
      try: () => readFile(FORECAST_LOG_PATH, 'utf8'),
      catch: (err) => new ForecastLogError({ cause: String(err) }),
    }),
  );

  if (result._tag === 'Left') return [] as ForecastLogEntry[];

  return yield* Effect.try({
    try: () =>
      result.right
        .split('\n')
        .filter((line) => line.trim().length > 0)
        .map((line) => JSON.parse(line) as ForecastLogEntry),
    catch: (err) => new ForecastLogError({ cause: `Failed to parse forecast log: ${String(err)}` }),
  });
});

/**
 * Records the observed daily max for a city/date by rewriting the log with that field filled (B2).
 *
 * Matches on city + date and only updates rows whose `observed` is still null, so re-running
 * `record-actuals` is idempotent. Returns how many rows were updated.
 *
 * @param city - Resolved city name (case-sensitive).
 * @param date - Target date in `YYYY-MM-DD` format.
 * @param observed - Observed daily max in °C.
 * @returns The number of log rows updated.
 * @throws ForecastLogError if the log cannot be read or written.
 */
export const setObservedInLog = Effect.fn('setObservedInLog')(function* (
  city: string,
  date: string,
  observed: number,
) {
  const entries = yield* readForecastLog();

  let updated = 0;
  const next = entries.map((entry) => {
    if (entry.city === city && entry.date === date && entry.observed === null) {
      updated += 1;
      return { ...entry, observed };
    }
    return entry;
  });

  if (updated > 0) {
    const body = next.map((entry) => JSON.stringify(entry)).join('\n');
    yield* Effect.tryPromise({
      try: () => writeFile(FORECAST_LOG_PATH, `${body}\n`, 'utf8'),
      catch: (err) => new ForecastLogError({ cause: `Could not rewrite log: ${String(err)}` }),
    });
  }

  return updated;
});
