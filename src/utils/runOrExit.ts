import { Cause, Effect } from 'effect';

/**
 * Runs an Effect and exits the process with code 1 on failure.
 *
 * Extracts the error message via `Cause.squash` and prints it to stderr before exiting.
 * This is the standard entry point for all CLI command actions.
 *
 * @param effect - The Effect to execute. Must have `void` as its success type (side-effect only).
 */
export function runOrExit(effect: Effect.Effect<void, unknown>): void {
  Effect.runPromiseExit(effect).then((exit) => {
    if (exit._tag === 'Success') return;
    const err = Cause.squash(exit.cause);
    console.error(`\nError: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
