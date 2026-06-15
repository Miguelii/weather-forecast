import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ModelDef } from '#types.js';

// ─── HTTP ─────────────────────────────────────────────────────────────────────
export const FETCH_TIMEOUT_MS = 10_000;
export const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
export const GEO_URL = 'https://geocoding-api.open-meteo.com/v1/search';
// Per-member (perturbed) forecasts — the proper source of predictive spread.
export const ENSEMBLE_URL = 'https://ensemble-api.open-meteo.com/v1/ensemble';
// ERA5 reanalysis — used to record the observed daily max for past dates (B2).
export const ARCHIVE_URL = 'https://archive-api.open-meteo.com/v1/archive';

// ─── Models ───────────────────────────────────────────────────────────────────
export const MODELS: ModelDef[] = [
  { id: 'ifs', param: 'ecmwf_ifs025' },
  /* { id: 'aifs', param: 'ecmwf_aifs025' }, */
  { id: 'gfs', param: 'gfs_seamless' },
  { id: 'icon', param: 'icon_seamless' },
  { id: 'gem', param: 'gem_global' },
];
// Total configured models — used to detect when a run is missing models (and inflate σ).
export const TOTAL_MODELS = MODELS.length;
// Open-Meteo model used for the single auxiliary atmospheric-conditions call (C1).
export const CONDITIONS_MODEL = 'best_match';

// ─── Storage ──────────────────────────────────────────────────────────────────
const currentDir = dirname(fileURLToPath(import.meta.url));
// The bias store lives next to the bias logic in src/bias/. Compiled code runs from dist/, so we
// step up out of dist/utils (../../) to the repo root, then into src/bias/ (also correct when run
// directly from src/utils).
export const BIAS_PATH = resolve(currentDir, '../../src/bias/bias.json');
// Per-city empirical RMSE (°C) — the floor applied to the ensemble spread so probabilities
// reflect realized error, not just inter-model agreement (A2). Recomputed by `bias compute`.
export const CALIBRATION_PATH = resolve(currentDir, '../../src/bias/calibration.json');
// Per-city monthly daily-max climate normals — used to flag heat-wave regimes (C2).
export const CLIMATOLOGY_PATH = resolve(currentDir, '../../src/bias/climatology.json');
// Structured forecast+outcome log (one JSON object per line) — the training signal for the
// automated bias/calibration loop (B1/B2/B3). Lives next to the human-readable predicts/.
export const FORECAST_LOG_PATH = resolve(currentDir, '../../data/forecasts.jsonl');

// ─── Validation ───────────────────────────────────────────────────────────────
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const MAX_FORECAST_DAYS = 15;

// ─── Calibration ──────────────────────────────────────────────────────────────
// Fallback empirical RMSE (°C) when a city has no stored calibration yet — roughly the
// realized RMSE measured across the early snapshots.
export const DEFAULT_EMPIRICAL_RMSE = 1.4;
// When fewer than TOTAL_MODELS contribute (e.g. GEM data gap), inflate σ instead of letting
// it shrink — a missing model means MORE uncertainty, not less.
export const MISSING_MODEL_SIGMA_INFLATION = 1.3;
// Minimum pooled ensemble members required to use the empirical (member-based) distribution;
// below this we fall back to the normal-fit path over the deterministic model maxes.
export const MIN_ENSEMBLE_MEMBERS = 20;
// Trailing window (days) used by `bias compute` to average raw−observed per city/model.
export const DEFAULT_BIAS_WINDOW_DAYS = 21;

// ─── Atmospheric conditions & regimes (C) ─────────────────────────────────────
// Local-time window (inclusive hours) over which the daily max typically occurs; conditions
// are summarised here (peak CAPE, mean cloud cover) to judge convective suppression.
export const MIDDAY_START_HOUR = 11;
export const MIDDAY_END_HOUR = 16;
// Storm/convection signal thresholds. CAPE indexes thunderstorm potential (J/kg).
export const STORM_CAPE_THRESHOLD = 1000;
export const STORM_PRECIP_PROB_THRESHOLD = 50;
export const STORM_CLOUD_THRESHOLD = 60;
// Storm regime: widen the spread and nudge the mean down (cloud/rain caps the afternoon max).
export const STORM_SIGMA_MULTIPLIER = 1.75;
export const STORM_MEAN_SHIFT = -0.5;
// Heat-wave regime: a forecast max this many σ above the monthly normal flags blocking-ridge
// conditions, where model error structure changes; widen the (upper) tail.
export const HEATWAVE_ANOMALY_SIGMA = 1.28;
export const HEATWAVE_SIGMA_MULTIPLIER = 1.4;

// ─── Polymarket ───────────────────────────────────────────────────────────────
export const POLYMARKET_GAMMA_URL = 'https://gamma-api.polymarket.com';
export const POLYMARKET_EVENT_URL = 'https://polymarket.com/event';

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
// Daily forecast snapshots are written here, one Markdown file per date.
export const PREDICTS_DIR = resolve(currentDir, '../../predicts');
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
