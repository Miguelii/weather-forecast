import { getBiasValue } from './store.js';
import type { BiasStore, RawForecast, CorrectedForecast } from '../types.js';

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
