import { DATE_RE, MAX_FORECAST_DAYS } from '#utils/constants.js';

/**
 * Validates a date string from the CLI and prints warnings for out-of-range dates.
 *
 * Exits the process with code 1 if the date is not in `YYYY-MM-DD` format.
 * Prints a warning to stderr (but continues) if the date is in the past or
 * beyond the maximum forecast horizon ({@link MAX_FORECAST_DAYS}).
 *
 * @param date - Date string to validate (expected format: `YYYY-MM-DD`).
 */
export function validateDate(date: string): void {
  if (!DATE_RE.test(date)) {
    console.error(`Error: --date must be in YYYY-MM-DD format (got "${date}")`);
    process.exit(1);
  }

  const daysDiff = Math.round((new Date(date).getTime() - Date.now()) / 86_400_000);

  if (daysDiff < -1) {
    console.warn(
      '⚠️  Date in the past — the models do not have historical data and may return null values.',
    );
  }

  if (daysDiff > MAX_FORECAST_DAYS) {
    console.warn(
      `⚠️  Date beyond ${MAX_FORECAST_DAYS} days — models may not have data for that date.`,
    );
  }
}
