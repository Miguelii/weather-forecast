import { readFile, writeFile } from 'node:fs/promises';
import type { BiasStore, ModelId } from '../types.js';
import { BIAS_PATH } from '../utils/constants.js';

export async function loadBias(): Promise<BiasStore> {
  try {
    const raw = await readFile(BIAS_PATH, 'utf8');
    return JSON.parse(raw) as BiasStore;
  } catch {
    return {};
  }
}

async function saveBias(data: BiasStore): Promise<void> {
  await writeFile(BIAS_PATH, JSON.stringify(data, null, 2));
}

export function getBiasValue(store: BiasStore, city: string, model: ModelId): number {
  return store[city]?.[model] ?? 0;
}

export async function setBias(city: string, model: ModelId, value: number): Promise<void> {
  const data = await loadBias();
  if (!data[city]) data[city] = {};
  data[city][model] = value;
  await saveBias(data);
}
