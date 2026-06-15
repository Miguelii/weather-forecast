import { readFile, writeFile } from 'node:fs/promises';
import { Effect } from 'effect';
import type { BiasStore, ModelId } from '#types.js';
import { BiasStoreError } from '#types/errors.js';
import { BIAS_PATH } from '#utils/constants.js';

/**
 * Reads the bias store from disk.
 *
 * Returns an empty store if the file is missing or unreadable — a missing file
 * is a valid initial state, not an error.
 *
 * @returns The full {@link BiasStore} object, or `{}` if no file exists yet.
 * @throws BiasStoreError if the file exists but cannot be parsed as valid JSON.
 */
export const loadBias = Effect.fn('loadBias')(function* () {
  const result = yield* Effect.either(
    Effect.tryPromise({
      try: () => readFile(BIAS_PATH, 'utf8'),
      catch: (err) => new BiasStoreError({ cause: String(err) }),
    }),
  );

  // File missing or unreadable → start with an empty store
  if (result._tag === 'Left') return {} as BiasStore;

  return yield* Effect.try({
    try: () => JSON.parse(result.right) as BiasStore,
    catch: (err) => new BiasStoreError({ cause: `Failed to parse bias.json: ${String(err)}` }),
  });
});

/**
 * Serialises and writes the full bias store to disk.
 *
 * @param data - The complete bias store to persist.
 * @throws BiasStoreError if the file cannot be written.
 */
export const saveBias = (data: BiasStore): Effect.Effect<void, BiasStoreError> =>
  Effect.tryPromise({
    try: () => writeFile(BIAS_PATH, `${JSON.stringify(data, null, 2)}\n`),
    catch: (err) => new BiasStoreError({ cause: String(err) }),
  });

/**
 * Looks up the stored bias correction for a specific city/model pair.
 *
 * @param store - In-memory bias store.
 * @param city - Resolved city name (case-sensitive).
 * @param model - NWP model identifier.
 * @returns The stored bias in °C, or `0` if no correction has been set for this pair.
 */
export function getBiasValue(store: BiasStore, city: string, model: ModelId): number {
  return store[city]?.[model] ?? 0;
}

/**
 * Persists a bias correction for a city/model pair to disk.
 *
 * Reads the current store, upserts the value, and writes it back.
 *
 * @param city - Resolved city name (case-sensitive; must match the geocoding API output).
 * @param model - NWP model identifier.
 * @param value - Bias in °C (subtracted from raw forecast; positive = model runs warm).
 * @throws BiasStoreError if the store cannot be read or written.
 */
export const setBias = Effect.fn('setBias')(function* (
  city: string,
  model: ModelId,
  value: number,
) {
  const data = yield* loadBias();
  if (!data[city]) data[city] = {};
  data[city][model] = value;
  yield* saveBias(data);
});
