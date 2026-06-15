import { Effect } from 'effect';
import type {
  CorrectedForecast,
  DayConditions,
  ForecastLogEntry,
  ForecastRunOptions,
  ModelId,
  RawForecast,
} from '#types.js';
import { resolveCity } from '#utils/geocoding.js';
import { fetchAllEnsembleModels, fetchAllModels, fetchConditions } from '#fetchers/openMeteo.js';
import { correctForecast } from '#bias/apply.js';
import { getBiasValue, loadBias } from '#bias/store.js';
import {
  getCityClimatology,
  getEmpiricalRmse,
  loadCalibration,
  loadClimatology,
} from '#bias/calibrationStore.js';
import { assessRegime } from '#voting/regime.js';
import { runVotingSystem } from '#voting/voting-system.js';
import { mean } from '#utils/stats.js';
import { MIN_ENSEMBLE_MEMBERS } from '#utils/constants.js';
import { printForecastOutput } from '#utils/display.js';
import { appendForecastSnapshot } from '#utils/snapshotWriter.js';
import { appendForecastLog } from '#utils/forecastLog.js';
import { buildPolymarketEventUrl, fetchPolymarketThresholds } from '#commands/polymarket.js';

const round1 = (v: number): number => Math.round(v * 10) / 10;

/** Builds a per-model display forecast from the mean of that model's ensemble members. */
function ensembleMemberMeanForecast(
  model: ModelId,
  date: string,
  memberMaxes: number[],
): RawForecast {
  return {
    model,
    date,
    tempMax: round1(mean(memberMaxes) as number),
    tempMin: null,
    tempMean: null,
  };
}

/** Builds the structured log entry (B1) recorded after every successful city forecast. */
function buildLogEntry(
  city: string,
  date: string,
  corrected: CorrectedForecast[],
  ensembleMean: number,
  sigmaUsed: number,
  modelsUsed: number,
  membersUsed: number,
  regime: ForecastLogEntry['regime'],
): ForecastLogEntry {
  const rawByModel: Partial<Record<ModelId, number>> = {};
  const biasByModel: Partial<Record<ModelId, number>> = {};
  for (const f of corrected) {
    if (f.rawTempMax !== null && !f.error) {
      rawByModel[f.model] = f.rawTempMax;
      biasByModel[f.model] = f.bias;
    }
  }

  return {
    date,
    city,
    runAt: new Date().toISOString(),
    rawByModel,
    biasByModel,
    ensembleMean,
    sigmaUsed,
    modelsUsed,
    membersUsed,
    regime,
    observed: null,
  };
}

/**
 * Runs a full ensemble forecast for a single city/date as a reusable Effect.
 *
 * Pipeline: resolve the city; load the bias, calibration, and climatology stores; fetch the
 * Polymarket buckets (thresholds); fetch per-member ensemble forecasts and the day's atmospheric
 * conditions; bias-correct every member and pool them; detect the regime (storm/heat-wave); run
 * the voting system with the per-city σ-floor and regime adjustment; print the report; and persist
 * both the Markdown snapshot and the structured log entry. Falls back to the deterministic models
 * if too few ensemble members are available.
 *
 * @param opts - City and date for the forecast run.
 * @returns An Effect that resolves once the forecast has been printed and persisted.
 */
export const runCityForecast = Effect.fn('runCityForecast')(function* (opts: ForecastRunOptions) {
  const [location, biasStore, calibrationStore, climatologyStore] = yield* Effect.all(
    [resolveCity(opts.city), loadBias(), loadCalibration(), loadClimatology()],
    { concurrency: 4 },
  );
  process.stdout.write(
    `\nLocation: ${location.name}, ${location.country} (${location.lat}, ${location.lon})\n`,
  );

  const polymarketUrl = buildPolymarketEventUrl(location.name, opts.date);

  process.stdout.write('Fetching Polymarket buckets, ensemble members, and conditions...\n');

  // Thresholds gate the city (a missing event fails it); conditions are best-effort.
  const [thresholds, ensembleRaw, conditionsEither] = yield* Effect.all(
    [
      fetchPolymarketThresholds(polymarketUrl),
      fetchAllEnsembleModels(location.lat, location.lon, opts.date),
      Effect.either(fetchConditions(location.lat, location.lon, opts.date)),
    ],
    { concurrency: 3 },
  );

  // Pool bias-corrected members across models; build the per-model display rows from member means.
  const ensembleCorrected: CorrectedForecast[] = [];
  const pooledMembers: number[] = [];
  for (const e of ensembleRaw) {
    if (e.error || !e.memberMaxes.length) {
      ensembleCorrected.push(
        correctForecast(
          {
            model: e.model,
            date: e.date,
            tempMax: null,
            tempMin: null,
            tempMean: null,
            error: e.error,
          },
          location.name,
          biasStore,
        ),
      );
    } else {
      ensembleCorrected.push(
        correctForecast(
          ensembleMemberMeanForecast(e.model, e.date, e.memberMaxes),
          location.name,
          biasStore,
        ),
      );
      const bias = getBiasValue(biasStore, location.name, e.model);
      for (const m of e.memberMaxes) pooledMembers.push(round1(m - bias));
    }
  }

  // Use the empirical (member) distribution when we have enough members; otherwise fall back to
  // the deterministic models.
  let corrected: CorrectedForecast[];
  let members: number[];
  if (pooledMembers.length >= MIN_ENSEMBLE_MEMBERS) {
    corrected = ensembleCorrected;
    members = pooledMembers;
  } else {
    process.stdout.write(
      '  [info] too few ensemble members — falling back to deterministic models\n',
    );
    const raw = yield* fetchAllModels(location.lat, location.lon, opts.date);
    corrected = raw.map((f) => correctForecast(f, location.name, biasStore));
    members = [];
  }

  const conditions: DayConditions | null =
    conditionsEither._tag === 'Right' ? conditionsEither.right : null;
  if (conditionsEither._tag === 'Left') {
    process.stdout.write(`  [warn] conditions unavailable: ${conditionsEither.left.cause}\n`);
  }

  // Preliminary corrected mean drives regime detection (anomaly vs climatology).
  const validMaxes = corrected
    .filter((f) => f.tempMax !== null && !f.error)
    .map((f) => f.tempMax as number);
  const prelimMean = mean(members.length ? members : validMaxes) ?? 0;
  const monthIndex = Number.parseInt(opts.date.slice(5, 7), 10) - 1;
  const regime = assessRegime(
    prelimMean,
    conditions,
    getCityClimatology(climatologyStore, location.name),
    monthIndex,
  );

  const ensemble = yield* runVotingSystem(corrected, {
    thresholds,
    members,
    empiricalRmse: getEmpiricalRmse(calibrationStore, location.name),
    regime,
  });

  printForecastOutput(location, opts.date, corrected, ensemble, conditions);

  yield* appendForecastSnapshot(
    location,
    opts.date,
    corrected,
    ensemble,
    polymarketUrl,
    conditions,
  );
  yield* appendForecastLog(
    buildLogEntry(
      location.name,
      opts.date,
      corrected,
      ensemble.maxMean,
      ensemble.maxSpread,
      ensemble.modelsUsed,
      ensemble.membersUsed,
      ensemble.regime.kind,
    ),
  );
});
