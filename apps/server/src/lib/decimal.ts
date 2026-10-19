import { Decimal } from 'decimal.js';

// Money and metered quantities are never handled as IEEE-754 floats.
Decimal.set({ precision: 34, rounding: Decimal.ROUND_HALF_UP });

export { Decimal };

export type Numeric = string | number | Decimal | null | undefined;

export function D(value: Numeric): Decimal {
  if (value instanceof Decimal) return value;
  if (value === null || value === undefined || value === '') return new Decimal(0);
  try {
    return new Decimal(value);
  } catch {
    return new Decimal(0);
  }
}

/** Currency with two decimal places (INR). */
export function money(value: Numeric): string {
  return D(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
}

/** Per-litre prices keep three decimals to match forecourt rounding. */
export function rate(value: Numeric): string {
  return D(value).toDecimalPlaces(3, Decimal.ROUND_HALF_UP).toFixed(3);
}

/** Metered litres are stored to millilitre precision. */
export function litres(value: Numeric): string {
  return D(value).toDecimalPlaces(3, Decimal.ROUND_HALF_UP).toFixed(3);
}

export function sum(values: Numeric[]): Decimal {
  return values.reduce((acc: Decimal, v) => acc.plus(D(v)), D(0));
}

export function isNegative(value: Numeric): boolean {
  return D(value).lt(0);
}

export function isZero(value: Numeric): boolean {
  return D(value).isZero();
}

export function maxOf(values: Numeric[]): Decimal {
  return values.reduce((acc: Decimal, v) => (D(v).gt(acc) ? D(v) : acc), D(0));
}

export function percent(part: Numeric, whole: Numeric, decimals = 1): string {
  const denominator = D(whole);
  if (denominator.isZero()) return '0';
  return D(part).div(denominator).mul(100).toDecimalPlaces(decimals, Decimal.ROUND_HALF_UP).toFixed(decimals);
}
