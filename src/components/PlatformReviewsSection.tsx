import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, Loader2, MessageSquarePlus, Quote, Star } from 'lucide-react';
import { supabase, uniqueChannelName } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useToast } from './Toast';
import { ModalShell } from './ModalShell';

type ReviewRole = 'client' | 'freelancer';

interface PlatformReview {
  id: string;
  user_id: string;
  role: ReviewRole;
  rating: number;
  comment: string;
  created_at: string;
  author?: { name: string | null; avatar: string | null } | null;
}

const MAX_COMMENT = 600;
const MIN_COMMENT = 10;

function Stars({ value }: { value: number }) {
  return (
    <div className="flex items-center gap-0.5" aria-label={`${value} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          className={`h-3.5 w-3.5 ${n <= Math.round(value) ? 'fill-amber-400 text-amber-400' : 'text-slate-200'}`}
        />
      ))}
    </div>
  );
}

function ReviewCard({ review }: { review: PlatformReview }) {
  const initial = (review.author?.name || 'G').charAt(0).toUpperCase();
  return (
    <figure className="flex h-full flex-col rounded-xl bg-white p-5 ring-1 ring-slate-200/70 shadow-sm">
      <Quote className="h-5 w-5 text-emerald-500/40" aria-hidden="true" />
      <blockquote className="mt-2 flex-1 text-sm leading-relaxed text-slate-600">
        {review.comment}
      </blockquote>
      <figcaption className="mt-4 flex items-center gap-3 border-t border-slate-100 pt-3">
        {review.author?.avatar ? (
          <img src={review.author.avatar} alt="" className="h-9 w-9 rounded-full object-cover" />
        ) : (
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-100 text-sm font-bold text-emerald-700">
            {initial}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-slate-900">{review.author?.name || 'Growlanzo member'}</p>
          <div className="mt-0.5 flex items-center gap-2">
            <Stars value={review.rating} />
            <span className="text-xs text-slate-400">
              {new Date(review.created_at).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}
            </span>
          </div>
        </div>
      </figcaption>
    </figure>
  );
}

function ReviewForm({
  role,
  existing,
  onClose,
  onSaved,
}: {
  role: ReviewRole;
  existing?: PlatformReview;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { user } = useAuth();
  const toast = useToast();
  const [rating, setRating] = useState(existing?.rating || 0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState(existing?.comment || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = comment.trim();
  const canSubmit = rating > 0 && trimmed.length >= MIN_COMMENT && trimmed.length <= MAX_COMMENT && !saving;

  const submit = async () => {
    if (!user || !canSubmit) return;
    setSaving(true);
    setError(null);
    const { error: saveError } = await (supabase as any)
      .from('platform_reviews')
      .upsert(
        { user_id: user.id, rating, comment: trimmed },
        { onConflict: 'user_id' }
      );
    setSaving(false);
    if (saveError) {
      setError(saveError.message || 'Could not save your review.');
      return;
    }
    toast.success(existing ? 'Review updated' : 'Review published', 'Thank you — it is live on the homepage.');
    onSaved();
    onClose();
  };

  return (
    <ModalShell isOpen onClose={onClose} title={existing ? 'Update your review' : `Review Growlanzo as a ${role}`} maxWidth="max-w-lg">
      <p className="mb-4 text-xs text-slate-500">
        Your review appears publicly on the homepage under “What our {role === 'client' ? 'clients' : 'freelancers'} say”.
      </p>

      {error && (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}

      <div className="mb-4">
        <p className="mb-2 text-sm font-semibold text-slate-800">Your rating <span className="text-red-500">*</span></p>
        <div className="flex items-center gap-1">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              onMouseEnter={() => setHover(n)}
              onMouseLeave={() => setHover(0)}
              onClick={() => setRating(n)}
              className="p-0.5 transition-transform hover:scale-110"
              aria-label={`${n} star${n > 1 ? 's' : ''}`}
            >
              <Star className={`h-7 w-7 ${(hover || rating) >= n ? 'fill-amber-400 text-amber-400' : 'text-slate-300'}`} />
            </button>
          ))}
        </div>
      </div>

      <label htmlFor="platform-review-comment" className="mb-2 block text-sm font-semibold text-slate-800">
        Your experience <span className="text-red-500">*</span>
      </label>
      <textarea
        id="platform-review-comment"
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        rows={4}
        maxLength={MAX_COMMENT}
        placeholder="What actually changed for you? Be specific and honest."
        className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
      />
      <p className="mt-1 text-right text-xs text-slate-400">{comment.length}/{MAX_COMMENT}</p>

      <div className="mt-3 flex gap-3">
        <button
          type="button"
          onClick={onClose}
          className="flex-1 rounded-xl border border-slate-200 px-4 py-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={!canSubmit}
          className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
          {existing ? 'Update review' : 'Publish review'}
        </button>
      </div>
    </ModalShell>
  );
}

export function PlatformReviewsSection() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [reviews, setReviews] = useState<PlatformReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [formRole, setFormRole] = useState<ReviewRole | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await (supabase as any)
      .from('platform_reviews')
      .select('id, user_id, role, rating, comment, created_at, author:profiles!platform_reviews_user_id_fkey(name, avatar)')
      .eq('status', 'published')
      .order('created_at', { ascending: false })
      .limit(40);
    if (error) {
      setFailed(true);
      setLoading(false);
      return;
    }
    setFailed(false);
    setReviews((data || []) as PlatformReview[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
    const channel = supabase
      .channel(uniqueChannelName('homepage-platform-reviews'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'platform_reviews' }, () => void load())
      .subscribe();
    return () => { void channel.unsubscribe(); };
  }, [load]);

  const byRole = useMemo(() => ({
    client: reviews.filter((r) => r.role === 'client'),
    freelancer: reviews.filter((r) => r.role === 'freelancer'),
  }), [reviews]);

  const myRole = user?.role === 'client' || user?.role === 'freelancer' ? user.role : null;
  const myReview = myRole ? reviews.find((r) => r.user_id === user?.id) : undefined;

  const renderSection = (role: ReviewRole) => {
    const list = byRole[role].slice(0, 6);
    const average = list.length ? list.reduce((sum, r) => sum + r.rating, 0) / list.length : 0;
    const label = role === 'client' ? 'clients' : 'freelancers';
    const canWrite = myRole === role;

    return (
      <div className="rounded-2xl bg-slate-50/70 p-4 ring-1 ring-slate-200/60 sm:p-5">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="font-display text-xl font-bold tracking-tight text-slate-900">
              What our {label} say
            </h3>
            <p className="mt-1 text-sm text-slate-500">
              {list.length > 0
                ? `${average.toFixed(1)} / 5 from ${list.length} published review${list.length === 1 ? '' : 's'}`
                : 'No published reviews yet.'}
            </p>
          </div>
          {canWrite ? (
            <button
              type="button"
              onClick={() => setFormRole(role)}
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-emerald-700"
            >
              <MessageSquarePlus className="h-4 w-4" />
              {myReview ? 'Update your review' : 'Share your experience'}
            </button>
          ) : !user ? (
            <button
              type="button"
              onClick={() => navigate('/?modal=login')}
              className="text-xs font-semibold text-emerald-700 underline-offset-2 hover:underline"
            >
              Sign in to share yours
            </button>
          ) : null}
        </div>

        {loading ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {[1, 2].map((i) => <div key={i} className="h-40 animate-pulse rounded-xl bg-white ring-1 ring-slate-200/70" />)}
          </div>
        ) : list.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 bg-white/60 p-8 text-center">
            <Quote className="mx-auto mb-2 h-6 w-6 text-slate-300" />
            <p className="text-sm text-slate-500">
              Real reviews appear here after a completed contract. No invented testimonials.
            </p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {list.map((review) => <ReviewCard key={review.id} review={review} />)}
          </div>
        )}
      </div>
    );
  };

  return (
    <section className="py-6 sm:py-8 lg:py-10">
      <div className="mx-auto max-w-[100rem] px-4 sm:px-6 lg:px-8 2xl:px-12">
        <div className="mb-5 max-w-2xl">
          <div className="mb-2 text-xs font-sans font-semibold uppercase tracking-widest text-emerald-600">
            Reputation, both ways
          </div>
          <h2 className="font-display text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl lg:text-4xl">
            What our clients and freelancers say
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-slate-600 sm:text-base">
            Published by members with at least one completed contract. New reviews appear here live.
          </p>
        </div>

        {failed ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            Reviews are temporarily unavailable. Please refresh in a moment.
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {renderSection('client')}
            {renderSection('freelancer')}
          </div>
        )}
      </div>

      {formRole && (
        <ReviewForm
          role={formRole}
          existing={myReview}
          onClose={() => setFormRole(null)}
          onSaved={() => void load()}
        />
      )}
    </section>
  );
}
