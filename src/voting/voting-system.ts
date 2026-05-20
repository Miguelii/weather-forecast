import { Effect } from 'effect';
import { mean, stddev, percentile, normalCDF } from '#utils/stats.js';
import type { CorrectedForecast, EnsembleResult } from '#types.js';
import { EnsembleError } from '#types.js';

/**
 * Pure computation of ensemble statistics from a set of corrected model forecasts.
 *
 * Filters out models with null or error data, then computes mean, standard deviation,
 * percentiles (P10–P90), and threshold probabilities using a normal distribution fit
 * over the ensemble spread.
 *
 * @param correctedForecasts - All corrected model forecasts, including failed ones.
 * @param thresholds - Temperature thresholds for which to compute `P(max > X)`.
 * @returns A complete {@link EnsembleResult} with all ensemble statistics.
 * @throws Error if no valid models remain after filtering.
 */
function runVotingSystemPure(
  correctedForecasts: CorrectedForecast[],
  thresholds: number[],
): EnsembleResult {
  const valid = correctedForecasts.filter((f) => f.tempMax !== null && !f.error);

  if (!valid.length) throw new Error('No valid model forecasts to build ensemble from.');

  const maxes = valid.map((f) => f.tempMax as number);
  const mins = valid.map((f) => f.tempMin).filter((v): v is number => v !== null);

  const sortedMaxes = [...maxes].sort((a, b) => a - b);

  const maxEnsembleMean = mean(maxes);
  if (maxEnsembleMean === null)
    throw new Error('Could not compute ensemble mean — no valid max temperatures.');
  const maxEnsembleSpread = stddev(maxes);

  // Probabilities: P(daily max temperature > threshold)
  const probabilities = thresholds.map((t) => ({
    threshold: t,
    probAbove: Math.round((1 - normalCDF(t, maxEnsembleMean, maxEnsembleSpread)) * 100),
  }));

  const round1 = (v: number | null): number | null => (v !== null ? Math.round(v * 10) / 10 : null);

  return {
    maxMean: Math.round(maxEnsembleMean * 10) / 10,
    maxSpread: Math.round(maxEnsembleSpread * 10) / 10,
    minMean: round1(mins.length ? mean(mins) : null),
    maxPercentiles: {
      p10: Math.round((percentile(sortedMaxes, 10) as number) * 10) / 10,
      p25: Math.round((percentile(sortedMaxes, 25) as number) * 10) / 10,
      p50: Math.round((percentile(sortedMaxes, 50) as number) * 10) / 10,
      p75: Math.round((percentile(sortedMaxes, 75) as number) * 10) / 10,
      p90: Math.round((percentile(sortedMaxes, 90) as number) * 10) / 10,
    },
    probabilities,
    modelVotes: valid,
    modelsUsed: valid.length,
    modelsFailed: correctedForecasts.length - valid.length,
  };
}

/**
 * Effect wrapper around {@link runVotingSystemPure} for safe use in the I/O pipeline.
 *
 * Catches any errors thrown by the pure function and converts them into typed
 * {@link EnsembleError} failures so they propagate correctly through the Effect stack.
 *
 * @param correctedForecasts - Bias-corrected forecasts from all NWP models.
 * @param thresholds - Temperature thresholds for probability computation (default: `[]`).
 * @returns An Effect resolving to {@link EnsembleResult}, or failing with {@link EnsembleError}.
 */
export const runVotingSystem = (
  correctedForecasts: CorrectedForecast[],
  thresholds: number[] = [],
): Effect.Effect<EnsembleResult, EnsembleError> =>
  Effect.try({
    try: () => runVotingSystemPure(correctedForecasts, thresholds),
    catch: (err) => new EnsembleError({ cause: err instanceof Error ? err.message : String(err) }),
  });
