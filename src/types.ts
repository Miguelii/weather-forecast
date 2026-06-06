import { Data } from 'effect';

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
  // Max temperature ensemble — base para percentis e probabilidades
  maxMean: number;
  maxSpread: number;
  maxPercentiles: Percentiles;
  // Referência
  minMean: number | null;
  // Probabilidades: P(temp máx > threshold)
  probabilities: ProbabilityResult[];
  modelVotes: CorrectedForecast[];
  modelsUsed: number;
  modelsFailed: number;
}

export type BiasStore = Record<string, Partial<Record<ModelId, number>>>;

export interface PolymarketLine {
  threshold: number;
  /** Semantics of this market bucket. */
  kind: 'below' | 'exact' | 'above';
  yesProb: number;
  noProb: number;
}

export interface BetRecommendation {
  threshold: number;
  modelProb: number;
  marketYesProb: number;
  edge: number;
  signal: 'YES' | 'NO' | 'SKIP';
}

/** Options for a single city/date forecast run, shared by the `forecast` and `forecast-all` commands. */
export interface ForecastRunOptions {
  city: string;
  date: string;
  threshold?: string;
  polymarket?: string;
}

// ─── Typed errors ─────────────────────────────────────────────────────────────

export class GeocodingError extends Data.TaggedError('GeocodingError')<{ cause: string }> {
  get message(): string {
    return this.cause;
  }
}

export class FetchError extends Data.TaggedError('FetchError')<{
  model: ModelId;
  cause: string;
}> {
  get message(): string {
    return `[${this.model}] ${this.cause}`;
  }
}

export class BiasStoreError extends Data.TaggedError('BiasStoreError')<{ cause: string }> {
  get message(): string {
    return this.cause;
  }
}

export class EnsembleError extends Data.TaggedError('EnsembleError')<{ cause: string }> {
  get message(): string {
    return this.cause;
  }
}

export class PolymarketParseError extends Data.TaggedError('PolymarketParseError')<{
  cause: string;
}> {
  get message(): string {
    return this.cause;
  }
}

export class PolymarketFetchError extends Data.TaggedError('PolymarketFetchError')<{
  cause: string;
}> {
  get message(): string {
    return this.cause;
  }
}

export class SnapshotWriteError extends Data.TaggedError('SnapshotWriteError')<{ cause: string }> {
  get message(): string {
    return this.cause;
  }
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
