import { BadgeCheck } from 'lucide-react';

interface VerifiedBadgeProps {
  size?: 'xs' | 'sm' | 'md';
  showLabel?: boolean;
  className?: string;
  /**
   * 'green' (default) for freelancer verification badge.
   * 'blue' for client verification badge.
   */
  tone?: 'green' | 'blue';
  /**
   * Tooltip side. 'top' (default) for in-content badges.
   * Use 'bottom' when the badge sits in a sticky header/top bar, where an
   * upward tooltip would be clipped by the viewport's top edge.
   */
  placement?: 'top' | 'bottom';
}

/**
 * Instagram-style verified badge — shown next to the name of users who
 * completed ACCOUNT verification (name + confirmed email + confirmed phone).
 * Color varies by role:
 * - Freelancer: GREEN (default)
 * - Client: BLUE
 *
 * It is explicitly NOT a KYC badge: full KYC is deferred for the Beta, so the
 * label never says "KYC" — a verified phone number must not read as identity
 * verification. Lifetime, synced everywhere (search, contracts, workspace,
 * public profile). Hovering shows "Verified on Growlanzo" / "Verified Client".
 */
export function VerifiedBadge({ size = 'sm', showLabel = false, className = '', tone = 'green', placement = 'top' }: VerifiedBadgeProps) {
  const sizes = {
    xs: { icon: 'w-3.5 h-3.5', pill: 'text-[10px] px-1.5 py-0.5 gap-0.5', label: 'text-[10px]', tooltip: 'text-xs px-2 py-1' },
    sm: { icon: 'w-4 h-4', pill: 'text-xs px-2 py-0.5 gap-1', label: 'text-xs', tooltip: 'text-xs px-2.5 py-1' },
    md: { icon: 'w-4 h-4', pill: 'text-xs px-2.5 py-1 gap-1', label: 'text-xs', tooltip: 'text-xs px-3 py-1.5' },
  }[size];

  const gradient = tone === 'blue'
    ? 'from-emerald-500 to-emerald-700'
    : 'from-emerald-500 to-green-600';

  const label = tone === 'blue' ? 'Verified Client' : 'Verified on Growlanzo';

  const below = placement === 'bottom';

  const base = `relative group inline-flex items-center justify-center rounded-full bg-gradient-to-br ${gradient} text-white font-extrabold uppercase tracking-wider shadow-sm ${sizes.pill} ${className}`;

  return (
    <span
      className={base}
      role="img"
      aria-label={label}
    >
      <BadgeCheck className={`${sizes.icon} fill-white/20`} strokeWidth={2.5} />
      {showLabel && <span className={sizes.label}>{tone === 'blue' ? 'CLIENT' : 'VERIFIED'}</span>}

      {/* Polished hover tooltip — precise: platform-level verification, not a government-issued ID.
          'bottom' placement (sticky dashboard header, near the viewport's RIGHT edge):
          right-anchor the tooltip so it can never overflow right and create a horizontal
          scrollbar (left overflow doesn't scroll in LTR).
          Default 'top' placement (in-content badges near the LEFT edge): keep it centered
          above the badge — right-anchoring here would push ~250px of tooltip off-screen
          to the left and clip it inside overflow containers (e.g. sidebar drawer). */}
      <span
        role="tooltip"
        className={`pointer-events-none absolute z-50 whitespace-nowrap rounded-lg bg-slate-900 text-white font-semibold normal-case tracking-normal shadow-xl opacity-0 transition-opacity duration-200 group-hover:opacity-100 ${below ? 'right-0 top-full mt-1.5 text-right' : 'left-1/2 -translate-x-1/2 -top-1 -translate-y-full text-center'} ${sizes.tooltip}`}
      >
        {tone === 'blue' ? 'Verified Client' : 'Verified on Growlanzo'}
        <span className="block text-[10px] font-medium opacity-80 normal-case tracking-normal">platform verification · not a government-issued ID</span>
        <span className={`absolute border-4 border-transparent ${below ? 'right-2 bottom-full border-b-slate-900' : 'left-1/2 -translate-x-1/2 top-full border-t-slate-900'}`} />
      </span>
    </span>
  );
}

export default VerifiedBadge;
