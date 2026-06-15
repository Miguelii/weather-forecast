import { Effect } from 'effect';
import { mean, stddev, percentile, normalCDF, invNormalCDF } from '#utils/stats.js';
import type {
  CorrectedForecast,
  EnsembleResult,
  Percentiles,
  ProbabilityResult,
  RegimeAssessment,
} from '#types.js';
import { EnsembleError } from '#types/errors.js';
import {
  DEFAULT_EMPIRICAL_RMSE,
  MIN_ENSEMBLE_MEMBERS,
  MISSING_MODEL_SIGMA_INFLATION,
  TOTAL_MODELS,
} from '#utils/constants.js';

/** Default regime when none is supplied — leaves the distribution unchanged. */
const NORMAL_REGIME: RegimeAssessment = {
  kind: 'normal',
  sigmaMultiplier: 1,
  meanShift: 0,
  reason: 'No regime adjustment.',
};

/** Options controlling how the voting system builds the predictive distribution. */
export interface VotingOptions {
  /** Temperature thresholds for which to compute `P(max > X)`. */
  thresholds?: number[];
  /**
   * Pooled, bias-corrected ensemble member maxes (A1). When at least
   * {@link MIN_ENSEMBLE_MEMBERS} are present the distribution is built empirically from them;
   * otherwise the deterministic normal-fit path over the model maxes is used.
   */
  members?: number[];
  /** Per-city empirical RMSE (°C) used as the spread floor (A2). */
  empiricalRmse?: number;
  /** Detected regime adjustment (storm/heat-wave) — widens σ and may shift the mean (C). */
  regime?: RegimeAssessment;
}

const round1 = (v: number): number => Math.round(v * 10) / 10;

/**
 * Computes percentiles + threshold probabilities empirically from a sorted sample of member
 * maxes (the A1 ensemble path).
 *
 * @param sorted - Ascending member maxes already shifted/scaled to the final mean and spread.
 * @param thresholds - Temperature thresholds for `P(max > X)`.
 * @returns Percentiles and probabilities derived directly from the sample.
 */
function empiricalDistribution(
  sorted: number[],
  thresholds: number[],
): { percentiles: Percentiles; probabilities: ProbabilityResult[] } {
  const at = (p: number): number => round1(percentile(sorted, p) as number);
  const probabilities = thresholds.map((t) => ({
    threshold: t,
    probAbove: Math.round((sorted.filter((v) => v > t).length / sorted.length) * 100),
  }));
  return {
    percentiles: { p10: at(10), p25: at(25), p50: at(50), p75: at(75), p90: at(90) },
    probabilities,
  };
}

/**
 * Computes percentiles + threshold probabilities from a fitted normal `N(mean, sigma)` (the
 * deterministic path). Percentiles use the inverse CDF so they stay consistent with the same
 * `sigma` that drives the probabilities — instead of reading them off only the model points,
 * which understates the spread.
 *
 * @param finalMean - Calibrated ensemble mean.
 * @param sigma - Calibrated ensemble spread.
 * @param thresholds - Temperature thresholds for `P(max > X)`.
 * @returns Percentiles and probabilities derived from the normal fit.
 */
function normalDistribution(
  finalMean: number,
  sigma: number,
  thresholds: number[],
): { percentiles: Percentiles; probabilities: ProbabilityResult[] } {
  const at = (p: number): number => round1(invNormalCDF(p, finalMean, sigma));
  const probabilities = thresholds.map((t) => ({
    threshold: t,
    probAbove: Math.round((1 - normalCDF(t, finalMean, sigma)) * 100),
  }));
  return {
    percentiles: { p10: at(0.1), p25: at(0.25), p50: at(0.5), p75: at(0.75), p90: at(0.9) },
    probabilities,
  };
}

/**
 * Pure computation of ensemble statistics from corrected model forecasts (and optionally pooled
 * ensemble members).
 *
 * Calibration applied to the spread, in order: a per-city empirical-RMSE **floor** so σ never
 * undershoots realized error; **inflation** when models are missing (deterministic path); and a
 * **regime multiplier** plus mean shift for storm/heat-wave days. The distribution is then read
 * empirically from the members when enough are present, otherwise from a normal fit.
 *
 * @param correctedForecasts - All corrected model forecasts, including failed ones.
 * @param options - Thresholds, optional pooled members, empirical RMSE floor, and regime.
 * @returns A complete {@link EnsembleResult}.
 * @throws Error if no valid models remain after filtering.
 */
function runVotingSystemPure(
  correctedForecasts: CorrectedForecast[],
  options: VotingOptions,
): EnsembleResult {
  const {
    thresholds = [],
    members = [],
    empiricalRmse = DEFAULT_EMPIRICAL_RMSE,
    regime = NORMAL_REGIME,
  } = options;

  const valid = correctedForecasts.filter((f) => f.tempMax !== null && !f.error);
  if (!valid.length) throw new Error('No valid model forecasts to build ensemble from.');

  const modelMaxes = valid.map((f) => f.tempMax as number);
  const mins = valid.map((f) => f.tempMin).filter((v): v is number => v !== null);

  const useMembers = members.length >= MIN_ENSEMBLE_MEMBERS;
  const sample = useMembers ? members : modelMaxes;

  const rawMean = mean(sample) as number;
  const interStd = stddev(sample);

  // σ floor: never claim less uncertainty than the realized RMSE for this city.
  let sigma = Math.max(interStd, empiricalRmse);
  // A missing model means MORE uncertainty — inflate rather than let the tiny sample shrink σ.
  // (The member path loses a model's members without collapsing, so it is exempt.)
  if (!useMembers && valid.length < TOTAL_MODELS) sigma *= MISSING_MODEL_SIGMA_INFLATION;
  // Regime widening (storm/heat-wave).
  sigma *= regime.sigmaMultiplier;
  const finalMean = rawMean + regime.meanShift;

  // Empirical path needs real member spread to rescale around; otherwise fall back to normal.
  const distribution =
    useMembers && interStd > 0
      ? empiricalDistribution(
          members.map((v) => finalMean + ((v - rawMean) * sigma) / interStd).sort((a, b) => a - b),
          thresholds,
        )
      : normalDistribution(finalMean, sigma, thresholds);

  return {
    maxMean: round1(finalMean),
    maxSpread: round1(sigma),
    minMean: mins.length ? round1(mean(mins) as number) : null,
    maxPercentiles: distribution.percentiles,
    probabilities: distribution.probabilities,
    modelVotes: valid,
    modelsUsed: valid.length,
    modelsFailed: correctedForecasts.length - valid.length,
    regime,
    membersUsed: useMembers ? members.length : 0,
  };
}

/**
 * Effect wrapper around {@link runVotingSystemPure} for safe use in the I/O pipeline.
 *
 * Catches any errors thrown by the pure function and converts them into typed
 * {@link EnsembleError} failures so they propagate correctly through the Effect stack.
 *
 * @param correctedForecasts - Bias-corrected forecasts from all NWP models.
 * @param options - Voting options (thresholds, members, empirical RMSE floor, regime).
 * @returns An Effect resolving to {@link EnsembleResult}, or failing with {@link EnsembleError}.
 */
export const runVotingSystem = (
  correctedForecasts: CorrectedForecast[],
  options: VotingOptions = {},
): Effect.Effect<EnsembleResult, EnsembleError> =>
  Effect.try({
    try: () => runVotingSystemPure(correctedForecasts, options),
    catch: (err) => new EnsembleError({ cause: err instanceof Error ? err.message : String(err) }),
  });
