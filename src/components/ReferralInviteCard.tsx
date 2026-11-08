import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Check, Copy, Download, Link2, Mail, Share2 } from 'lucide-react';
import { useToast } from './Toast';
import { formatReferralCode } from '../lib/referralCode';
import {
  buildReferralShareIntent,
  buildReferralShareMessage,
  copyToClipboard,
  createReferralInviteCard,
  downloadReferralInviteCard,
  shareReferralInvite,
  type ReferralShareContext,
  type ReferralSharePlatform,
} from '../lib/referralShare';

// NOTE: the card deliberately does not print the monthly invite limit yet.
// `public.referral_monthly_invite_cap()` (migration 20270401000000) returns 5 and
// `process_referral` enforces it — but that migration is not applied to the live
// database yet, so advertising "5 per month" here would promise a limit the
// server does not currently enforce. Add the line once `supabase db push` has
// run and `POST /rpc/referral_monthly_invite_cap` returns 5 in production.

type Props = {
  code: string;
  link: string;
  name?: string | null;
  role?: string | null;
  /** Realtime channel is connected — the code/stats update without a reload. */
  live?: boolean;
  className?: string;
};

const SHARE_TARGETS: {
  platform: Exclude<ReferralSharePlatform, 'native'>;
  label: string;
  icon: ReactNode;
  className: string;
}[] = [
  {
    platform: 'whatsapp',
    label: 'WhatsApp',
    className: 'bg-[#25D366]/10 text-[#128C4A] hover:bg-[#25D366] hover:text-white',
    icon: (
      <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
      </svg>
    ),
  },
  {
    platform: 'linkedin',
    label: 'LinkedIn',
    className: 'bg-[#0A66C2]/10 text-[#0A66C2] hover:bg-[#0A66C2] hover:text-white',
    icon: (
      <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
      </svg>
    ),
  },
  {
    platform: 'twitter',
    label: 'X',
    className: 'bg-slate-900/5 text-slate-800 hover:bg-slate-900 hover:text-white',
    icon: (
      <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
      </svg>
    ),
  },
  {
    platform: 'email',
    label: 'Email',
    className: 'bg-emerald-600/10 text-emerald-700 hover:bg-emerald-600 hover:text-white',
    // UI icon, so it comes from the icon pack — only brand marks below are drawn.
    icon: <Mail className="h-4 w-4" />,
  },
];

/**
 * The one referral-code block used by both the freelancer and the client
 * referral pages.
 *
 * Three separate actions, because they are three different intentions:
 *   • Copy code  — the human-readable `GRW-XXXX-XXXX` to paste by hand.
 *   • Copy link  — the tracked signup URL to paste anywhere.
 *   • Share invite — the native share sheet with the professional message AND
 *     the branded 1200×630 Growlanzo card attached.
 *
 * `live` reflects the realtime subscription that keeps the code and stats fresh
 * on both dashboards without a reload.
 */
