import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BadgeCheck,
  CheckCircle2,
  Loader2,
  Mail,
  Phone,
  RefreshCw,
  Search,
  Shield,
  ShieldCheck,
  Sparkles,
  User,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { adminQuery, adminUpdate } from '../../lib/adminDataProxy';
import { useToast } from '../../components/Toast';
import { ConfirmModal } from '../../components/ConfirmModal';

/**
 * Account-verification console (Beta).
 *
 * This screen is about ACCOUNT verification and nothing else: legal name,
 * confirmed email and a phone number confirmed with a platform-issued one-time
 * code — see supabase/migrations/20270404000000_platform_kyc_email_phone.sql.
 *
 * Full KYC (document / government-ID verification) is DEFERRED for the Beta
 * (`KYC_VERIFICATION_ENABLED = false` in src/lib/featureFlags.ts): there is no
 * document upload, no PAN/Aadhaar/GST collection and no external KYC provider.
 * Never present the phone code below as a KYC check.
 *
 * This screen is read-mostly: it lists every account with its derived status and
 * lets an admin (a) switch the development code-delivery mode and (b) mark an
 * account verified manually after an out-of-band check.
 */

type Row = {
  id: string;
  name: string | null;
  role: string | null;
  verification_status: string | null;
  kyc_name: string | null;
  phone_verified_at: string | null;
  kyc_method: string | null;
  kyc_last_checked_at: string | null;
};

type Filter = 'all' | 'verified' | 'pending' | 'unverified';

