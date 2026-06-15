import { readFile, writeFile } from 'node:fs/promises';
import { Effect } from 'effect';
import type { CalibrationStore, CityClimatology, ClimatologyStore } from '#types.js';
import { CalibrationError, ClimatologyError } from '#types/errors.js';
import { CALIBRATION_PATH, CLIMATOLOGY_PATH, DEFAULT_EMPIRICAL_RMSE } from '#utils/constants.js';

/**
 * Reads the per-city empirical-RMSE calibration store from disk (A2).
 *
 * A missing file is a valid initial state (returns `{}`), so the model still runs on the default
 * floor before any `bias compute` has happened.
 *
 * @returns The full {@link CalibrationStore}, or `{}` if no file exists yet.
 * @throws CalibrationError if the file exists but cannot be parsed.
 */
export const loadCalibration = Effect.fn('loadCalibration')(function* () {
  const result = yield* Effect.either(
    Effect.tryPromise({
      try: () => readFile(CALIBRATION_PATH, 'utf8'),
      catch: (err) => new CalibrationError({ cause: String(err) }),
    }),
  );

  if (result._tag === 'Left') return {} as CalibrationStore;

  return yield* Effect.try({
    try: () => JSON.parse(result.right) as CalibrationStore,
    catch: (err) =>
      new CalibrationError({ cause: `Failed to parse calibration.json: ${String(err)}` }),
  });
});

/**
 * Serialises and writes the full calibration store to disk (used by `bias compute`).
 *
 * @param data - The calibration store to persist.
 * @throws CalibrationError if the file cannot be written.
 */
export const saveCalibration = (data: CalibrationStore): Effect.Effect<void, CalibrationError> =>
  Effect.tryPromise({
    try: () => writeFile(CALIBRATION_PATH, `${JSON.stringify(data, null, 2)}\n`),
    catch: (err) => new CalibrationError({ cause: String(err) }),
  });

/**
 * Looks up the empirical RMSE (σ floor) for a city, falling back to {@link DEFAULT_EMPIRICAL_RMSE}.
 *
 * @param store - In-memory calibration store.
 * @param city - Resolved city name (case-sensitive).
 * @returns The stored empirical RMSE in °C, or the default if none is set.
 */
export function getEmpiricalRmse(store: CalibrationStore, city: string): number {
  return store[city] ?? DEFAULT_EMPIRICAL_RMSE;
}

/**
 * Reads the per-city climate-normals store from disk (C2).
 *
 * A missing file is a valid initial state (returns `{}`); heat-wave detection then simply never
 * triggers until a climatology is provided.
 *
 * @returns The full {@link ClimatologyStore}, or `{}` if no file exists yet.
 * @throws ClimatologyError if the file exists but cannot be parsed.
 */
export const loadClimatology = Effect.fn('loadClimatology')(function* () {
  const result = yield* Effect.either(
    Effect.tryPromise({
      try: () => readFile(CLIMATOLOGY_PATH, 'utf8'),
      catch: (err) => new ClimatologyError({ cause: String(err) }),
    }),
  );

  if (result._tag === 'Left') return {} as ClimatologyStore;

  return yield* Effect.try({
    try: () => JSON.parse(result.right) as ClimatologyStore,
    catch: (err) =>
      new ClimatologyError({ cause: `Failed to parse climatology.json: ${String(err)}` }),
  });
});

/**
 * Looks up the climate normals for a city.
 *
 * @param store - In-memory climatology store.
 * @param city - Resolved city name (case-sensitive).
 * @returns The {@link CityClimatology}, or `null` if none is stored for the city.
 */
export function getCityClimatology(store: ClimatologyStore, city: string): CityClimatology | null {
  return store[city] ?? null;
}
