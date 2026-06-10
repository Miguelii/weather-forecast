import { Effect } from 'effect';
import type { ForecastRunOptions } from '#types.js';
import { resolveCity } from '#utils/geocoding.js';
import { fetchAllModels } from '#fetchers/openMeteo.js';
import { correctForecast } from '#bias/apply.js';
import { loadBias } from '#bias/store.js';
import { runVotingSystem } from '#voting/voting-system.js';
import { printForecastOutput } from '#utils/display.js';
import { appendForecastSnapshot } from '#utils/snapshotWriter.js';
import { buildPolymarketEventUrl, fetchPolymarketThresholds } from '#commands/polymarket.js';

/**
 * Runs a full ensemble forecast for a single city/date as a reusable Effect.
 *
 * Resolves the city, derives the canonical Polymarket event URL, fetches its temperature
 * buckets (used as the probability thresholds), fetches all NWP models, applies bias
 * corrections, runs the voting system, prints the report, and appends a snapshot recording
 * the Polymarket URL. Used by the `forecast-all` command.
 *
 * @param opts - City and date for the forecast run.
 * @returns An Effect that resolves once the forecast has been printed and persisted.
 */
export const runCityForecast = Effect.fn('runCityForecast')(function* (opts: ForecastRunOptions) {
  // Load bias store once — avoids 4 separate file reads (one per model)
  const [location, biasStore] = yield* Effect.all([resolveCity(opts.city), loadBias()], {
    concurrency: 2,
  });
  process.stdout.write(
    `\nLocation: ${location.name}, ${location.country} (${location.lat}, ${location.lon})\n`,
  );

  // The Polymarket event provides the temperature buckets used as probability thresholds,
  // and its URL is recorded in the snapshot.
  const polymarketUrl = buildPolymarketEventUrl(location.name, opts.date);
  const thresholds = yield* fetchPolymarketThresholds(polymarketUrl);

  process.stdout.write('Fetching forecasts from IFS, GFS, ICON...\n');

  const raw = yield* fetchAllModels(location.lat, location.lon, opts.date);
  const corrected = raw.map((f) => correctForecast(f, location.name, biasStore));
  const ensemble = yield* runVotingSystem(corrected, thresholds);

  printForecastOutput(location, opts.date, corrected, ensemble);

  yield* appendForecastSnapshot(location, opts.date, corrected, ensemble, polymarketUrl);
});
