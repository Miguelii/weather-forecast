import { getBiasValue } from '#bias/store.js';
import type { BiasStore, RawForecast, CorrectedForecast } from '#types.js';

/**
 * Applies a stored bias correction to a raw model forecast.
 *
 * Formula: `corrected = raw - bias`. A positive bias means the model runs warm;
 * the correction shifts all temperature fields down accordingly.
 * If no bias is stored for the given city/model pair, bias defaults to 0 (no change).
 *
 * @param forecast - Raw forecast output from a single NWP model.
 * @param city - Resolved city name used to look up the bias (case-sensitive, from the geocoding API).
 * @param store - In-memory bias store loaded once per CLI invocation.
 * @returns A {@link CorrectedForecast} with both raw and corrected temperature fields.
 */
export function correctForecast(
  forecast: RawForecast,
  city: string,
  store: BiasStore,
): CorrectedForecast {
  const bias = getBiasValue(store, city, forecast.model);
  const adj = (v: number | null): number | null =>
    v !== null ? Math.round((v - bias) * 10) / 10 : null;

  return {
    ...forecast,
    bias,
    rawTempMax: forecast.tempMax,
    rawTempMin: forecast.tempMin,
    rawTempMean: forecast.tempMean,
    tempMax: adj(forecast.tempMax),
    tempMin: adj(forecast.tempMin),
    tempMean: adj(forecast.tempMean),
  };
}
