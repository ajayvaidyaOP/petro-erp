import { all, get } from '../db/index.js';
import { D, Decimal } from './decimal.js';

export type ReadingQuality = 'VALID' | 'SUSPICIOUS' | 'NEGATIVE' | 'STALE' | 'RESET' | 'GAP';

export interface ReadingInput {
  value: string;
  unit: string;
  readingAt: string;
  sequence?: number;
}

/** Accepts either an API-shaped reading or a persisted meter_readings row. */
export interface PreviousReading {
  value?: string;
  reading_value?: string;
  unit: string;
  readingAt?: string;
  reading_at?: string;
  sequence?: number;
  id?: string;
  quality?: string;
  is_countable?: number;
}

export interface EvaluationOptions {
  maxJumpLitres?: number;
  maxTotalizer?: number | null;
}

export interface ReadingEvaluation {
  quality: ReadingQuality;
  countable: boolean;
  delta: Decimal | null;
  reason: string | null;
  rules: string[];
}

const DEFAULT_MAX_JUMP = 10000;

function valueOf(reading: PreviousReading): string | undefined {
  return reading.value ?? reading.reading_value;
}
function atOf(reading: PreviousReading): string | undefined {
  return reading.readingAt ?? reading.reading_at;
}

/**
 * Evaluate a cumulative totalizer reading against the previous comparable one.
 *
 * Cumulative counters are monotonic. Invalid input is never silently converted
 * into sales: decreases, unit changes, out-of-order events and implausible jumps
 * are flagged and marked non-countable. No automatic rollover conversion is
 * performed without a verified device rule.
 */
export function evaluateReading(
  current: ReadingInput,
  previous: PreviousReading | null,
  options: EvaluationOptions = {},
): ReadingEvaluation {
  const maxJump = options.maxJumpLitres ?? DEFAULT_MAX_JUMP;
  const rules: string[] = [];

  if (!previous || valueOf(previous) === undefined) {
    return {
      quality: 'VALID',
      countable: false,
      delta: null,
      reason: 'First reading for this nozzle — baseline only',
      rules: ['BASELINE'],
    };
  }

  if (current.unit !== previous.unit) {
    rules.push('UNIT_MISMATCH');
    return {
      quality: 'GAP',
      countable: false,
      delta: null,
      reason: `Unit changed from ${previous.unit} to ${current.unit}; readings are not comparable and were not converted`,
      rules,
    };
  }

  const currentAt = new Date(current.readingAt).getTime();
  const priorAt = new Date(atOf(previous) ?? 0).getTime();
  if (Number.isFinite(currentAt) && Number.isFinite(priorAt) && currentAt <= priorAt) {
    rules.push('OUT_OF_ORDER');
    return {
      quality: 'STALE',
      countable: false,
      delta: null,
      reason: 'Reading arrived out of order relative to the last accepted reading',
      rules,
    };
  }

  if (previous.is_countable === 0) {
    rules.push('PREVIOUS_NOT_COUNTABLE');
    return {
      quality: 'SUSPICIOUS',
      countable: false,
      delta: null,
      reason: 'The previous reading was flagged; a verified baseline is required before counting litres',
      rules,
    };
  }

  const value = D(current.value);
  const prior = D(valueOf(previous)!);
  const delta = value.minus(prior);

  if (delta.isZero()) {
    rules.push('NO_MOVEMENT');
    return {
      quality: 'VALID',
      countable: true,
      delta,
      reason: null,
      rules,
    };
  }

  if (delta.lt(0)) {
    const rolloverSuspected =
      options.maxTotalizer != null &&
      prior.gte(D(options.maxTotalizer).times(0.95)) &&
      value.lte(D(options.maxTotalizer).times(0.05));
    if (rolloverSuspected) {
      rules.push('ROLLOVER_UNVERIFIED');
      return {
        quality: 'RESET',
        countable: false,
        delta,
        reason:
          'Totalizer appears to have rolled over. No verified rollover rule is configured for this device, so the reading was not converted into litres',
        rules,
      };
    }
    rules.push('NEGATIVE_DELTA');
    return {
      quality: 'NEGATIVE',
      countable: false,
      delta,
      reason: 'Totalizer decreased — possible meter reset, replacement or tampering',
      rules,
    };
  }

  if (delta.gt(maxJump)) {
    rules.push('JUMP_EXCEEDS_LIMIT');
    return {
      quality: 'SUSPICIOUS',
      countable: false,
      delta,
      reason: `Increase of ${delta.toFixed(3)} L exceeds the ${maxJump} L sanity limit`,
      rules,
    };
  }

  const gapMinutes = Math.round((currentAt - priorAt) / 60_000);
  if (gapMinutes > 24 * 60) {
    rules.push('LONG_GAP');
    return {
      quality: 'GAP',
      countable: false,
      delta,
      reason: `${Math.round(gapMinutes / 60)} h gap since the previous reading; volume cannot be attributed reliably`,
      rules,
    };
  }

  rules.push('MONOTONIC', 'WITHIN_LIMIT');
  return { quality: 'VALID', countable: true, delta, reason: null, rules };
}

/** Shift volume = closing − opening for a nozzle. Never negative. */
export function shiftVolume(
  opening: { value: string; unit: string } | null,
  closing: { value: string; unit: string } | null,
): { litres: Decimal | null; issue: 'MISSING_OPENING' | 'MISSING_CLOSING' | 'UNIT_MISMATCH' | 'NEGATIVE' | null } {
  if (!opening) return { litres: null, issue: 'MISSING_OPENING' };
  if (!closing) return { litres: null, issue: 'MISSING_CLOSING' };
  if (opening.unit !== closing.unit) return { litres: null, issue: 'UNIT_MISMATCH' };
  const litres = D(closing.value).minus(D(opening.value));
  if (litres.lt(0)) return { litres: null, issue: 'NEGATIVE' };
  return { litres, issue: null };
}

/**
 * Signed stock effect of a movement.
 *
 * Adjustments store the signed variance between book and measured stock; the
 * ledger applies the opposite sign to correct the book balance.
 */
export function signedMovement(type: string, quantity: string): Decimal {
  if (type === 'ADJUSTMENT') return D(quantity).negated();
  if (type === 'DISPENSED' || type === 'TRANSFER_OUT') return D(quantity).abs().negated();
  return D(quantity).abs();
}

export function lastReading(nozzleId: string): PreviousReading | null {
  return (
    get<PreviousReading>(
      `SELECT id, reading_value, unit, reading_at, quality, is_countable
         FROM meter_readings WHERE nozzle_id = ?
        ORDER BY reading_at DESC, created_at DESC LIMIT 1`,
      [nozzleId],
    ) ?? null
  );
}

/** Most recent reading that was accepted as countable. */
export function latestCountableReading(nozzleId: string): PreviousReading | null {
  return (
    get<PreviousReading>(
      `SELECT id, reading_value, unit, reading_at, quality, is_countable
         FROM meter_readings WHERE nozzle_id = ? AND is_countable = 1
        ORDER BY reading_at DESC, created_at DESC LIMIT 1`,
      [nozzleId],
    ) ?? null
  );
}

export function readingHistory(nozzleId: string, limit = 50) {
  return all(
    'SELECT * FROM meter_readings WHERE nozzle_id = ? ORDER BY reading_at DESC LIMIT ?',
    [nozzleId, limit],
  );
}
