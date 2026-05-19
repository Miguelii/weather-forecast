import { Effect } from 'effect';
import type { ModelDef, ModelId, RawForecast } from '#types.js';
import { FetchError } from '#types.js';
import { FORECAST_URL, MODELS } from '#utils/constants.js';

interface OpenMeteoResponse {
  hourly?: { temperature_2m?: (number | null)[] };
  daily?: { temperature_2m_max?: (number | null)[]; temperature_2m_min?: (number | null)[] };
}

export const fetchModel = Effect.fn('fetchModel')(function* (
  lat: number,
  lon: number,
  date: string,
  modelDef: ModelDef,
) {
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

  const res = yield* Effect.tryPromise({
    try: (signal) => fetch(`${FORECAST_URL}?${params}`, { signal }),
    catch: (err) =>
      new FetchError({
        model: modelDef.id,
        cause: err instanceof Error ? err.message : String(err),
      }),
  }).pipe(
    Effect.timeout('10 seconds'),
    Effect.catchTag('TimeoutException', () =>
      Effect.fail(new FetchError({ model: modelDef.id, cause: 'Request timed out' })),
    ),
  );

  if (!res.ok) {
    const text = yield* Effect.tryPromise({
      try: () => res.text(),
      catch: () => new FetchError({ model: modelDef.id, cause: `HTTP ${res.status}` }),
    });
    return yield* new FetchError({
      model: modelDef.id,
      cause: `Open-Meteo ${res.status}: ${text}`,
    });
  }

  const data = yield* Effect.tryPromise({
    try: () => res.json() as Promise<OpenMeteoResponse>,
    catch: (err) => new FetchError({ model: modelDef.id, cause: String(err) }),
  });

  const hourly = (data.hourly?.temperature_2m ?? []).filter((v): v is number => v !== null);

  let tempMax = data.daily?.temperature_2m_max?.[0] ?? null;
  let tempMin = data.daily?.temperature_2m_min?.[0] ?? null;

  // fallback: derive max/min from hourly when daily aggregation isn't supported (e.g. AIFS)
  // Use reduce instead of spread to avoid call stack overflow on large arrays
  if ((tempMax === null || tempMin === null) && hourly.length) {
    tempMax = Math.round(hourly.reduce((a, b) => Math.max(a, b), -Infinity) * 10) / 10;
    tempMin = Math.round(hourly.reduce((a, b) => Math.min(a, b), Infinity) * 10) / 10;
  }

  // No data at all after fallback — treat as a model failure so the warning
  // machinery in fetchAllModels logs the reason instead of silently showing n/a.
  if (tempMax === null) {
    const hourlyCount = (data.hourly?.temperature_2m ?? []).length;
    const rawDailyMax = data.daily?.temperature_2m_max?.[0] ?? null;
    return yield* new FetchError({
      model: modelDef.id,
      cause: `no temperature data (daily_max=${rawDailyMax}, hourly_values=${hourlyCount}) — upstream data gap`,
    });
  }

  const tempMean =
    tempMax !== null && tempMin !== null ? Math.round(((tempMax + tempMin) / 2) * 10) / 10 : null;

  return {
    model: modelDef.id as ModelId,
    date,
    tempMax,
    tempMin,
    tempMean,
  } satisfies RawForecast;
});

export const fetchAllModels = Effect.fn('fetchAllModels')(function* (
  lat: number,
  lon: number,
  date: string,
) {
  const results = yield* Effect.forEach(
    MODELS,
    (m) => Effect.either(fetchModel(lat, lon, date, m)),
    { concurrency: 'unbounded' },
  );

  return results.map((r, i) => {
    const def = MODELS[i] as ModelDef;

    if (r._tag === 'Right') return r.right;

    console.warn(`  [warn] ${def.id} failed: ${r.left.cause}`);

    return {
      model: def.id,
      date,
      tempMax: null,
      tempMin: null,
      tempMean: null,
      error: r.left.cause,
    } satisfies RawForecast;
  });
});
