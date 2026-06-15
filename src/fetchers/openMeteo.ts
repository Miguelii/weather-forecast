import { Effect } from 'effect';
import type { DayConditions, ModelDef, ModelId, RawEnsembleForecast, RawForecast } from '#types.js';
import { ActualsFetchError, ConditionsFetchError, FetchError } from '#types/errors.js';
import {
  ARCHIVE_URL,
  CONDITIONS_MODEL,
  ENSEMBLE_URL,
  FORECAST_URL,
  MIDDAY_END_HOUR,
  MIDDAY_START_HOUR,
  MODELS,
} from '#utils/constants.js';

interface OpenMeteoResponse {
  hourly?: { temperature_2m?: (number | null)[] };
  daily?: { temperature_2m_max?: (number | null)[]; temperature_2m_min?: (number | null)[] };
}

/** Ensemble API hourly block: `time` plus one `temperature_2m_memberNN` array per perturbed member. */
interface EnsembleResponse {
  hourly?: Record<string, (number | null)[] | string[] | undefined>;
}

/** Conditions response: daily aggregates plus hourly cloud cover and CAPE for the midday window. */
interface ConditionsResponse {
  hourly?: { time?: string[]; cloud_cover?: (number | null)[]; cape?: (number | null)[] };
  daily?: {
    precipitation_probability_max?: (number | null)[];
    precipitation_sum?: (number | null)[];
    shortwave_radiation_sum?: (number | null)[];
    wind_speed_10m_max?: (number | null)[];
  };
}

/** Derives the daily max from hourly values, ignoring nulls. Returns null if no values. */
function dailyMaxFromHourly(values: (number | null)[]): number | null {
  const nums = values.filter((v): v is number => v !== null);
  if (!nums.length) return null;
  return Math.round(nums.reduce((a, b) => Math.max(a, b), -Infinity) * 10) / 10;
}

/**
 * Fetches a daily max/min temperature forecast for a single NWP model from the Open-Meteo API.
 *
 * Falls back to deriving max/min from hourly data when the daily aggregation endpoint returns
 * null values (e.g. AIFS). Fails with a descriptive {@link FetchError} if no temperature data
 * is available after the fallback, ensuring warnings are always visible in the CLI output.
 *
 * @param lat - Latitude of the target location.
 * @param lon - Longitude of the target location.
 * @param date - Target date in `YYYY-MM-DD` format.
 * @param modelDef - Model definition containing the Open-Meteo API parameter name.
 * @returns A {@link RawForecast} with `tempMax`, `tempMin`, and `tempMean` for the requested date.
 * @throws FetchError if the request fails, times out, or returns no usable temperature data.
 */
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

/**
 * Fetches forecasts from all configured NWP models in parallel.
 *
 * Uses `Effect.either` so that one failing model never blocks the others — failed models
 * are returned as {@link RawForecast} entries with `error` set and all temperature fields null.
 * A warning is printed to stderr for each failure.
 *
 * @param lat - Latitude of the target location.
 * @param lon - Longitude of the target location.
 * @param date - Target date in `YYYY-MM-DD` format.
 * @returns Array of {@link RawForecast} objects, one per model in {@link MODELS} order.
 */
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

/**
 * Fetches the per-member daily-max forecasts for a single model from the Open-Meteo ensemble API.
 *
 * The ensemble API only exposes hourly data, so the daily max is derived per member from that
 * member's hourly series for the target date. Each `temperature_2m_memberNN` column (and the
 * unsuffixed control run, if present) becomes one member.
 *
 * @param lat - Latitude of the target location.
 * @param lon - Longitude of the target location.
 * @param date - Target date in `YYYY-MM-DD` format.
 * @param modelDef - Model definition containing the Open-Meteo API parameter name.
 * @returns A {@link RawEnsembleForecast} with one derived daily max per member.
 * @throws FetchError if the request fails, times out, or returns no member data.
 */
