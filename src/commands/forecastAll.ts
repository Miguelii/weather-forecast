import type { Command } from 'commander';
import { Effect } from 'effect';
import { runCityForecast } from '#commands/forecast.js';
import { BATCH_CITIES } from '#utils/constants.js';
import { runOrExit } from '#utils/runOrExit.js';
import { validateDate } from '#utils/validateDate.js';

const SEPARATOR = '='.repeat(60);

/**
 * Registers the `forecast-all` command on the CLI.
 *
 * Runs a full ensemble forecast plus Polymarket comparison for several cities on a single
 * date, building each Polymarket event URL automatically. Defaults to {@link BATCH_CITIES}
 * but accepts a `--cities` override. Cities run sequentially so console output and the daily
 * snapshot file stay clean; a city that fails is reported in the summary without aborting the
 * rest.
 *
 * @param cli - The root Commander instance to attach the command to.
 */
export function registerForecastAllCommand(cli: Command): void {
  cli
    .command('forecast-all')
    .description('Run ensemble forecast + Polymarket comparison for several cities on a date')
    .requiredOption('--date <YYYY-MM-DD>', 'Target date')
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

          // Sequential on purpose: parallel runs would interleave stdout and race on the
          // read-modify-write of the shared daily snapshot file.
          for (const city of cities) {
            process.stdout.write(`\n${SEPARATOR}\n=== ${city} — ${opts.date}\n${SEPARATOR}\n`);

            const result = yield* Effect.either(runCityForecast({ city, date: opts.date }));

            if (result._tag === 'Left') {
              failures.push({ city, error: result.left.message });
              process.stdout.write(`  ✗ ${city} failed: ${result.left.message}\n`);
            }
          }

          // Summary
          const succeeded = cities.length - failures.length;
          process.stdout.write(`\n${SEPARATOR}\n`);
          process.stdout.write(`Done: ${succeeded}/${cities.length} cities succeeded.\n`);
          for (const f of failures) {
            process.stdout.write(`  ✗ ${f.city}: ${f.error}\n`);
          }
          process.stdout.write('\n');
        }),
      );
    });
}