function formatDate(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

const STATUS_STYLES: Record<string, string> = {
  verified: 'bg-emerald-500/10 text-emerald-400',
  pending: 'bg-amber-500/10 text-amber-400',
  rejected: 'bg-red-500/10 text-red-400',
  unverified: 'bg-slate-500/10 text-slate-400',
};

export function AdminIdentityVerificationPage() {
  const toast = useToast();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [devMode, setDevMode] = useState<boolean | null>(null);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [actionId, setActionId] = useState<string | null>(null);
  const [confirmRow, setConfirmRow] = useState<Row | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await adminQuery<Row>({
        table: 'profiles',
        select:
          'id,name,role,verification_status,kyc_name,phone_verified_at,kyc_method,kyc_last_checked_at',
        order: 'created_at',
        orderDir: 'desc',
        limit: 500,
      });
      setRows(data || []);
    } catch (error) {
      toast.error(
        'Could not load verification records',
        error instanceof Error ? error.message : 'Please try again.'
      );
    } finally {
      setLoading(false);
    }
  }, [toast]);

  const loadSettings = useCallback(async () => {
    try {
      const { data } = await (supabase.rpc as any)('admin_get_platform_kyc_settings');
      const result = (data || {}) as { success?: boolean; dev_mode?: boolean };
      if (result.success) setDevMode(!!result.dev_mode);
    } catch {
      setDevMode(null);
    }
  }, []);

  useEffect(() => {
    void load();
    void loadSettings();
  }, [load, loadSettings]);

  const toggleDevMode = async () => {
    if (devMode === null) return;
    setSettingsBusy(true);
    try {
      const { data } = await (supabase.rpc as any)('admin_set_platform_kyc_dev_mode', {
        p_enabled: !devMode,
      });
      const result = (data || {}) as { success?: boolean; dev_mode?: boolean; error?: string };
      if (!result.success) {
        toast.error('Could not change delivery mode', result.error || 'Please try again.');
        return;
      }
      setDevMode(!!result.dev_mode);
      toast.success(
        result.dev_mode ? 'Development code delivery ON' : 'Development code delivery OFF',
        result.dev_mode
          ? 'The verification screen shows the one-time code. Use only before an SMS channel is connected.'
          : 'Codes are no longer returned by the API.'
      );
    } catch (error) {
      toast.error(
        'Could not change delivery mode',
        error instanceof Error ? error.message : 'Please try again.'
      );
    } finally {
      setSettingsBusy(false);
    }
  };

  const markVerified = async (row: Row) => {
    setActionId(row.id);
    try {
      await adminUpdate('profiles', row.id, {
        verification_status: 'verified',
        kyc_verified_at: new Date().toISOString(),
        phone_verified_at: row.phone_verified_at || new Date().toISOString(),
        kyc_method: row.kyc_method || 'admin_manual',
        kyc_last_checked_at: new Date().toISOString(),
      });
      toast.success('Marked verified', row.name || row.id);
      setConfirmRow(null);
      await load();
    } catch (error) {
      toast.error(
        'Could not update the account',
        error instanceof Error ? error.message : 'Please try again.'
      );
    } finally {
      setActionId(null);
    }
  };

  const stats = useMemo(() => {
    const verified = rows.filter((r) => r.verification_status === 'verified').length;
    const pending = rows.filter((r) => r.verification_status === 'pending').length;
    return { verified, pending, unverified: rows.length - verified - pending, total: rows.length };
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (filter !== 'all' && (row.verification_status || 'unverified') !== filter) return false;
      if (!q) return true;
      return (
        (row.name || '').toLowerCase().includes(q) ||
        (row.kyc_name || '').toLowerCase().includes(q) ||
        row.id.toLowerCase().includes(q)
      );
    });
  }, [rows, filter, search]);

  return (
    <div className="space-y-8 pb-20 lg:pb-0">
      <div>
        <h1 className="font-display text-2xl font-bold text-white">Account Verification</h1>
        <p className="mt-1 text-sm text-slate-400">
          Beta account verification: legal name, confirmed email and a platform-issued phone
          code. No external provider and no document upload. Full KYC is deferred and shown to
          users as Coming Soon.
        </p>
      </div>

      {/* Delivery mode */}
      <div
        className="rounded-[2rem] p-6"
        style={{ background: '#1E293B', border: '1px solid rgba(255,255,255,0.05)' }}
      >
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="flex items-start gap-3">
            <div className="shrink-0 rounded-xl bg-emerald-500/10 p-2.5">
              <Sparkles className="h-5 w-5 text-emerald-400" />
            </div>
            <div>
              <h2 className="flex items-center gap-2 text-sm font-bold text-white">
                Development code delivery
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                    devMode ? 'bg-amber-500/15 text-amber-400' : 'bg-emerald-500/15 text-emerald-400'
                  }`}
                >
                  {devMode === null ? 'Unknown' : devMode ? 'On' : 'Off'}
                </span>
              </h2>
              <p className="mt-1 max-w-2xl text-xs text-slate-400">
                While no SMS channel is connected, the platform shows the one-time code on the
                verification screen and returns it from <code>request_phone_otp</code>. Turn this
                off once an SMS provider exists — the code is then never returned by the API.
                Codes are always hashed at rest, single-use, valid for 10 minutes and rate-limited
                to one request per minute.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void toggleDevMode()}
            disabled={settingsBusy || devMode === null}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-white/5 px-5 py-2.5 text-sm font-bold text-slate-200 transition-colors hover:bg-white/10 disabled:opacity-50"
          >
            {settingsBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
            {devMode ? 'Turn off dev delivery' : 'Turn on dev delivery'}
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {[
          { label: 'Verified', value: stats.verified, color: 'text-emerald-400', icon: BadgeCheck },
          { label: 'Pending', value: stats.pending, color: 'text-amber-400', icon: Shield },
          { label: 'Unverified', value: stats.unverified, color: 'text-slate-300', icon: User },
          { label: 'Total', value: stats.total, color: 'text-slate-100', icon: ShieldCheck },
        ].map((stat) => (
          <div
            key={stat.label}
            className="rounded-2xl p-5"
            style={{ background: '#1E293B', border: '1px solid rgba(255,255,255,0.05)' }}
          >
            <div className="mb-3 flex items-center justify-between">
              <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500">
                {stat.label}
              </p>
              <stat.icon className={`h-4 w-4 ${stat.color}`} />
            </div>
            <p className={`text-2xl font-bold ${stat.color}`}>
              {loading ? <Loader2 className="inline h-5 w-5 animate-spin" /> : stat.value}
            </p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div
        className="flex flex-col gap-4 rounded-2xl p-4 sm:flex-row sm:items-center sm:justify-between"
        style={{ background: '#1E293B', border: '1px solid rgba(255,255,255,0.05)' }}
      >
        <div className="flex flex-wrap items-center gap-1">
          {(['all', 'verified', 'pending', 'unverified'] as Filter[]).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className={`rounded-lg px-3 py-1.5 text-[10px] font-bold uppercase transition-colors ${
                filter === key ? 'bg-emerald-500/10 text-emerald-400' : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              {key}
            </button>
          ))}
        </div>
        <div className="flex w-full items-center gap-3 sm:w-auto">
          <div className="relative flex-1 sm:min-w-[220px]">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by name or user ID…"
              className="w-full rounded-lg border border-white/5 bg-slate-800/50 py-2 pl-9 pr-3 text-sm text-slate-300 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
            />
          </div>
          <button
            type="button"
            onClick={() => void load()}
            className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-[10px] font-bold text-slate-400 transition-colors hover:bg-white/5 hover:text-white"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Table */}
      <div
        className="overflow-hidden rounded-[2rem]"
        style={{ background: '#1E293B', border: '1px solid rgba(255,255,255,0.05)' }}
      >
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-white/5 text-[10px] font-bold uppercase tracking-widest text-slate-500">
                <th className="px-6 py-4">Account</th>
                <th className="px-6 py-4">Criteria</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4">Last checked</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center">
                    <Loader2 className="mx-auto h-6 w-6 animate-spin text-slate-500" />
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-xs text-slate-500">
                    No accounts match this filter.
                  </td>
                </tr>
              ) : (
                filtered.map((row) => {
                  const status = row.verification_status || 'unverified';
                  return (
                    <tr key={row.id} className="transition-colors hover:bg-white/[0.02]">
                      <td className="px-6 py-4">
                        <p className="flex items-center gap-2 text-sm font-bold text-white">
                          {row.name || row.kyc_name || 'Unnamed account'}
                          {status === 'verified' && <BadgeCheck className="h-3.5 w-3.5 text-emerald-400" />}
                        </p>
                        <p className="mt-0.5 text-[10px] uppercase tracking-wide text-slate-500">
                          {row.role || 'unknown'} · {row.id.slice(0, 8)}…
                        </p>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-400">
                          <span className="inline-flex items-center gap-1">
                            <User className="h-3.5 w-3.5" /> {row.kyc_name ? 'Name' : 'Name —'}
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <Mail className="h-3.5 w-3.5" /> Email
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <Phone className="h-3.5 w-3.5" /> {row.phone_verified_at ? 'Phone' : 'Phone —'}
                          </span>
                        </div>
                        {row.kyc_method && (
                          <p className="mt-1 text-[10px] text-slate-500">method: {row.kyc_method}</p>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                            STATUS_STYLES[status] || STATUS_STYLES.unverified
                          }`}
                        >
                          {status}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-xs text-slate-400">
                        {formatDate(row.kyc_last_checked_at)}
                      </td>
                      <td className="px-6 py-4 text-right">
                        {status === 'verified' ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-400">
                            <CheckCircle2 className="h-3.5 w-3.5" /> Verified
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmRow(row)}
                            disabled={actionId === row.id}
                            className="rounded-lg px-3 py-1.5 text-[10px] font-bold text-emerald-400 transition-colors hover:bg-emerald-500/10 disabled:opacity-50"
                          >
                            {actionId === row.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              'Mark verified'
                            )}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {confirmRow && (
        <ConfirmModal
          isOpen
          onClose={() => setConfirmRow(null)}
          onConfirm={() => void markVerified(confirmRow)}
          title="Mark this account verified?"
          message={`${confirmRow.name || confirmRow.id} will be marked verified with method "admin_manual". Only do this after an out-of-band identity check — it marks the account verified for the Beta (account verification only — no KYC check is implied).`}
          variant="warning"
          confirmLabel="Mark verified"
        />
      )}
    </div>
  );
}
