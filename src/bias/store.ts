import { readFile, writeFile } from 'node:fs/promises';
import { Effect } from 'effect';
import type { BiasStore, ModelId } from '../types.js';
import { BiasStoreError } from '../types.js';
import { BIAS_PATH } from '../utils/constants.js';

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

const saveBias = (data: BiasStore): Effect.Effect<void, BiasStoreError> =>
  Effect.tryPromise({
    try: () => writeFile(BIAS_PATH, JSON.stringify(data, null, 2)),
    catch: (err) => new BiasStoreError({ cause: String(err) }),
  });

export function getBiasValue(store: BiasStore, city: string, model: ModelId): number {
  return store[city]?.[model] ?? 0;
}

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
