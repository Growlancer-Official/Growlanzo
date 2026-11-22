/**
 * Rating text shared by every card that shows a person's stars.
 *
 * Why this exists: the proposal card rendered a client's name followed by a
 * bare `0` — e.g. `Client: Test Client 1` plus a stale `(0)` review count from
 * the profile row. A star rating with no reviews behind it is not information,
 * so this helper returns `null` for that case and the caller renders nothing.
 */
export function formatRatingSummary(
  rating: number | string | null | undefined,
  totalReviews: number | string | null | undefined
): { rating: string; reviews: number } | null {
  const value = Number(rating);
  const count = Number(totalReviews);

  // No usable rating at all.
  if (!Number.isFinite(value) || value <= 0) return null;
  // A rating without a single review is a stale/derived value. Rendering
  // "(0)" next to it is the bug this guards against.
  if (!Number.isFinite(count) || count <= 0) return null;

  return { rating: value.toFixed(1), reviews: Math.round(count) };
}
