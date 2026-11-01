import { useEffect, useState, useCallback } from 'react';
import { supabase, realtimeChannels } from '../lib/supabase';
import type { Tables } from '../types/supabase';
import { useToast } from '../components/Toast';
import { buildReferralLink, formatReferralCode } from '../lib/referralCode';

export type ReferralLeader = {
  rank: number;
  name: string;
  refs: number;
  avatar: string | null;
  isYou: boolean;
};

/**
 * Referral data for BOTH dashboards (freelancer and client).
 *
 * Three live sources feed one view:
 *   • referral_stats / referrals — the owner's counters and history.
 *   • profiles_private.referral_code — the code itself, so a code issued or
 *     regenerated after the page loaded appears without a refresh.
 *   • get_grow_coin_leaderboard — platform-wide, display-safe ranking.
 *
 * The code is resolved here (not read straight off the auth user) so a stale
 * AuthContext snapshot can never show an empty or old code on either page.
 */
export function useReferralsData(userId?: string, referralCode?: string, userRole?: string) {
  const toast = useToast();
  const [referralStats, setReferralStats] = useState<Tables<'referral_stats'> | null>(null);
  const [referrals, setReferrals] = useState<Tables<'referrals'>[]>([]);
  const [leaders, setLeaders] = useState<ReferralLeader[]>([]);
  const [loading, setLoading] = useState(true);
  const [liveCode, setLiveCode] = useState(() => formatReferralCode(referralCode));
  const [live, setLive] = useState(false);

  const refresh = useCallback(async () => {
    // The leaderboard is platform-wide now; role is kept for call-site
    // compatibility (both referral pages pass it).
    void userRole;
    if (!userId) {
      setLoading(false);
      return;
    }

    try {
      const [{ data: statsData }, { data: referralsData }, { data: board }] = await Promise.all([
        supabase.from('referral_stats').select('*').eq('user_id', userId).maybeSingle(),
        supabase.from('referrals').select('*').eq('referrer_id', userId).order('created_at', { ascending: false }),
        // Public leaderboard RPC: counts PAID referral bonuses (i.e. referrals
        // that reached real engagement), not signups, and returns only the
        // display-safe fields. It can never leak email/phone/balances.
        (supabase.rpc as any)('get_grow_coin_leaderboard', { p_limit: 10 }),
      ]);

      if (statsData) setReferralStats(statsData);
      setReferrals(referralsData || []);

      const mapped: ReferralLeader[] = (board || []).map((row: any) => ({
        rank: Number(row.rank) || 0,
        name: String(row.display_name || 'Growlanzo member'),
        refs: Number(row.referrals) || 0,
        avatar: (row.avatar as string | null) ?? null,
        isYou: row.is_self === true,
      }));

      // If the signed-in user is outside the top 10, keep one honest row with
      // their real successful-referral count so the page never hides them.
      if (!mapped.some((l) => l.isYou) && statsData) {
        const yourRefs = Number(statsData.valid_referrals) || 0;
        if (yourRefs > 0) {
          mapped.push({
            rank: mapped.length + 1,
            name: 'You',
            refs: yourRefs,
            avatar: null,
            isYou: true,
          });
        }
      }

      setLeaders(mapped.sort((a, b) => b.refs - a.refs).map((l, i) => ({ ...l, rank: i + 1 })));
    } catch (e) {
      console.error('[useReferralsData]', e);
      toast.error('Error', 'Failed to load referral data. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [userId, userRole, toast]);

  // Keep the code in step with the auth snapshot when it arrives/changes.
  useEffect(() => {
    const fromAuth = formatReferralCode(referralCode);
    if (fromAuth && fromAuth !== '…') {
      setLiveCode((current) => current || fromAuth);
    }
  }, [referralCode]);

  // Resolve the code from the source of truth and keep it live.
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;

    const apply = (value?: string | null) => {
      const formatted = formatReferralCode(value);
      if (!cancelled && formatted) setLiveCode(formatted);
    };

    const resolve = async () => {
      const { data, error } = await supabase
        .from('profiles_private')
        .select('referral_code')
        .eq('id', userId)
        .maybeSingle();
      if (error) return; // fall back to the auth snapshot already on screen
      apply(data?.referral_code);
    };

    void resolve();

    const codeChannel = realtimeChannels
      .profilesPrivate(`referral-code-${userId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'profiles_private', filter: `id=eq.${userId}` },
        (payload) => apply((payload.new as { referral_code?: string } | null)?.referral_code)
      )
      .subscribe((status) => {
        if (!cancelled) setLive(status === 'SUBSCRIBED');
      });

    return () => {
      cancelled = true;
      void codeChannel.unsubscribe();
    };
  }, [userId]);

  useEffect(() => {
    void refresh();
    if (!userId) return;

    const statsCh = realtimeChannels
      .referralStats(`referral-stats-${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'referral_stats', filter: `user_id=eq.${userId}` },
        () => void refresh()
      )
      .subscribe();

    const refCh = realtimeChannels
      .referrals(`referrals-${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'referrals', filter: `referrer_id=eq.${userId}` },
        () => void refresh()
      )
      .subscribe();

    // Coin awards (KYC 5+5, per-project 5+5) land in the ledger/event tables,
    // not in `referrals`. Without these two channels the counters stayed stale
    // until a manual refresh even though the money-side rows were written.
    const rewardCh = supabase
      .channel(`referral-rewards-${userId}-${Date.now()}-${Math.random().toString(36).slice(2)}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'referral_project_reward_events' },
        () => void refresh()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'grow_coin_ledger', filter: `user_id=eq.${userId}` },
        () => void refresh()
      )
      .subscribe();

    return () => {
      void statsCh.unsubscribe();
      void refCh.unsubscribe();
      void supabase.removeChannel(rewardCh);
    };
  }, [userId, refresh]);

  const referralLink = liveCode ? buildReferralLink(liveCode) : '';

  return { referralStats, referrals, leaders, loading, referralCode: liveCode, referralLink, live, refresh };
}
