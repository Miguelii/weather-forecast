import type { CityClimatology, DayConditions, RegimeAssessment } from '#types.js';
import {
  HEATWAVE_ANOMALY_SIGMA,
  HEATWAVE_SIGMA_MULTIPLIER,
  STORM_CAPE_THRESHOLD,
  STORM_CLOUD_THRESHOLD,
  STORM_MEAN_SHIFT,
  STORM_PRECIP_PROB_THRESHOLD,
  STORM_SIGMA_MULTIPLIER,
} from '#utils/constants.js';

/** Regime returned when neither storm nor heat-wave conditions are detected. */
const NORMAL_REGIME: RegimeAssessment = {
  kind: 'normal',
  sigmaMultiplier: 1,
  meanShift: 0,
  reason: 'Normal regime — no convective or heat-wave signal.',
};

/**
 * Detects a convective-suppression (storm) regime from the day's atmospheric conditions.
 *
 * Afternoon clouds and thunderstorms cap the daily max and make it volatile (the Shenzhen
 * failure mode). Triggers when rain is likely AND either CAPE or cloud cover is high; widens the
 * spread and nudges the mean down.
 *
 * @param conditions - Summarised atmospheric conditions, or null if unavailable.
 * @returns A storm {@link RegimeAssessment}, or null if no storm signal is present.
 */
function detectStorm(conditions: DayConditions | null): RegimeAssessment | null {
  if (!conditions) return null;

  const { capeMaxMidday, cloudCoverMeanMidday, precipProbabilityMax } = conditions;
  const capeSignal = capeMaxMidday !== null && capeMaxMidday >= STORM_CAPE_THRESHOLD;
  const precipSignal =
    precipProbabilityMax !== null && precipProbabilityMax >= STORM_PRECIP_PROB_THRESHOLD;
  const cloudSignal =
    cloudCoverMeanMidday !== null && cloudCoverMeanMidday >= STORM_CLOUD_THRESHOLD;

  if (!precipSignal || !(capeSignal || cloudSignal)) return null;

  const drivers = [
    capeSignal ? `CAPE ${Math.round(capeMaxMidday as number)} J/kg` : null,
    `precip ${Math.round(precipProbabilityMax as number)}%`,
    cloudSignal ? `cloud ${Math.round(cloudCoverMeanMidday as number)}%` : null,
  ].filter((d): d is string => d !== null);

  return {
    kind: 'storm',
    sigmaMultiplier: STORM_SIGMA_MULTIPLIER,
    meanShift: STORM_MEAN_SHIFT,
    reason: `Storm regime (${drivers.join(', ')}) — convective capping; spread widened, mean lowered.`,
  };
}

/**
 * Detects a heat-wave (blocking-ridge) regime from the forecast anomaly vs climatology.
 *
 * Under persistent ridging the model error structure changes and the upper tail thickens (the
 * Beijing failure mode). Triggers when the forecast max is far enough above the monthly normal;
 * widens the spread. The systematic mean offset is handled separately by `bias compute`.
 *
 * @param ensembleMax - The ensemble mean daily max (°C) before regime adjustment.
 * @param climatology - The city's climate normals, or null if unavailable.
 * @param monthIndex - Calendar month index (0 = January).
 * @returns A heat-wave {@link RegimeAssessment}, or null if no heat-wave signal is present.
 */
function detectHeatwave(
  ensembleMax: number,
  climatology: CityClimatology | null,
  monthIndex: number,
): RegimeAssessment | null {
  if (!climatology) return null;

  const normalMax = climatology.monthlyMaxMean[monthIndex];
  if (normalMax === undefined || climatology.maxStd <= 0) return null;

  const anomaly = (ensembleMax - normalMax) / climatology.maxStd;
  if (anomaly < HEATWAVE_ANOMALY_SIGMA) return null;

  return {
    kind: 'heatwave',
    sigmaMultiplier: HEATWAVE_SIGMA_MULTIPLIER,
    meanShift: 0,
    reason: `Heat-wave regime (+${anomaly.toFixed(1)}σ vs ${normalMax}°C normal) — upper tail widened.`,
  };
}

/**
 * Classifies the day's regime and returns how the voting system should adjust the distribution.
 *
 * Storm takes precedence over heat-wave: on a convective day, clouds/rain cap the max even during
 * a hot spell. When neither fires, the distribution is left unchanged.
 *
 * @param ensembleMax - The ensemble mean daily max (°C) before regime adjustment.
 * @param conditions - Summarised atmospheric conditions for the day, or null if unavailable.
 * @param climatology - The city's climate normals, or null if unavailable.
 * @param monthIndex - Calendar month index (0 = January).
 * @returns The detected {@link RegimeAssessment}.
 */
export function assessRegime(
  ensembleMax: number,
  conditions: DayConditions | null,
  climatology: CityClimatology | null,
  monthIndex: number,
): RegimeAssessment {
  return (
    detectStorm(conditions) ?? detectHeatwave(ensembleMax, climatology, monthIndex) ?? NORMAL_REGIME
  );
}
