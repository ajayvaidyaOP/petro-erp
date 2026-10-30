export const CURRENCY = 'INR';
export const CURRENCY_SYMBOL = '₹';
export const DEFAULT_TIMEZONE = 'Asia/Kolkata';

export const PAYMENT_MODES = ['CASH', 'UPI', 'CARD', 'BANK', 'CREDIT'] as const;
export const SETTLEABLE_MODES = ['CASH', 'UPI', 'CARD', 'BANK'] as const;
export const READING_SOURCES = ['DEVICE', 'SIMULATOR', 'MANUAL', 'GATEWAY_REPLAY'] as const;
export const READING_QUALITIES = ['VALID', 'SUSPICIOUS', 'NEGATIVE', 'STALE', 'RESET', 'GAP'] as const;
export const SHIFT_STATUSES = ['OPEN', 'CLOSED', 'FLAGGED', 'REVERSED'] as const;
export const TENANT_STATUSES = ['ACTIVE', 'SUSPENDED', 'PENDING'] as const;
export const SUBSCRIPTION_STATUSES = ['TRIALING', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELLED'] as const;
export const STOCK_MOVEMENT_TYPES = [
  'OPENING', 'DELIVERY', 'DISPENSED', 'ADJUSTMENT', 'TRANSFER_IN', 'TRANSFER_OUT',
] as const;

/** Tolerance (litres) below which a stock variance is considered normal evaporation/measurement noise. */
export const STOCK_VARIANCE_TOLERANCE_LITRES = 50;

/** Cash denomination counter (INR notes + coins) used at shift closing. */
export const CASH_DENOMINATIONS = [500, 200, 100, 50, 20, 10, 5, 2, 1] as const;

/**
 * Density @15°C guidance bands (kg/m³) per fuel category (BS-VI retail specs).
 * Used to flag the daily density register; the OMC invoice density always wins
 * if a dispute arises.
 */
export const DENSITY_SPEC_KG_M3: Record<string, { min: number; max: number; correctionPerC: number }> = {
  PETROL: { min: 720, max: 775, correctionPerC: 0.7 },
  DIESEL: { min: 810, max: 860, correctionPerC: 0.64 },
  CNG: { min: 0, max: 0, correctionPerC: 0 },
  LUBRICANT: { min: 0, max: 0, correctionPerC: 0 },
};

/**
 * Stock loss/gain norms (% of sales) used for the monthly stock statement.
 * Guidance values from OMC marketing discipline practice (evaporation +
 * handling): petrol loses more to evaporation than diesel.
 */
export const STOCK_LOSS_NORM_PCT: Record<string, number> = {
  PETROL: 0.75,
  DIESEL: 0.25,
  CNG: 0,
  LUBRICANT: 0,
};

export const COMPLIANCE_DOC_TYPES = [
  'PESO_LICENCE', 'WM_STAMPING', 'FIRE_NOC', 'TRADE_LICENCE', 'TANK_TESTING',
  'POLLUTION_NOC', 'ELECTRICAL_SAFETY', 'INSURANCE', 'OTHER',
] as const;

export const ATTENDANCE_STATUSES = ['PRESENT', 'ABSENT', 'HALF_DAY', 'LEAVE', 'WEEK_OFF'] as const;

export const ACCOUNTING_DISCLAIMER =
  'Figures are operational estimates derived from dispenser totalizers and recorded entries. ' +
  'They are not audited financial statements. Profit requires purchase costs, expenses and reconciliations to be complete.';

export const HARDWARE_DISCLAIMER =
  'Simulated data only. Real dispenser integration is unverified until tested against a compatible ' +
  'forecourt controller with a documented vendor protocol.';
