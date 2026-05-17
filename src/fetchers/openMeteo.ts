import type { ModelDef, ModelId, RawForecast } from '../types.js';
import { FORECAST_URL, FETCH_TIMEOUT_MS, MODELS } from '../utils/constants.js';

interface OpenMeteoResponse {
  hourly?: { temperature_2m?: (number | null)[] };
  daily?: { temperature_2m_max?: (number | null)[]; temperature_2m_min?: (number | null)[] };
}

export async function fetchModel(
  lat: number,
  lon: number,
  date: string,
  modelDef: ModelDef,
): Promise<RawForecast> {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    hourly: 'temperature_2m',
    daily: 'temperature_2m_max,temperature_2m_min',
    models: modelDef.param,
    start_date: date,
    end_date: date,
    timezone: 'auto',
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`${FORECAST_URL}?${params}`, { signal: controller.signal });
  } catch (err) {
    throw new Error(
      `Fetch timed out or failed [${modelDef.id}]: ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Open-Meteo error [${modelDef.id}] ${res.status}: ${text}`);
  }
  const data = (await res.json()) as OpenMeteoResponse;

  const hourly = (data.hourly?.temperature_2m ?? []).filter((v): v is number => v !== null);

  let tempMax = data.daily?.temperature_2m_max?.[0] ?? null;
  let tempMin = data.daily?.temperature_2m_min?.[0] ?? null;

  // fallback: derive max/min from hourly when daily aggregation isn't supported (e.g. AIFS)
  // Use reduce instead of spread to avoid call stack overflow on large arrays
  if ((tempMax === null || tempMin === null) && hourly.length) {
    tempMax = Math.round(hourly.reduce((a, b) => Math.max(a, b), -Infinity) * 10) / 10;
    tempMin = Math.round(hourly.reduce((a, b) => Math.min(a, b), Infinity) * 10) / 10;
  }

  const tempMean =
    tempMax !== null && tempMin !== null ? Math.round(((tempMax + tempMin) / 2) * 10) / 10 : null;

  return {
    model: modelDef.id as ModelId,
    date,
    tempMax,
    tempMin,
    tempMean,
  };
}

export async function fetchAllModels(
  lat: number,
  lon: number,
  date: string,
): Promise<RawForecast[]> {
  const results = await Promise.allSettled(MODELS.map((m) => fetchModel(lat, lon, date, m)));

  return results.map((r, i) => {
    const def = MODELS[i] as ModelDef;
    if (r.status === 'fulfilled') return r.value;
    console.warn(
      `  [warn] ${def.id} failed: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`,
    );
    return {
      model: def.id,
      date,
      tempMax: null,
      tempMin: null,
      tempMean: null,
      error: String(r.reason),
    } satisfies RawForecast;
  });
}
