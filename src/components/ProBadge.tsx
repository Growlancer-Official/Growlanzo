import { BadgeCheck } from 'lucide-react';

interface ProBadgeProps {
  size?: 'xs' | 'sm' | 'md';
  className?: string;
  /** Tooltip side: 'top' (default) in-content, 'bottom' inside sticky headers. */
  placement?: 'top' | 'bottom';
}

/**
 * The one green badge in the product: PREMIUM / PRO.
 *
 * Branding decision (Nov 2026): the green check badge no longer means
 * "verified". Verification is Coming Soon, so no verification badge is shown
 * anywhere. The same green badge treatment now belongs exclusively to an
 * ACTIVE Premium subscription, and reads "PRO".
 *
 * Visibility is decided by the caller from live subscription state
 * (`useProStatus` / `isProSubscription`) or the server-synced
 * `profiles.is_pro` flag — never from `verification_status`.
 */
export function ProBadge({ size = 'sm', className = '', placement = 'top' }: ProBadgeProps) {
  const sizes = {
    xs: { pill: 'text-[10px] px-1.5 py-0.5 gap-0.5', icon: 'w-3 h-3', label: 'text-[10px]', tooltip: 'text-xs px-2 py-1' },
    sm: { pill: 'text-xs px-2 py-0.5 gap-1', icon: 'w-3.5 h-3.5', label: 'text-[10px]', tooltip: 'text-xs px-2.5 py-1' },
    md: { pill: 'text-xs px-2.5 py-1 gap-1', icon: 'w-4 h-4', label: 'text-xs', tooltip: 'text-xs px-3 py-1.5' },
  }[size];

  const below = placement === 'bottom';

  const base = `relative group inline-flex items-center justify-center rounded-full bg-gradient-to-br from-emerald-500 to-green-600 text-white font-extrabold uppercase tracking-wider shadow-sm ${sizes.pill} ${className}`;

  return (
    <span className={base} role="img" aria-label="Growlanzo Premium member">
      <BadgeCheck className={`${sizes.icon} fill-white/20`} strokeWidth={2.5} />
      <span className={`${sizes.label} leading-none`}>PRO</span>

      {/* Right-anchored only in sticky-header placement so it cannot overflow
          the viewport's right edge; centered in content. */}
      <span
        role="tooltip"
        className={`pointer-events-none absolute z-50 whitespace-nowrap rounded-lg bg-slate-900 text-white font-semibold normal-case tracking-normal shadow-xl opacity-0 transition-opacity duration-200 group-hover:opacity-100 ${below ? 'right-0 top-full mt-1.5 text-right' : 'left-1/2 -translate-x-1/2 -top-1 -translate-y-full text-center'} ${sizes.tooltip}`}
      >
        Premium member
        <span className="block text-[10px] font-medium opacity-80 normal-case tracking-normal">
          active subscription · never a ranking boost
        </span>
        <span className={`absolute border-4 border-transparent ${below ? 'right-2 bottom-full border-b-slate-900' : 'left-1/2 -translate-x-1/2 top-full border-t-slate-900'}`} />
      </span>
    </span>
  );
}

export default ProBadge;
