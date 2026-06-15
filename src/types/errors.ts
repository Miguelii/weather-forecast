import { Data } from 'effect';
import type { ModelId } from '#types.js';

// Typed errors — each adds a `get message()` getter so it prints correctly when it escapes
// to the CLI runner (`runOrExit`).

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

export class ForecastLogError extends Data.TaggedError('ForecastLogError')<{ cause: string }> {
  get message(): string {
    return this.cause;
  }
}

export class CalibrationError extends Data.TaggedError('CalibrationError')<{ cause: string }> {
  get message(): string {
    return this.cause;
  }
}

export class ClimatologyError extends Data.TaggedError('ClimatologyError')<{ cause: string }> {
  get message(): string {
    return this.cause;
  }
}

export class ConditionsFetchError extends Data.TaggedError('ConditionsFetchError')<{
  cause: string;
}> {
  get message(): string {
    return this.cause;
  }
}

export class ActualsFetchError extends Data.TaggedError('ActualsFetchError')<{ cause: string }> {
  get message(): string {
    return this.cause;
  }
}
