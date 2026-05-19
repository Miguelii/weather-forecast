import { Cause, Effect } from 'effect';

export function runOrExit(effect: Effect.Effect<void, unknown>): void {
  Effect.runPromiseExit(effect).then((exit) => {
    if (exit._tag === 'Success') return;
    const err = Cause.squash(exit.cause);
    console.error(`\nError: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