export const fetchEnsembleModel = Effect.fn('fetchEnsembleModel')(function* (
  lat: number,
  lon: number,
  date: string,
  modelDef: ModelDef,
) {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    hourly: 'temperature_2m',
    models: modelDef.param,
    start_date: date,
    end_date: date,
    timezone: 'auto',
  });

  const res = yield* Effect.tryPromise({
    try: (signal) => fetch(`${ENSEMBLE_URL}?${params}`, { signal }),
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
    return yield* new FetchError({ model: modelDef.id, cause: `Ensemble API HTTP ${res.status}` });
  }

  const data = yield* Effect.tryPromise({
    try: () => res.json() as Promise<EnsembleResponse>,
    catch: (err) => new FetchError({ model: modelDef.id, cause: String(err) }),
  });

  const hourly = data.hourly ?? {};
  const memberMaxes = Object.keys(hourly)
    // Member columns are `temperature_2m_memberNN`; the bare `temperature_2m` is the control run.
    .filter((key) => /^temperature_2m(_member\d+)?$/.test(key))
    .map((key) => dailyMaxFromHourly((hourly[key] ?? []) as (number | null)[]))
    .filter((v): v is number => v !== null);

  if (!memberMaxes.length) {
    return yield* new FetchError({
      model: modelDef.id,
      cause: 'no ensemble member data — upstream data gap',
    });
  }

  return { model: modelDef.id as ModelId, date, memberMaxes } satisfies RawEnsembleForecast;
});

/**
 * Fetches per-member forecasts from all configured models in parallel via the ensemble API.
 *
 * Like {@link fetchAllModels}, one failing model never blocks the others — failures come back as
 * entries with `error` set and an empty `memberMaxes`, and a warning is printed to stderr.
 *
 * @param lat - Latitude of the target location.
 * @param lon - Longitude of the target location.
 * @param date - Target date in `YYYY-MM-DD` format.
 * @returns Array of {@link RawEnsembleForecast}, one per model in {@link MODELS} order.
 */
export const fetchAllEnsembleModels = Effect.fn('fetchAllEnsembleModels')(function* (
  lat: number,
  lon: number,
  date: string,
) {
  const results = yield* Effect.forEach(
    MODELS,
    (m) => Effect.either(fetchEnsembleModel(lat, lon, date, m)),
    { concurrency: 'unbounded' },
  );

  return results.map((r, i): RawEnsembleForecast => {
    const def = MODELS[i] as ModelDef;

    if (r._tag === 'Right') return r.right;

    console.warn(`  [warn] ${def.id} ensemble failed: ${r.left.cause}`);

    return { model: def.id, date, memberMaxes: [], error: r.left.cause };
  });
});

/** Returns the first daily value as a number, or null. */
function firstDaily(arr: (number | null)[] | undefined): number | null {
  return arr?.[0] ?? null;
}

/**
 * Fetches and summarises the day's atmospheric conditions from a single Open-Meteo call (C1).
 *
 * Pulls daily precipitation/radiation/wind aggregates plus hourly cloud cover and CAPE, then
 * reduces the hourly series to the local midday window ({@link MIDDAY_START_HOUR}–
 * {@link MIDDAY_END_HOUR}) where the daily max usually occurs. Used to detect storm/heat-wave
 * regimes. Every field is nullable so a partial upstream response never breaks the forecast.
 *
 * @param lat - Latitude of the target location.
 * @param lon - Longitude of the target location.
 * @param date - Target date in `YYYY-MM-DD` format.
 * @returns The summarised {@link DayConditions} for the date.
 * @throws ConditionsFetchError if the request fails or times out.
 */
