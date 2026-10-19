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

export const ACCOUNTING_DISCLAIMER =
  'Figures are operational estimates derived from dispenser totalizers and recorded entries. ' +
  'They are not audited financial statements. Profit requires purchase costs, expenses and reconciliations to be complete.';

export const HARDWARE_DISCLAIMER =
  'Simulated data only. Real dispenser integration is unverified until tested against a compatible ' +
  'forecourt controller with a documented vendor protocol.';
