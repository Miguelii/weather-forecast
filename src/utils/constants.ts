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

// ─── Polymarket ───────────────────────────────────────────────────────────────
export const MIN_BET_EDGE_PERCENT = 5;
export const POLYMARKET_GAMMA_URL = 'https://gamma-api.polymarket.com';
export const POLYMARKET_EVENT_URL = 'https://polymarket.com/event';
export const PREDICTS_DIR = resolve(currentDir, '../../predicts');

// ─── Batch forecast ─────────────────────────────────────────────────────────────
// Default cities for the `forecast-all` command (overridable via --cities).
export const BATCH_CITIES = ['London', 'Paris', 'Beijing', 'Shenzhen', 'Singapore'] as const;
// Full month names — used to build the Polymarket event slug (e.g. "june").
// Distinct from MONTH_NAMES (abbreviated), which names the snapshot files.
export const MONTH_NAMES_FULL = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
] as const;

// ─── Snapshots ────────────────────────────────────────────────────────────────
export const DOCS_DIR = resolve(currentDir, '../../docs');
export const MONTH_NAMES = [
  'jan',
  'feb',
  'mar',
  'apr',
  'may',
  'jun',
  'jul',
  'aug',
  'sep',
  'oct',
  'nov',
  'dec',
] as const;
