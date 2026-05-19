import { Effect } from 'effect';
import type { Location } from '../types.js';
import { GeocodingError } from '../types.js';
import { GEO_URL } from './constants.js';

interface GeoResult {
  latitude: number;
  longitude: number;
  name: string;
  country: string;
}

interface GeoResponse {
  results?: GeoResult[];
}

/**
 * Resolves a city name to geographic coordinates (latitude/longitude)
 * using the Open-Meteo geocoding API.
 *
 * Always returns the first result from the search. For ambiguous city names
 * (e.g. "Springfield"), the most likely match according to Open-Meteo is returned.
 *
 * @param cityName - City name as free text (e.g. `"London"`, `"Lisbon"`).
 * @returns A {@link Location} object containing `lat`, `lon`, `name` and `country`.
 *
 * @example
 * const loc = yield* resolveCity('Lisbon');
 * // { lat: 38.72509, lon: -9.1498, name: 'Lisbon', country: 'Portugal' }
 */
export const resolveCity = Effect.fn('resolveCity')(function* (cityName: string) {
  const url = `${GEO_URL}?name=${encodeURIComponent(cityName)}&count=1&language=en&format=json`;

  const res = yield* Effect.tryPromise({
    try: (signal) => fetch(url, { signal }),
    catch: (err) => new GeocodingError({ cause: err instanceof Error ? err.message : String(err) }),
  }).pipe(
    Effect.timeout('10 seconds'),
    Effect.catchTag('TimeoutException', () =>
      Effect.fail(new GeocodingError({ cause: 'Geocoding request timed out' })),
    ),
  );

  if (!res.ok) {
    return yield* new GeocodingError({ cause: `Geocoding request failed: ${res.status}` });
  }

  const data = yield* Effect.tryPromise({
    try: () => res.json() as Promise<GeoResponse>,
    catch: (err) => new GeocodingError({ cause: String(err) }),
  });

  if (!data.results?.length) {
    return yield* new GeocodingError({ cause: `City not found: "${cityName}"` });
  }

  const { latitude, longitude, name, country } = data.results[0] as GeoResult;
  return { lat: latitude, lon: longitude, name, country } satisfies Location;
});
