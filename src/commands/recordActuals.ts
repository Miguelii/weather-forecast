import type { Command } from 'commander';
import { Effect } from 'effect';
import { resolveCity } from '#utils/geocoding.js';
import { fetchObservedMax } from '#fetchers/openMeteo.js';
import { setObservedInLog } from '#utils/forecastLog.js';
import { BATCH_CITIES } from '#utils/constants.js';
import { runOrExit } from '#utils/runOrExit.js';
import { validateDate } from '#utils/validateDate.js';

const SEPARATOR = '='.repeat(60);

/**
 * Records the observed daily max for one city/date into the forecast log (B2).
 *
 * Resolves the city, fetches the observed max (archive → forecast fallback), and writes it back
 * into every matching unfilled log row. Returns a short status line for the summary.
 *
 * @param city - City name to record.
 * @param date - Target date in `YYYY-MM-DD` format.
 * @returns An Effect resolving to a human-readable result line.
 */
const recordCity = Effect.fn('recordCity')(function* (city: string, date: string) {
  const location = yield* resolveCity(city);
  const observed = yield* fetchObservedMax(location.lat, location.lon, date);
  const updated = yield* setObservedInLog(location.name, date, observed);
  return `${location.name}: observed ${observed}°C — ${updated} log row(s) updated`;
});

/**
 * Registers the `record-actuals` command on the CLI.
 *
 * For a past date, records the observed daily max per city into the structured forecast log so
 * `bias compute` can recalibrate. Cities run sequentially because each updates the shared log file
 * (read-modify-write); a city that fails is reported without aborting the rest.
 *
 * @param cli - The root Commander instance to attach the command to.
 */
export function registerRecordActualsCommand(cli: Command): void {
  cli
    .command('record-actuals')
    .description('Record observed daily max into the forecast log for a past date')
    .requiredOption('--date <YYYY-MM-DD>', 'Target date (must be in the past)')
    .option('--cities <names>', 'Comma-separated city override (default: 5 built-in cities)')
    .action((opts: { date: string; cities?: string }) => {
      validateDate(opts.date);

      const cities = opts.cities
        ? opts.cities
            .split(',')
            .map((c) => c.trim())
            .filter(Boolean)
        : [...BATCH_CITIES];

      runOrExit(
        Effect.gen(function* () {
          const failures: { city: string; error: string }[] = [];

          for (const city of cities) {
            const result = yield* Effect.either(recordCity(city, opts.date));
            if (result._tag === 'Right') {
              process.stdout.write(`  ✓ ${result.right}\n`);
            } else {
              failures.push({ city, error: result.left.message });
              process.stdout.write(`  ✗ ${city} failed: ${result.left.message}\n`);
            }
          }

          const succeeded = cities.length - failures.length;
          process.stdout.write(`\n${SEPARATOR}\n`);
          process.stdout.write(`Done: ${succeeded}/${cities.length} cities recorded.\n\n`);
        }),
      );
    });
}
