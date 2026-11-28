import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, Loader2, Sparkles } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from './Toast';
import { GrowCoinIcon } from './GrowCoinIcon';
import {
  CUSTOM_PROJECT_REWARD_COST,
  fetchCustomProjectReward,
  redeemGrowCoinsForCustomProject,
  newCoinRequestKey,
  type CustomProjectReward,
} from '../lib/growCoins';

/**
 * Client referral reward: 100 Grow Coins unlock ONE custom project posting.
 *
 * The card is a mirror of server state (`custom_project_rewards`). The actual
 * spend + project creation are both server-side and atomic; this component only
 * triggers them and refreshes.
 */
export function CustomProjectRewardCard({
  availableCoins,
  onRedeemed,
}: {
  availableCoins: number;
  onRedeemed?: () => void;
}) {
  const { user } = useAuth();
  const toast = useToast();
  const [reward, setReward] = useState<CustomProjectReward | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!user?.id) {
      setLoading(false);
      return;
    }
    try {
      setReward(await fetchCustomProjectReward(user.id));
    } catch {
      // Keep the last known state; the redeem action surfaces real errors.
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!user?.id) return;
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [user?.id, refresh]);

  const handleRedeem = async () => {
    setBusy(true);
    try {
      await redeemGrowCoinsForCustomProject(newCoinRequestKey());
      toast.success('Reward unlocked', '100 Grow Coins redeemed. Post your custom project now.');
      await refresh();
      onRedeemed?.();
    } catch (error) {
      toast.error('Redemption failed', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const unused = reward?.status === 'unused';

  return (
    <section className="rounded-2xl border border-violet-200 bg-gradient-to-br from-violet-50 to-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-violet-100 text-violet-700">
            <Sparkles className="h-5 w-5" />
          </div>
          <div>
            <h3 className="font-display text-base font-bold text-slate-900">Custom project reward</h3>
            <p className="mt-0.5 text-xs leading-relaxed text-slate-600">
              Redeem <span className="font-bold">{CUSTOM_PROJECT_REWARD_COST} Grow Coins</span> for one
              custom project posting. The reward is spent by the project you post — it cannot be reused.
            </p>
          </div>
        </div>
        <GrowCoinIcon size={28} />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {loading ? (
          <span className="inline-flex items-center gap-2 text-xs font-semibold text-slate-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking your reward…
          </span>
        ) : unused ? (
          <>
            <Link
              to="/client/post?custom=1"
              className="inline-flex items-center gap-2 rounded-xl bg-violet-700 px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-violet-800"
            >
              <CheckCircle2 className="h-4 w-4" /> Post custom project
            </Link>
            <span className="text-xs font-semibold text-emerald-700">1 reward available</span>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => void handleRedeem()}
              disabled={busy || availableCoins < CUSTOM_PROJECT_REWARD_COST}
              className="inline-flex items-center gap-2 rounded-xl bg-violet-700 px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-violet-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              Redeem {CUSTOM_PROJECT_REWARD_COST} coins
            </button>
            <span className="text-xs text-slate-500">
              {availableCoins < CUSTOM_PROJECT_REWARD_COST
                ? `You need ${CUSTOM_PROJECT_REWARD_COST - availableCoins} more available coins.`
                : 'One redemption = one project posting.'}
            </span>
          </>
        )}
      </div>
    </section>
  );
}

export default CustomProjectRewardCard;
