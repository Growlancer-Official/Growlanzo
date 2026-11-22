import { Star } from 'lucide-react';
import { formatRatingSummary } from '../lib/ratingDisplay';

/**
 * Star + score + review count, or nothing.
 *
 * Nothing is the important half: with zero reviews the whole block is omitted,
 * so a client's name can never be followed by a stray `(0)` again.
 */
export function RatingSummary({
  rating,
  totalReviews,
  className = '',
}: {
  rating: number | string | null | undefined;
  totalReviews: number | string | null | undefined;
  className?: string;
}) {
  const summary = formatRatingSummary(rating, totalReviews);
  if (!summary) return null;

  return (
    <span className={`flex items-center gap-1 text-xs ${className}`.trim()}>
      <Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />
      <span className="font-semibold text-slate-700">{summary.rating}</span>
      <span className="text-slate-400">({summary.reviews})</span>
    </span>
  );
}
