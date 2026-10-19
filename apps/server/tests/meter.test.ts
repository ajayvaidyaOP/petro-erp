import { describe, expect, it } from 'vitest';
import { evaluateReading, shiftVolume, signedMovement } from '../src/lib/meter.js';
import { D } from '../src/lib/decimal.js';

const prev = { value: '1000.000', unit: 'L', readingAt: '2026-01-01T06:00:00.000Z', sequence: 10 };

describe('cumulative totalizer evaluation', () => {
  it('derives a valid delta between comparable readings', () => {
    const result = evaluateReading(
      { value: '1250.500', unit: 'L', readingAt: '2026-01-01T12:00:00.000Z', sequence: 11 },
      prev,
    );
    expect(result.quality).toBe('VALID');
    expect(result.countable).toBe(true);
    expect(result.delta?.toFixed(3)).toBe('250.500');
  });

  it('treats zero movement as valid but zero litres', () => {
    const result = evaluateReading(
      { value: '1000.000', unit: 'L', readingAt: '2026-01-01T12:00:00.000Z', sequence: 11 },
      prev,
    );
    expect(result.quality).toBe('VALID');
    expect(result.delta?.toString()).toBe('0');
  });

  it('flags a decrease as non-countable (no automatic rollover)', () => {
    const result = evaluateReading(
      { value: '900.000', unit: 'L', readingAt: '2026-01-01T12:00:00.000Z', sequence: 11 },
      prev,
    );
    expect(result.quality).toBe('NEGATIVE');
    expect(result.countable).toBe(false);
    // The negative delta is retained for diagnostics but never counted as sales.
    expect(result.delta?.toFixed(3)).toBe('-100.000');
  });

  it('flags an out-of-order (stale) event', () => {
    const result = evaluateReading(
      { value: '1100.000', unit: 'L', readingAt: '2025-12-31T23:00:00.000Z', sequence: 12 },
      prev,
    );
    expect(result.quality).toBe('STALE');
    expect(result.countable).toBe(false);
  });

  it('flags unit changes as a gap', () => {
    const result = evaluateReading(
      { value: '1250.000', unit: 'GAL', readingAt: '2026-01-01T12:00:00.000Z', sequence: 11 },
      prev,
    );
    expect(result.quality).toBe('GAP');
    expect(result.countable).toBe(false);
  });

  it('flags implausible jumps above the threshold', () => {
    const result = evaluateReading(
      { value: '999999.000', unit: 'L', readingAt: '2026-01-01T12:00:00.000Z', sequence: 11 },
      prev,
      { maxJumpLitres: 5000 },
    );
    expect(result.quality).toBe('SUSPICIOUS');
    expect(result.countable).toBe(false);
  });

  it('does not invent volume for a first-ever reading', () => {
    const result = evaluateReading(
      { value: '5000.000', unit: 'L', readingAt: '2026-01-01T12:00:00.000Z' },
      null,
    );
    expect(result.delta).toBeNull();
    expect(result.countable).toBe(false);
  });
});

describe('shift volume', () => {
  it('computes closing − opening', () => {
    const result = shiftVolume(
      { value: '1000.000', unit: 'L' },
      { value: '1250.750', unit: 'L' },
    );
    expect(result.issue).toBeNull();
    expect(result.litres?.toFixed(3)).toBe('250.750');
  });

  it('refuses negative volume', () => {
    const result = shiftVolume({ value: '1000.000', unit: 'L' }, { value: '900.000', unit: 'L' });
    expect(result.issue).toBe('NEGATIVE');
    expect(result.litres).toBeNull();
  });

  it('reports missing closing readings', () => {
    expect(shiftVolume({ value: '1000.000', unit: 'L' }, null).issue).toBe('MISSING_CLOSING');
  });
});

describe('stock movement signs', () => {
  it('adds receipts and subtracts dispensations', () => {
    expect(signedMovement('DELIVERY', '100').toString()).toBe('100');
    expect(signedMovement('DISPENSED', '40').toString()).toBe('-40');
    expect(signedMovement('ADJUSTMENT', '-10').toString()).toBe('10');
    expect(D('100').minus(D('40')).toString()).toBe('60');
  });
});
