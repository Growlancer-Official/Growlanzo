// Date and Time Utilities for Growlanzo

/**
 * Format a date safely — never throws on null/undefined/invalid input.
 * Returns '' when the input cannot be parsed, so the UI renders an empty
 * string instead of crashing the whole dashboard with a RangeError.
 */
export function safeFormatDate(
  value: string | Date | number | null | undefined,
  options?: Intl.DateTimeFormatOptions
): string {
  if (value === null || value === undefined || value === '') return '';
  const d = new Date(value);
  if (isNaN(d.getTime())) return '';
  try {
    return d.toLocaleDateString('en-US', options);
  } catch {
    return '';
  }
}

/**
 * Format a date+time safely — returns '' on invalid input (never throws).
 */
export function safeFormatDateTime(
  value: string | Date | number | null | undefined,
  options?: Intl.DateTimeFormatOptions
): string {
  if (value === null || value === undefined || value === '') return '';
  const d = new Date(value);
  if (isNaN(d.getTime())) return '';
  try {
    return d.toLocaleString('en-US', options);
  } catch {
    return '';
  }
}

/**
 * Format a time safely — returns '' on invalid input (never throws).
 */
export function safeFormatTime(
  value: string | Date | number | null | undefined,
  options?: Intl.DateTimeFormatOptions
): string {
  if (value === null || value === undefined || value === '') return '';
  const d = new Date(value);
  if (isNaN(d.getTime())) return '';
  try {
    return d.toLocaleTimeString('en-US', options);
  } catch {
    return '';
  }
}

/**
 * Coerce an unknown value to a finite number — never NaN/undefined.
 * Falls back to `fallback` (default 0) so renders never throw on nulls.
 */
export function safeNumber(value: unknown, fallback = 0): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Coerce an unknown value to a string — never throws.
 * Numbers/booleans are converted; null/undefined/objects become ''.
 * Prevents `.toLowerCase()/.trim()` crashes on non-string DB values
 * (skills_required, tags, titles, etc. can legally be numbers in text[]).
 */
export function safeString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

/**
 * Lowercase + trim a value safely — never throws, returns '' for nulls.
 * The single safest way to compare DB text values in filters/matches.
 */
export function safeLower(value: unknown): string {
  return safeString(value).toLowerCase().trim();
}

/**
 * Format a date to a readable string
 * @param date - Date to format
 * @returns Formatted date string
 */
export function formatDate(date: Date | string | number): string {
  const d = new Date(date);
  if (isNaN(d.getTime())) return '—';
  const now = new Date();
  const diffTime = Math.abs(now.getTime() - d.getTime());
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

  // Relative time for recent dates
  if (diffDays === 0) {
    const diffHours = Math.floor(diffTime / (1000 * 60 * 60));
    if (diffHours === 0) {
      const diffMinutes = Math.floor(diffTime / (1000 * 60));
      if (diffMinutes === 0) {
        return 'Just now';
      }
      return `${diffMinutes} minute${diffMinutes !== 1 ? 's' : ''} ago`;
    }
    return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;
  }

  if (diffDays === 1) {
    return 'Yesterday';
  }

  if (diffDays < 7) {
    return `${diffDays} days ago`;
  }

  if (diffDays < 30) {
    const weeks = Math.floor(diffDays / 7);
    return `${weeks} week${weeks !== 1 ? 's' : ''} ago`;
  }

  if (diffDays < 365) {
    const months = Math.floor(diffDays / 30);
    return `${months} month${months !== 1 ? 's' : ''} ago`;
  }

  // Absolute date for older dates
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/**
 * Format a date with time
 * @param date - Date to format
 * @returns Formatted date and time string
 */
export function formatDateTime(date: Date | string | number): string {
  const d = new Date(date);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

/**
 * Format time only
 * @param date - Date to format
 * @returns Formatted time string
 */
export function formatTime(date: Date | string | number): string {
  const d = new Date(date);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

/**
 * Get relative time description
 * @param date - Date to compare
 * @returns Relative time description
 */
export function getRelativeTime(date: Date | string | number): string {
  const d = new Date(date);
  if (isNaN(d.getTime())) return '—';
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSecs < 60) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo ago`;
  return `${Math.floor(diffDays / 365)}y ago`;
}

/**
 * Check if a date is today
 * @param date - Date to check
 * @returns Boolean indicating if date is today
 */
export function isToday(date: Date | string | number): boolean {
  const d = new Date(date);
  const now = new Date();
  return (
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear()
  );
}

/**
 * Get current timestamp
 * @returns Current timestamp as ISO string
 */
export function getCurrentTimestamp(): string {
  return new Date().toISOString();
}

/**
 * Add days to a date
 * @param date - Starting date
 * @param days - Number of days to add
 * @returns New date
 */
export function addDays(date: Date | string | number, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

// Currency formatting lives in src/lib/currency.ts (single source of truth).
// Re-exported here so existing importers of utils/date keep working.
import { formatCurrency } from '../lib/currency';
export { formatCurrency };

/**
 * Format a project budget. Growlanzo uses a single-budget model where
 * budget_min === budget_max — such projects render as one amount ("₹10,000")
 * instead of an odd "₹10,000 - ₹10,000" range. Legacy range projects still
 * render as a range.
 */
export function formatBudgetRange(min?: number | null, max?: number | null): string {
  const minN = Number(min ?? 0);
  const maxN = Number(max ?? 0);
  if (minN > 0 && maxN > 0 && minN === maxN) return formatCurrency(minN);
  if (minN > 0 && maxN > 0) return `${formatCurrency(minN)} - ${formatCurrency(maxN)}`;
  if (minN > 0) return formatCurrency(minN);
  if (maxN > 0) return formatCurrency(maxN);
  return '—';
}

/**
 * Calculate platform fee
 * @deprecated Use the shared helpers from src/lib/config.ts instead:
 *   - calculatePlatformFee(amount) — returns the 5% fee
 *   - calculateTotalWithFee(amount) — returns the agreed amount (client pays this)
 *   - calculateFreelancerAmount(amount) — returns amount minus 5% (freelancer receives this)
 * 
 * This function is kept for backwards compatibility but delegates to config.
 */
export function calculatePlatformFee(
  amount: number,
  feePercentage = 5
): { fee: number; total: number; freelancerAmount: number } {
  const fee = (amount * feePercentage) / 100;
  // Freelancer-side commission: the client pays the agreed amount and the fee
  // is withheld from the payout at release.
  return {
    fee,
    total: amount,
    freelancerAmount: amount - fee,
  };
}
