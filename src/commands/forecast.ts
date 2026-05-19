import type { Command } from 'commander';
import { Effect } from 'effect';
import { resolveCity } from '../utils/geocoding.js';
import { fetchAllModels } from '../fetchers/openMeteo.js';
import { correctForecast } from '../bias/apply.js';
import { loadBias } from '../bias/store.js';
import { runVotingSystem } from '../voting/voting-system.js';
import { validateDate } from '../utils/validateDate.js';
import { printForecastOutput } from '../utils/display.js';
import { runOrExit } from '../utils/runOrExit.js';

export function registerForecastCommand(cli: Command): void {
  cli
    .command('forecast')
    .description('Run ensemble forecast for a city on a given date')
    .requiredOption('--city <name>', 'City name (e.g. "London")')
    .requiredOption('--date <YYYY-MM-DD>', 'Target date')
    .option('--threshold <temps>', 'Comma-separated temperature thresholds (e.g. "18,20,22")')
    .action((opts: { city: string; date: string; threshold?: string }) => {
      validateDate(opts.date);

      const thresholds = opts.threshold
        ? opts.threshold
            .split(',')
            .map((t) => Number.parseFloat(t.trim()))
            .filter((t) => !Number.isNaN(t))
        : [];

      runOrExit(
        Effect.gen(function* () {
          // Load bias store once — avoids 4 separate file reads (one per model)
          const [location, biasStore] = yield* Effect.all([resolveCity(opts.city), loadBias()], {
            concurrency: 2,
          });
          process.stdout.write(
            `\nLocation: ${location.name}, ${location.country} (${location.lat}, ${location.lon})\n`,
          );
          process.stdout.write('Fetching forecasts from IFS, AIFS, GFS, ICON...\n');

          const raw = yield* fetchAllModels(location.lat, location.lon, opts.date);
          const corrected = raw.map((f) => correctForecast(f, location.name, biasStore));
          const ensemble = yield* runVotingSystem(corrected, thresholds);

          printForecastOutput(location, opts.date, corrected, ensemble);
        }),
      );
    });
}
