import { describe, it, expect } from 'vitest';
import { formatRatingSummary } from '../lib/ratingDisplay';

/**
 * The proposal card used to render a bare "0" right after the client's name
 * ("Client: Test Client 1" + 0 review count). Anything that has no review
 * behind it must format to null so the card renders nothing at all.
 */
describe('formatRatingSummary', () => {
  it('formats a real rating with its review count', () => {
    expect(formatRatingSummary(4.5, 12)).toEqual({ rating: '4.5', reviews: 12 });
  });

  it('accepts numeric strings, which is what PostgREST returns for numeric columns', () => {
    expect(formatRatingSummary('5.00', '3')).toEqual({ rating: '5.0', reviews: 3 });
  });

  it('hides a rating that has zero reviews (the stray "(0)" bug)', () => {
    expect(formatRatingSummary(5, 0)).toBeNull();
    expect(formatRatingSummary('4.8', '0')).toBeNull();
  });

  it('hides a rating without a count at all', () => {
    expect(formatRatingSummary(4.8, null)).toBeNull();
    expect(formatRatingSummary(4.8, undefined)).toBeNull();
  });

  it('hides missing, zero and nonsense ratings', () => {
    expect(formatRatingSummary(0, 4)).toBeNull();
    expect(formatRatingSummary(null, 4)).toBeNull();
    expect(formatRatingSummary(undefined, 4)).toBeNull();
    expect(formatRatingSummary('not-a-number', 4)).toBeNull();
    expect(formatRatingSummary(-2, 4)).toBeNull();
  });

  it('never prints a fractional review count', () => {
    expect(formatRatingSummary(4.2, 3.6)).toEqual({ rating: '4.2', reviews: 4 });
  });
});
