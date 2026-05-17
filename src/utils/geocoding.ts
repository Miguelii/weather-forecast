import type { Location } from '../types.js';
import { GEO_URL, FETCH_TIMEOUT_MS } from './constants.js';

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
 * Includes a timeout of {@link FETCH_TIMEOUT_MS}ms — if the API does not respond
 * within that time, an error is thrown.
 *
 * @param cityName - City name as free text (e.g. `"London"`, `"Lisbon"`).
 * @returns A {@link Location} object containing `lat`, `lon`, `name` and `country`.
 *
 * @throws {Error} If the city is not found in the Open-Meteo database.
 * @throws {Error} If the HTTP request fails or exceeds the timeout.
 *
 * @example
 * const loc = await resolveCity('Lisbon');
 * // { lat: 38.72509, lon: -9.1498, name: 'Lisbon', country: 'Portugal' }
 */
export async function resolveCity(cityName: string): Promise<Location> {
  const url = `${GEO_URL}?name=${encodeURIComponent(cityName)}&count=1&language=en&format=json`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(url, { signal: controller.signal });
  } catch (err) {
    throw new Error(
      `Geocoding request timed out or failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) throw new Error(`Geocoding request failed: ${res.status}`);
  const data = (await res.json()) as GeoResponse;
  if (!data.results?.length) throw new Error(`City not found: "${cityName}"`);
  const { latitude, longitude, name, country } = data.results[0] as GeoResult;
  return {
    lat: latitude,
    lon: longitude,
    name,
    country,
  };
}
