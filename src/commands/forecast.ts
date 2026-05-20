import type { Command } from 'commander';
import { Effect } from 'effect';
import { resolveCity } from '#utils/geocoding.js';
import { fetchAllModels } from '#fetchers/openMeteo.js';
import { correctForecast } from '#bias/apply.js';
import { loadBias } from '#bias/store.js';
import { runVotingSystem } from '#voting/voting-system.js';
import { validateDate } from '#utils/validateDate.js';
import { printForecastOutput } from '#utils/display.js';
import { parsePolymarket } from '#utils/parsePolymarket.js';
import { runOrExit } from '#utils/runOrExit.js';

/**
 * Registers the `forecast` command on the CLI.
 *
 * Fetches ensemble NWP forecasts for a city/date, applies bias corrections,
 * runs the voting system, and prints a formatted report. Optionally compares
 * model probabilities against Polymarket odds when `--polymarket` is supplied.
 *
 * @param cli - The root Commander instance to attach the command to.
 */
export function registerForecastCommand(cli: Command): void {
  cli
    .command('forecast')
    .description('Run ensemble forecast for a city on a given date')
    .requiredOption('--city <name>', 'City name (e.g. "London")')
    .requiredOption('--date <YYYY-MM-DD>', 'Target date')
    .option('--threshold <temps>', 'Comma-separated temperature thresholds (e.g. "18,20,22")')
    .option('--polymarket <file>', 'Path to Polymarket odds file (e.g. predicts/London-21-may.md)')
    .action((opts: { city: string; date: string; threshold?: string; polymarket?: string }) => {
      validateDate(opts.date);

      runOrExit(
        Effect.gen(function* () {
          const polymarketLines = opts.polymarket
            ? yield* parsePolymarket(opts.polymarket)
            : undefined;

          // Merge explicit thresholds with those extracted from the Polymarket file
          const customThresholds = opts.threshold
            ? opts.threshold
                .split(',')
                .map((t) => Number.parseFloat(t.trim()))
                .filter((t) => !Number.isNaN(t))
            : [];
          const polyThresholds = polymarketLines ? polymarketLines.map((l) => l.threshold) : [];
          const thresholds = [...new Set([...customThresholds, ...polyThresholds])].sort(
            (a, b) => a - b,
          );

          // Load bias store once — avoids 4 separate file reads (one per model)
          const [location, biasStore] = yield* Effect.all([resolveCity(opts.city), loadBias()], {
            concurrency: 2,
          });
          process.stdout.write(
            `\nLocation: ${location.name}, ${location.country} (${location.lat}, ${location.lon})\n`,
          );
          process.stdout.write('Fetching forecasts from IFS, GFS, ICON...\n');

          const raw = yield* fetchAllModels(location.lat, location.lon, opts.date);
          const corrected = raw.map((f) => correctForecast(f, location.name, biasStore));
          const ensemble = yield* runVotingSystem(corrected, thresholds);

          printForecastOutput(location, opts.date, corrected, ensemble, polymarketLines);
        }),
      );
    });
}
