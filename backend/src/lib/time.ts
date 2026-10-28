import { DEFAULT_TIMEZONE } from '@petroflow/shared';

const IST_OFFSET_MINUTES = 330;

export function nowIso(): string {
  return new Date().toISOString();
}

export function addDaysIso(iso: string, days: number): string {
  return new Date(new Date(iso).getTime() + days * 86_400_000).toISOString();
}

/** Add whole days to a YYYY-MM-DD business date, returning YYYY-MM-DD. */
export function addDays(date: string, days: number): string {
  const base = new Date(`${date}T00:00:00.000Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

export function addMinutesIso(iso: string, minutes: number): string {
  return new Date(new Date(iso).getTime() + minutes * 60_000).toISOString();
}

export function addHoursIso(iso: string, hours: number): string {
  return new Date(new Date(iso).getTime() + hours * 3_600_000).toISOString();
}

function istShift(date = new Date()): Date {
  return new Date(date.getTime() + IST_OFFSET_MINUTES * 60_000);
}

/** Calendar date (YYYY-MM-DD) for a given instant in Asia/Kolkata. */
export function todayIst(date = new Date()): string {
  return istShift(date).toISOString().slice(0, 10);
}

/** UTC instant corresponding to 00:00 IST of the supplied YYYY-MM-DD. */
export function istDayStart(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y!, (m ?? 1) - 1, d ?? 1, 0, 0, 0) - IST_OFFSET_MINUTES * 60_000).toISOString();
}

/** UTC instant corresponding to 23:59:59.999 IST of the supplied day. */
export function istDayEnd(day: string): string {
  return new Date(new Date(istDayStart(day)).getTime() + 86_400_000 - 1).toISOString();
}

export function istHour(date = new Date()): number {
  return istShift(date).getUTCHours();
}

export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  // Date silently rolls invalid dates such as February 30 into March.
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function istRange(from: string, to: string) {
  return { from: istDayStart(from), to: istDayEnd(to) };
}

export function relativeMinutes(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return null;
  return Math.floor((Date.now() - time) / 60_000);
}

export const TIMEZONE = DEFAULT_TIMEZONE;

/** Business date is the IST calendar date of the timestamp. */
export function businessDateOf(iso: string): string {
  return todayIst(new Date(iso));
}