export function ReferralInviteCard({ code, link, name, role, live = false, className = '' }: Props) {
  const toast = useToast();
  const [copied, setCopied] = useState<'code' | 'link' | null>(null);
  const [cardBlob, setCardBlob] = useState<Blob | null>(null);
  const [sharing, setSharing] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const displayCode = formatReferralCode(code);
  const ready = Boolean(displayCode) && displayCode !== '…';

  const shareContext: ReferralShareContext = useMemo(
    () => ({ code: displayCode, link, name: name || null, role: role || null }),
    [displayCode, link, name, role]
  );

  const message = useMemo(() => buildReferralShareMessage(shareContext), [shareContext]);

  // Pre-render the card so the native share sheet still has a live user gesture
  // when the button is tapped (Safari drops the gesture across awaits).
  useEffect(() => {
    if (!ready || typeof window === 'undefined') return;
    let cancelled = false;
    const timer = setTimeout(() => {
      createReferralInviteCard(shareContext)
        .then((blob) => {
          if (!cancelled) setCardBlob(blob);
        })
        .catch(() => {
          /* the share button regenerates on demand */
        });
    }, 800);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [ready, shareContext]);

  useEffect(() => () => {
    if (copyTimer.current) clearTimeout(copyTimer.current);
  }, []);

  const markCopied = useCallback((target: 'code' | 'link') => {
    setCopied(target);
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied(null), 2200);
  }, []);

  const handleCopyCode = useCallback(async () => {
    if (!ready) return;
    const ok = await copyToClipboard(displayCode);
    if (!ok) {
      toast.error('Copy failed', 'Select the code and copy it manually.');
      return;
    }
    markCopied('code');
    toast.success('Referral code copied', `${displayCode} is on your clipboard.`);
  }, [displayCode, markCopied, ready, toast]);

  const handleCopyLink = useCallback(async () => {
    if (!ready || !link) return;
    const ok = await copyToClipboard(link);
    if (!ok) {
      toast.error('Copy failed', 'Select the link and copy it manually.');
      return;
    }
    markCopied('link');
    toast.success('Invite link copied', 'It already contains your referral code.');
  }, [link, markCopied, ready, toast]);

  const handleShare = useCallback(async () => {
    if (!ready || sharing) return;
    setSharing(true);
    try {
      const result = await shareReferralInvite(shareContext, cardBlob);
      if (result === 'shared') {
        toast.success('Invite shared', 'Your message and Growlanzo invite card were sent.');
      } else if (result === 'downloaded') {
        toast.info(
          'Invite ready to send',
          'Image sharing is not available in this browser, so we copied the message and downloaded the card — attach it where you share.'
        );
      } else if (result === 'copied') {
        toast.info('Invite copied', 'Paste it into WhatsApp, LinkedIn or email.');
      } else if (result === 'failed') {
        toast.error('Could not share', 'Copy the code above and share it manually.');
      }
    } finally {
      setSharing(false);
    }
  }, [cardBlob, ready, shareContext, sharing, toast]);

  const handleDownload = useCallback(async () => {
    if (!ready || downloading) return;
    setDownloading(true);
    try {
      const ok = await downloadReferralInviteCard(shareContext);
      if (ok) {
        toast.success('Invite card downloaded', 'A 1200×630 PNG with your code and Growlanzo branding.');
      } else {
        toast.error('Could not build the card', 'Try again from a supported browser.');
      }
    } finally {
      setDownloading(false);
    }
  }, [downloading, ready, shareContext, toast]);

  const openPlatform = useCallback(
    (platform: Exclude<ReferralSharePlatform, 'native'>) => {
      if (!ready) return;
      window.open(buildReferralShareIntent(platform, shareContext), '_blank', 'noopener,noreferrer');
    },
    [ready, shareContext]
  );

  return (
    <div className={`rounded-2xl border border-slate-200/80 bg-white/70 p-4 ${className}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">
            Your referral code
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Share this code or the link below. Both credit you the same way.
          </p>
        </div>

        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-emerald-700">
          <span
            className={`h-1.5 w-1.5 rounded-full ${live ? 'animate-pulse bg-emerald-500' : 'bg-slate-300'}`}
            aria-hidden="true"
          />
          {live ? 'Live' : 'Syncing'}
        </span>
      </div>

      {/* The code itself. aria-live so a realtime code change is announced. */}
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
        <div
          className="flex-1 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3"
          aria-live="polite"
          aria-atomic="true"
        >
          <span className="font-mono text-xl font-bold tracking-[0.18em] text-slate-900">
            {ready ? displayCode : '···'}
          </span>
        </div>

        <button
          type="button"
          onClick={handleCopyCode}
          disabled={!ready}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white shadow-sm transition-all hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {copied === 'code' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          {copied === 'code' ? 'Code copied' : 'Copy code'}
        </button>
      </div>

      <div className="mt-2 flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          onClick={handleCopyLink}
          disabled={!ready || !link}
          className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:border-emerald-200 hover:text-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {copied === 'link' ? <Check className="h-4 w-4" /> : <Link2 className="h-4 w-4" />}
          {copied === 'link' ? 'Link copied' : 'Copy invite link'}
        </button>

        <button
          type="button"
          onClick={handleShare}
          disabled={!ready || sharing}
          className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Share2 className="h-4 w-4" />
          {sharing ? 'Preparing card…' : 'Share with invite card'}
        </button>

        <button
          type="button"
          onClick={handleDownload}
          disabled={!ready || downloading}
          aria-label="Download the Growlanzo invite card as a PNG"
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-600 transition-colors hover:border-emerald-200 hover:text-emerald-700 disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto"
        >
          <Download className="h-4 w-4" />
          <span className="sm:hidden">Card</span>
        </button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-bold uppercase tracking-widest text-slate-400">Share to</span>
        {SHARE_TARGETS.map((target) => (
          <button
            key={target.platform}
            type="button"
            onClick={() => openPlatform(target.platform)}
            disabled={!ready}
            aria-label={`Share your Growlanzo invite on ${target.label}`}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${target.className}`}
          >
            {target.icon}
            {target.label}
          </button>
        ))}
      </div>

      <details className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500">
        <summary className="cursor-pointer font-semibold text-slate-600">
          Preview the message people receive
        </summary>
        <pre className="mt-2 whitespace-pre-wrap break-words font-sans leading-relaxed text-slate-600">
          {message}
        </pre>
      </details>
    </div>
  );
}
