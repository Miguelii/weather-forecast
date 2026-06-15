import type { BiasStore, CalibrationStore, ForecastLogEntry, ModelId } from '#types.js';
import { MODELS } from '#utils/constants.js';
import { mean } from '#utils/stats.js';

const round1 = (v: number): number => Math.round(v * 10) / 10;

/** Result of recomputing bias and calibration from the forecast log. */
export interface ComputedCalibration {
  /** Per-city/model bias = mean(raw − observed) over the window. */
  bias: BiasStore;
  /** Per-city empirical RMSE of the ensemble mean vs observed (the σ floor). */
  calibration: CalibrationStore;
  /** Number of recorded days used per city. */
  perCity: Record<string, number>;
}

/** Groups log entries that have a recorded outcome by city. */
function groupByCity(entries: ForecastLogEntry[]): Map<string, ForecastLogEntry[]> {
  const byCity = new Map<string, ForecastLogEntry[]>();
  for (const entry of entries) {
    if (entry.observed !== null) {
      const list = byCity.get(entry.city) ?? [];
      list.push(entry);
      byCity.set(entry.city, list);
    }
  }
  return byCity;
}

/**
 * Recomputes per-city/model bias and per-city empirical RMSE from the forecast log (B3/A2).
 *
 * For each city it takes the most recent `window` recorded days, then for each model averages
 * `raw − observed` (the new bias) and computes the RMSE of the ensemble mean vs observed (the new
 * σ floor). Cities/models without recorded data are simply omitted, leaving any manual values
 * untouched when the caller merges the result.
 *
 * @param entries - All forecast log entries (rows without `observed` are ignored).
 * @param window - Trailing number of recorded days per city to average over.
 * @returns The computed {@link ComputedCalibration}.
 */
export function computeCalibrationFromLog(
  entries: ForecastLogEntry[],
  window: number,
): ComputedCalibration {
  const bias: BiasStore = {};
  const calibration: CalibrationStore = {};
  const perCity: Record<string, number> = {};

  for (const [city, list] of groupByCity(entries)) {
    // Most recent `window` days (ISO dates sort lexicographically).
    const recent = [...list].sort((a, b) => b.date.localeCompare(a.date)).slice(0, window);
    perCity[city] = recent.length;

    const modelBias: Partial<Record<ModelId, number>> = {};
    for (const { id } of MODELS) {
      const samples = recent
        .map((e) => {
          const raw = e.rawByModel[id];
          return raw !== undefined && e.observed !== null ? raw - e.observed : null;
        })
        .filter((v): v is number => v !== null);
      if (samples.length) modelBias[id] = round1(mean(samples) as number);
    }
    if (Object.keys(modelBias).length) bias[city] = modelBias;

    const squaredErrors = recent
      .map((e) => (e.observed !== null ? (e.ensembleMean - e.observed) ** 2 : null))
      .filter((v): v is number => v !== null);
    if (squaredErrors.length) calibration[city] = round1(Math.sqrt(mean(squaredErrors) as number));
  }

  return { bias, calibration, perCity };
}