export const fetchConditions = Effect.fn('fetchConditions')(function* (
  lat: number,
  lon: number,
  date: string,
) {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    hourly: 'cloud_cover,cape',
    daily:
      'precipitation_probability_max,precipitation_sum,shortwave_radiation_sum,wind_speed_10m_max',
    models: CONDITIONS_MODEL,
    start_date: date,
    end_date: date,
    timezone: 'auto',
  });

  const res = yield* Effect.tryPromise({
    try: (signal) => fetch(`${FORECAST_URL}?${params}`, { signal }),
    catch: (err) =>
      new ConditionsFetchError({ cause: err instanceof Error ? err.message : String(err) }),
  }).pipe(
    Effect.timeout('10 seconds'),
    Effect.catchTag('TimeoutException', () =>
      Effect.fail(new ConditionsFetchError({ cause: 'Conditions request timed out' })),
    ),
  );

  if (!res.ok) {
    return yield* new ConditionsFetchError({ cause: `Conditions API HTTP ${res.status}` });
  }

  const data = yield* Effect.tryPromise({
    try: () => res.json() as Promise<ConditionsResponse>,
    catch: (err) => new ConditionsFetchError({ cause: String(err) }),
  });

  const times = data.hourly?.time ?? [];
  // Indices whose local hour falls inside the midday window.
  const midday = times
    .map((t, i) => ({ hour: Number.parseInt(t.slice(11, 13), 10), i }))
    .filter(({ hour }) => hour >= MIDDAY_START_HOUR && hour <= MIDDAY_END_HOUR)
    .map(({ i }) => i);

  const pick = (arr: (number | null)[] | undefined): number[] =>
    midday.map((i) => arr?.[i]).filter((v): v is number => v !== null && v !== undefined);

  const capeWindow = pick(data.hourly?.cape);
  const cloudWindow = pick(data.hourly?.cloud_cover);

  return {
    date,
    capeMaxMidday: capeWindow.length
      ? Math.round(capeWindow.reduce((a, b) => Math.max(a, b), -Infinity))
      : null,
    cloudCoverMeanMidday: cloudWindow.length
      ? Math.round(cloudWindow.reduce((a, b) => a + b, 0) / cloudWindow.length)
      : null,
    precipProbabilityMax: firstDaily(data.daily?.precipitation_probability_max),
    precipSum: firstDaily(data.daily?.precipitation_sum),
    shortwaveRadiationSum: firstDaily(data.daily?.shortwave_radiation_sum),
    windSpeedMax: firstDaily(data.daily?.wind_speed_10m_max),
  } satisfies DayConditions;
});

/**
 * Fetches the observed daily max temperature for a past date (B2).
 *
 * Tries the ERA5 archive (reanalysis) first; if it has no value yet (the archive lags a few
 * days), falls back to the forecast endpoint, which still serves recent past days. The result is
 * the ground truth written back into the forecast log to drive `bias compute`.
 *
 * @param lat - Latitude of the target location.
 * @param lon - Longitude of the target location.
 * @param date - Target date in `YYYY-MM-DD` format.
 * @returns The observed daily max in °C.
 * @throws ActualsFetchError if neither source returns a value.
 */
export const fetchObservedMax = Effect.fn('fetchObservedMax')(function* (
  lat: number,
  lon: number,
  date: string,
) {
  const base = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    daily: 'temperature_2m_max',
    start_date: date,
    end_date: date,
    timezone: 'auto',
  });

  const fetchMax = (url: string): Effect.Effect<number | null, ActualsFetchError> =>
    Effect.gen(function* () {
      const res = yield* Effect.tryPromise({
        try: (signal) => fetch(url, { signal }),
        catch: (err) =>
          new ActualsFetchError({ cause: err instanceof Error ? err.message : String(err) }),
      }).pipe(
        Effect.timeout('10 seconds'),
        Effect.catchTag('TimeoutException', () =>
          Effect.fail(new ActualsFetchError({ cause: 'Actuals request timed out' })),
        ),
      );

      if (!res.ok) return yield* new ActualsFetchError({ cause: `Actuals API HTTP ${res.status}` });

      const data = yield* Effect.tryPromise({
        try: () => res.json() as Promise<OpenMeteoResponse>,
        catch: (err) => new ActualsFetchError({ cause: String(err) }),
      });

      return firstDaily(data.daily?.temperature_2m_max);
    });

  const fromArchive = yield* fetchMax(`${ARCHIVE_URL}?${base}`);
  if (fromArchive !== null) return Math.round(fromArchive * 10) / 10;

  const fromForecast = yield* fetchMax(`${FORECAST_URL}?${base}&models=${CONDITIONS_MODEL}`);
  if (fromForecast !== null) return Math.round(fromForecast * 10) / 10;

  return yield* new ActualsFetchError({
    cause: `No observed temperature available for ${date} (archive + forecast both empty).`,
  });
});
