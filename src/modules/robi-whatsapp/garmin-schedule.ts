export const CHECKER_CRON = '0 8-23 * * *';
export const CHECKER_TIMEZONE = 'Asia/Jerusalem';
export const CHECKER_NAME = 'robi-garmin-hourly';
export const CHECKER_SCRIPT = 'bun /app/src/modules/robi-whatsapp/garmin-check-gate.ts';
export function withinCheckerHours(time = new Date()): boolean {
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', { timeZone: CHECKER_TIMEZONE, hour: '2-digit', hourCycle: 'h23' }).format(time),
  );
  return hour >= 8 && hour <= 23;
}
