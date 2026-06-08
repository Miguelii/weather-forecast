import type { Command } from 'commander';
import { Effect } from 'effect';
import type { ForecastRunOptions } from '#types.js';
import { resolveCity } from '#utils/geocoding.js';
import { fetchAllModels } from '#fetchers/openMeteo.js';
import { correctForecast } from '#bias/apply.js';
import { loadBias } from '#bias/store.js';
import { runVotingSystem } from '#voting/voting-system.js';
import { validateDate } from '#utils/validateDate.js';
import { printForecastOutput } from '#utils/display.js';
import { parsePolymarket } from '#utils/parsePolymarket.js';
import { runOrExit } from '#utils/runOrExit.js';
import { appendForecastSnapshot } from '#utils/snapshotWriter.js';
import { buildPolymarketEventUrl, fetchAndSavePolymarketOdds } from '#commands/polymarket.js';

/**
 * Runs a full ensemble forecast for a single city/date as a reusable Effect.
 *
 * Resolves the city, fetches all NWP models, applies bias corrections, runs the voting
 * system, prints the report, and (when Polymarket odds are present) appends a snapshot.
 * Shared by both the `forecast` and `forecast-all` commands.
 *
 * @param opts - City, date, and optional thresholds / Polymarket file or event URL.
 * @returns An Effect that resolves once the forecast has been printed and persisted.
 */
export const runCityForecast = Effect.fn('runCityForecast')(function* (opts: ForecastRunOptions) {
  // Accept either a pre-saved odds file or a live Polymarket event URL
  const polymarketPath = opts.polymarket?.startsWith('http')
    ? yield* fetchAndSavePolymarketOdds(opts.polymarket)
    : opts.polymarket;

  const polymarketLines = polymarketPath ? yield* parsePolymarket(polymarketPath) : undefined;

  // Merge explicit thresholds with those extracted from the Polymarket file
  const customThresholds = opts.threshold
    ? opts.threshold
        .split(',')
        .map((t) => Number.parseFloat(t.trim()))
        .filter((t) => !Number.isNaN(t))
    : [];
  const polyThresholds = polymarketLines ? polymarketLines.map((l) => l.threshold) : [];
  const thresholds = [...new Set([...customThresholds, ...polyThresholds])].sort((a, b) => a - b);

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

  printForecastOutput(location, opts.date, corrected, ensemble);

  if (polymarketLines) {
    // Show the live event URL when given, otherwise rebuild the canonical one from city + date
    const polymarketUrl = opts.polymarket?.startsWith('http')
      ? opts.polymarket
      : buildPolymarketEventUrl(location.name, opts.date);
    yield* appendForecastSnapshot(location, opts.date, corrected, ensemble, polymarketUrl);
  }
});

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
    .option(
      '--polymarket <file|url>',
      'Polymarket odds file path or event URL — fetches and saves odds automatically when a URL is provided',
    )
    .action((opts: ForecastRunOptions) => {
      validateDate(opts.date);
      runOrExit(runCityForecast(opts));
    });
}
