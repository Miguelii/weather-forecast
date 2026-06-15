export interface Location {
  lat: number;
  lon: number;
  name: string;
  country: string;
}

export type ModelId = 'ifs' | 'gfs' | 'icon' | 'gem';

export interface ModelDef {
  id: ModelId;
  param: string;
}

export interface RawForecast {
  model: ModelId;
  date: string;
  tempMax: number | null;
  tempMin: number | null;
  tempMean: number | null;
  error?: string;
}

export interface CorrectedForecast extends RawForecast {
  bias: number;
  rawTempMax: number | null;
  rawTempMin: number | null;
  rawTempMean: number | null;
}

/**
 * Raw per-member daily-max forecasts from a single NWP ensemble model (Open-Meteo ensemble API).
 * Each model exposes a different member count (IFS≈51, GFS≈31, ICON≈40, GEM≈21).
 */
export interface RawEnsembleForecast {
  model: ModelId;
  date: string;
  /** One derived daily max per perturbed member; empty when the model failed. */
  memberMaxes: number[];
  error?: string;
}

/**
 * Atmospheric conditions for a target day, summarised from a single auxiliary Open-Meteo call.
 * Drives regime detection (storm/heat-wave). All fields are nullable — detection is null-safe.
 */
export interface DayConditions {
  date: string;
  /** Peak CAPE (J/kg) in the local midday window — thunderstorm potential. */
  capeMaxMidday: number | null;
  /** Mean cloud cover (%) in the local midday window. */
  cloudCoverMeanMidday: number | null;
  precipProbabilityMax: number | null;
  precipSum: number | null;
  shortwaveRadiationSum: number | null;
  windSpeedMax: number | null;
}

export type RegimeKind = 'storm' | 'heatwave' | 'normal';

/**
 * Outcome of regime detection: how the voting system should adjust the distribution and why.
 */
export interface RegimeAssessment {
  kind: RegimeKind;
  /** Multiplier applied to the ensemble spread (σ). */
  sigmaMultiplier: number;
  /** Shift (°C) added to the ensemble mean. */
  meanShift: number;
  /** Human-readable explanation recorded in the snapshot. */
  reason: string;
}

export interface Percentiles {
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
}

export interface ProbabilityResult {
  threshold: number;
  probAbove: number;
}

export interface EnsembleResult {
  // Max temperature ensemble — basis for percentiles and probabilities.
  maxMean: number;
  maxSpread: number;
  maxPercentiles: Percentiles;
  // Reference value.
  minMean: number | null;
  // Probabilities: P(max temp > threshold).
  probabilities: ProbabilityResult[];
  modelVotes: CorrectedForecast[];
  modelsUsed: number;
  modelsFailed: number;
  // Detected regime (storm/heat-wave/normal) and how it adjusted the distribution.
  regime: RegimeAssessment;
  // Number of perturbed members pooled (0 when the deterministic normal-fit path was used).
  membersUsed: number;
}

export type BiasStore = Record<string, Partial<Record<ModelId, number>>>;

/** Per-city empirical RMSE (°C) — the spread floor applied in the voting system (A2). */
export type CalibrationStore = Record<string, number>;

/** Per-city monthly climate normals for the daily max, used to detect heat-wave regimes. */
export interface CityClimatology {
  /** Mean daily max (°C) per calendar month, index 0 = January (length 12). */
  monthlyMaxMean: number[];
  /** Representative daily-max standard deviation (°C) for the city. */
  maxStd: number;
}

export type ClimatologyStore = Record<string, CityClimatology>;

/**
 * One structured forecast record (B1), persisted to {@link FORECAST_LOG_PATH} as JSONL.
 * `observed` is filled later by the `record-actuals` command (B2), closing the loop that
 * feeds `bias compute` (B3) and the empirical σ-floor (A2).
 */
export interface ForecastLogEntry {
  date: string;
  city: string;
  runAt: string;
  /** Raw daily max per model that contributed (failed models omitted). */
  rawByModel: Partial<Record<ModelId, number>>;
  /** Bias applied per model on this run. */
  biasByModel: Partial<Record<ModelId, number>>;
  ensembleMean: number;
  sigmaUsed: number;
  modelsUsed: number;
  membersUsed: number;
  regime: RegimeKind;
  /** Observed daily max (°C), or null until recorded. */
  observed: number | null;
}

/** Options for a single city/date forecast run, used by the `forecast-all` command. */
export interface ForecastRunOptions {
  city: string;
  date: string;
}

// ─── Polymarket Gamma API ─────────────────────────────────────────────────────

export interface PolymarketMarket {
  groupItemTitle: string;
  outcomePrices: string; // JSON-encoded string: "[\"0.43\", \"0.57\"]" — YES, NO in 0–1 format
}

export interface PolymarketEvent {
  slug: string;
  title: string;
  endDate: string;
  markets: PolymarketMarket[];
}
