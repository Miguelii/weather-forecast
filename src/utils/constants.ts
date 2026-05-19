import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ModelDef } from '#types.js';

// ─── HTTP ─────────────────────────────────────────────────────────────────────
export const FETCH_TIMEOUT_MS = 10_000;
export const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
export const GEO_URL = 'https://geocoding-api.open-meteo.com/v1/search';

// ─── Models ───────────────────────────────────────────────────────────────────
export const MODELS: ModelDef[] = [
  { id: 'ifs', param: 'ecmwf_ifs025' },
  /* { id: 'aifs', param: 'ecmwf_aifs025' }, */
  { id: 'gfs', param: 'gfs_seamless' },
  { id: 'icon', param: 'icon_seamless' },
  { id: 'gem', param: 'gem_global' },
];

// ─── Storage ──────────────────────────────────────────────────────────────────
const currentDir = dirname(fileURLToPath(import.meta.url));
export const BIAS_PATH = resolve(currentDir, '../../data/bias.json');

// ─── Validation ───────────────────────────────────────────────────────────────
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const MAX_FORECAST_DAYS = 15;
