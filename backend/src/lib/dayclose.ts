import { get } from '../db/index.js';
import { conflict } from './errors.js';

/**
 * Day closing (roznamcha band): ek baar din band ho jaye to us business date
 * ki operational entries lock ho jati hain. Galti sudharni ho to manager ko
 * reason ke saath din dobara kholna padta hai (audit me record rehta hai).
 */
export function isDayClosed(stationId: string, businessDate: string): boolean {
  const row = get<{ status: string }>(
    'SELECT status FROM day_closings WHERE station_id = ? AND business_date = ?',
    [stationId, businessDate],
  );
  return row?.status === 'CLOSED';
}

/** Throws when the business date is locked for this station. */
export function assertDayOpen(stationId: string, businessDate: string) {
  if (isDayClosed(stationId, businessDate)) {
    throw conflict(
      `Business date ${businessDate} is closed (din band ho chuka hai). Reopen it from Shifts → Day closing before editing entries for that date.`,
    );
  }
}
