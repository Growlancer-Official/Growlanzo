import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Loader2,
  Mail,
  RefreshCw,
  Search,
  Send,
  CheckCircle,
  AlertOctagon,
  Ban,
  Eye,
  Inbox,
} from 'lucide-react';
import {
  fetchEmailStats,
  fetchEmailLogs,
  fetchEmailDetail,
  retryEmail,
  fetchEmailSenders,
  fetchEmailEvents,
  sendTestEmail,
  type EmailLogRow,
  type EmailStats,
  type EmailSenderInfo,
  type EmailEventInfo,
  type EmailSenderKey,
  type EmailStatus,
} from '../../lib/emailAdmin';
import { useToast } from '../../components/Toast';

const PAGE_SIZE = 25;

const STATUS_ORDER: EmailStatus[] = [
  'delivered',
  'sent',
  'queued',
  'processing',
  'deferred',
  'bounced',
  'blocked',
  'failed',
];

function statusClasses(status: string): string {
  switch (status) {
    case 'delivered':
      return 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20';
    case 'sent':
      return 'bg-sky-500/10 text-sky-600 border-sky-500/20';
    case 'queued':
    case 'processing':
      return 'bg-amber-500/10 text-amber-600 border-amber-500/20';
    case 'deferred':
      return 'bg-orange-500/10 text-orange-600 border-orange-500/20';
    case 'bounced':
    case 'blocked':
      return 'bg-rose-500/10 text-rose-600 border-rose-500/20';
    case 'failed':
      return 'bg-red-500/10 text-red-600 border-red-500/20';
    default:
      return 'bg-slate-500/10 text-slate-600 border-slate-500/20';
  }
}

function fmtTime(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function pct(part: number, total: number): string {
  if (!total) return '0%';
  return `${Math.round((part / total) * 100)}%`;
}

function StatCard({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: string | number;
  hint?: string;
  accent?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-extrabold ${accent ?? 'text-slate-900'}`}>{value}</p>
      {hint ? <p className="mt-0.5 text-[11px] text-slate-500">{hint}</p> : null}
    </div>
  );
}

export function AdminEmailsPage() {
  const toast = useToast();

  const [stats, setStats] = useState<EmailStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);

  const [rows, setRows] = useState<EmailLogRow[]>([]);
  const [total, setTotal] = useState(0);
  const [listLoading, setListLoading] = useState(true);
  const [page, setPage] = useState(0);

  const [recipient, setRecipient] = useState('');
  const [eventType, setEventType] = useState('');
  const [sender, setSender] = useState('');
  const [status, setStatus] = useState<'' | EmailStatus>('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  const [senders, setSenders] = useState<EmailSenderInfo[]>([]);
  const [events, setEvents] = useState<EmailEventInfo[]>([]);

  const [detail, setDetail] = useState<Awaited<ReturnType<typeof fetchEmailDetail>> | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [testSending, setTestSending] = useState<string | null>(null);
  const [testEvent, setTestEvent] = useState('welcome');

  const loadStats = useCallback(async () => {
    setStatsLoading(true);
    try {
      setStats(await fetchEmailStats(30));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not load email stats');
    } finally {
      setStatsLoading(false);
    }
  }, [toast]);

  const loadList = useCallback(async () => {
    setListLoading(true);
    try {
      const res = await fetchEmailLogs({
        recipient: recipient.trim() || undefined,
        event_type: eventType || undefined,
        sender: sender || undefined,
        status: status || undefined,
        from: fromDate ? new Date(fromDate).toISOString() : undefined,
        to: toDate ? new Date(`${toDate}T23:59:59`).toISOString() : undefined,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      });
      setRows(res.rows);
      setTotal(res.total);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not load email logs');
    } finally {
      setListLoading(false);
    }
  }, [recipient, eventType, sender, status, fromDate, toDate, page, toast]);

  const loadMeta = useCallback(async () => {
    try {
      const [senderList, eventList] = await Promise.all([fetchEmailSenders(), fetchEmailEvents()]);
      setSenders(senderList);
      setEvents(eventList);
    } catch {
      // Non-fatal: the table and stats still work without the filter metadata.
    }
  }, []);

  useEffect(() => {
    void loadStats();
    void loadMeta();
  }, [loadStats, loadMeta]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  // Reset to the first page whenever a filter changes.
  useEffect(() => {
    setPage(0);
  }, [recipient, eventType, sender, status, fromDate, toDate]);

  const deliveryRate = useMemo(
    () => (stats ? pct(stats.delivered, Math.max(stats.delivered + stats.bounced + stats.failed, 1)) : '0%'),
    [stats],
  );
  const failureRate = useMemo(
    () => (stats ? pct(stats.failed + stats.bounced, Math.max(stats.total, 1)) : '0%'),
    [stats],
  );

  const openDetail = async (id: string) => {
    setDetailLoading(true);
    try {
      setDetail(await fetchEmailDetail(id));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not load email details');
    } finally {
      setDetailLoading(false);
    }
  };

  const handleRetry = async (row: EmailLogRow) => {
    setRetryingId(row.id);
    try {
      const outcome = await retryEmail(row.id);
      if (outcome.ok) {
        toast.success(`Re-sent to ${row.recipient_email}`);
      } else {
        toast.error(outcome.error ?? 'Retry failed');
      }
      await Promise.all([loadList(), loadStats()]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Retry failed');
    } finally {
      setRetryingId(null);
    }
  };

  const handleTest = async (key: EmailSenderKey) => {
    setTestSending(key);
    try {
      const res = await sendTestEmail({ sender: key });
      if (res.outcome.ok) {
        toast.success(`Test sent from the ${key} identity to ${res.recipient}`);
      } else {
        toast.error(res.outcome.error ?? 'Test send failed');
      }
      await Promise.all([loadList(), loadStats()]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Test send failed');
    } finally {
      setTestSending(null);
    }
  };

  const handleTestEvent = async () => {
    setTestSending('event');
    try {
      const res = await sendTestEmail({ event: testEvent });
      if (res.outcome.ok) {
        toast.success(`Test "${testEvent}" sent to ${res.recipient}`);
      } else {
        toast.error(res.outcome.error ?? 'Test send failed');
      }
      await Promise.all([loadList(), loadStats()]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Test send failed');
    } finally {
      setTestSending(null);
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-extrabold text-slate-900">
            <Mail className="h-5 w-5 text-emerald-600" />
            Emails
          </h1>
          <p className="mt-0.5 text-sm text-slate-500">
            Transactional delivery log — every message the platform sends, with its Brevo status.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            void loadStats();
            void loadList();
          }}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          <RefreshCw className="h-4 w-4" />
          Refresh
        </button>
      </div>

      {/* ── Stats ─────────────────────────────────────────────────────────── */}
      {statsLoading && !stats ? (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading delivery statistics…
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <StatCard label="Total (30d)" value={stats?.total ?? 0} />
          <StatCard label="Queued" value={stats?.queued ?? 0} accent="text-amber-600" />
          <StatCard label="Sent" value={stats?.sent ?? 0} hint="accepted by Brevo" accent="text-sky-600" />
          <StatCard label="Delivered" value={stats?.delivered ?? 0} hint={deliveryRate} accent="text-emerald-600" />
          <StatCard label="Failed" value={stats?.failed ?? 0} hint={failureRate} accent="text-red-600" />
          <StatCard label="Bounced/Blocked" value={stats?.bounced ?? 0} accent="text-rose-600" />
        </div>
      )}

      {/* ── Test console ──────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-bold text-slate-900">Send a test email</h2>
        <p className="mt-0.5 text-xs text-slate-500">
          Test messages always go to your own admin address — never to a customer.
        </p>

        <div className="mt-3 flex flex-wrap gap-2">
          {(['security', 'support', 'hello', 'info'] as EmailSenderKey[]).map((key) => {
            const info = senders.find((s) => s.key === key);
            return (
              <button
                key={key}
                type="button"
                disabled={testSending !== null}
                onClick={() => void handleTest(key)}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                title={info ? info.email : undefined}
              >
                {testSending === key ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Send className="h-3.5 w-3.5" />
                )}
                {key}
                {info && !info.configured ? (
                  <span className="rounded bg-amber-100 px-1 text-[10px] font-bold text-amber-700">default</span>
                ) : null}
              </button>
            );
          })}

          <div className="flex items-center gap-2">
            <select
              value={testEvent}
              onChange={(e) => setTestEvent(e.target.value)}
              className="rounded-lg border border-slate-200 px-2 py-2 text-xs font-semibold text-slate-700"
            >
              {events.map((e) => (
                <option key={e.event} value={e.event}>
                  {e.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={testSending !== null}
              onClick={() => void handleTestEvent()}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {testSending === 'event' ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="h-3.5 w-3.5" />
              )}
              Send template test
            </button>
          </div>
        </div>
      </div>

      {/* ── Filters ───────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-2 rounded-xl border border-slate-200 bg-white p-3 sm:grid-cols-2 lg:grid-cols-6">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
          <input
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            placeholder="Recipient email"
            className="w-full rounded-lg border border-slate-200 py-2 pl-8 pr-2 text-sm text-slate-800"
          />
        </div>

        <select
          value={eventType}
          onChange={(e) => setEventType(e.target.value)}
          className="rounded-lg border border-slate-200 px-2 py-2 text-sm text-slate-800"
        >
          <option value="">All events</option>
          {events.map((e) => (
            <option key={e.event} value={e.event}>
              {e.event}
            </option>
          ))}
        </select>

        <select
          value={sender}
          onChange={(e) => setSender(e.target.value)}
          className="rounded-lg border border-slate-200 px-2 py-2 text-sm text-slate-800"
        >
          <option value="">All senders</option>
          {(senders.length ? senders : []).map((s) => (
            <option key={s.key} value={s.email}>
              {s.email}
            </option>
          ))}
        </select>

        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as '' | EmailStatus)}
          className="rounded-lg border border-slate-200 px-2 py-2 text-sm text-slate-800"
        >
          <option value="">All statuses</option>
          {STATUS_ORDER.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>

        <input
          type="date"
          value={fromDate}
          onChange={(e) => setFromDate(e.target.value)}
          className="rounded-lg border border-slate-200 px-2 py-2 text-sm text-slate-800"
          aria-label="From date"
        />
        <input
          type="date"
          value={toDate}
          onChange={(e) => setToDate(e.target.value)}
          className="rounded-lg border border-slate-200 px-2 py-2 text-sm text-slate-800"
          aria-label="To date"
        />
      </div>

      {/* ── Table ─────────────────────────────────────────────────────────── */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-3 py-2 font-bold">Time</th>
                <th className="px-3 py-2 font-bold">Recipient</th>
                <th className="px-3 py-2 font-bold">Event</th>
                <th className="px-3 py-2 font-bold">Sender</th>
                <th className="px-3 py-2 font-bold">Status</th>
                <th className="px-3 py-2 font-bold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {listLoading ? (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-slate-500">
                    <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-10 text-center text-slate-500">
                    <Inbox className="mx-auto mb-2 h-6 w-6 text-slate-300" />
                    No emails match these filters.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-50">
                    <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-500">
                      {fmtTime(row.created_at)}
                    </td>
                    <td className="px-3 py-2 text-xs font-medium text-slate-800">{row.recipient_email}</td>
                    <td className="px-3 py-2 text-xs text-slate-600">{row.event_type}</td>
                    <td className="px-3 py-2 text-xs text-slate-600">{row.sender_email}</td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${statusClasses(row.status)}`}
                      >
                        {row.status}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => void openDetail(row.id)}
                          className="rounded p-1.5 text-slate-500 hover:bg-slate-100"
                          title="View details"
                        >
                          <Eye className="h-3.5 w-3.5" />
                        </button>
                        {row.status === 'failed' || row.status === 'bounced' ? (
                          <button
                            type="button"
                            disabled={retryingId === row.id}
                            onClick={() => void handleRetry(row)}
                            className="rounded p-1.5 text-emerald-600 hover:bg-emerald-50 disabled:opacity-50"
                            title="Retry"
                          >
                            {retryingId === row.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <RefreshCw className="h-3.5 w-3.5" />
                            )}
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between border-t border-slate-100 px-3 py-2 text-xs text-slate-500">
          <span>
            {total === 0 ? '0 results' : `${page * PAGE_SIZE + 1}–${Math.min((page + 1) * PAGE_SIZE, total)} of ${total}`}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              className="rounded border border-slate-200 px-2 py-1 font-semibold disabled:opacity-40"
            >
              Prev
            </button>
            <span>
              {page + 1} / {totalPages}
            </span>
            <button
              type="button"
              disabled={page + 1 >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="rounded border border-slate-200 px-2 py-1 font-semibold disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      </div>

      {/* ── Detail drawer ─────────────────────────────────────────────────── */}
      {detail || detailLoading ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-5 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-base font-extrabold text-slate-900">Email details</h2>
              <button
                type="button"
                onClick={() => setDetail(null)}
                className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50"
              >
                Close
              </button>
            </div>

            {detailLoading || !detail ? (
              <div className="py-10 text-center">
                <Loader2 className="mx-auto h-5 w-5 animate-spin text-slate-400" />
              </div>
            ) : (
              <div className="mt-4 space-y-4">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <p className="text-[10px] font-bold uppercase text-slate-500">Recipient</p>
                    <p className="text-sm text-slate-800">{detail.log.recipient_email}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase text-slate-500">Status</p>
                    <span
                      className={`mt-0.5 inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${statusClasses(detail.log.status)}`}
                    >
                      {detail.log.status}
                    </span>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase text-slate-500">Sender</p>
                    <p className="text-sm text-slate-800">
                      {detail.log.sender_name} &lt;{detail.log.sender_email}&gt;
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase text-slate-500">Event</p>
                    <p className="text-sm text-slate-800">{detail.log.event_type}</p>
                  </div>
                  <div className="sm:col-span-2">
                    <p className="text-[10px] font-bold uppercase text-slate-500">Subject</p>
                    <p className="text-sm text-slate-800">{detail.log.subject}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase text-slate-500">Created</p>
                    <p className="text-sm text-slate-800">{fmtTime(detail.log.created_at)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase text-slate-500">Delivered</p>
                    <p className="text-sm text-slate-800">{fmtTime(detail.log.delivered_at)}</p>
                  </div>
                  <div className="sm:col-span-2">
                    <p className="text-[10px] font-bold uppercase text-slate-500">Brevo message id</p>
                    <p className="break-all text-xs text-slate-600">{detail.log.brevo_message_id ?? '—'}</p>
                  </div>
                  {detail.log.error_message ? (
                    <div className="sm:col-span-2">
                      <p className="text-[10px] font-bold uppercase text-slate-500">Error</p>
                      <p className="rounded-lg bg-red-50 p-2 text-xs text-red-700">{detail.log.error_message}</p>
                    </div>
                  ) : null}
                </div>

                <div>
                  <p className="mb-1 text-[10px] font-bold uppercase text-slate-500">Delivery events</p>
                  {detail.events.length === 0 ? (
                    <p className="text-xs text-slate-500">
                      No webhook events yet. Set BREVO_WEBHOOK_SECRET and point the Brevo webhook at
                      <span className="font-mono"> /functions/v1/brevo-webhook</span>.
                    </p>
                  ) : (
                    <ul className="space-y-1">
                      {detail.events.map((evt, index) => (
                        <li
                          key={`${evt.event}-${index}`}
                          className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2 text-xs"
                        >
                          <span className="inline-flex items-center gap-2 font-semibold text-slate-700">
                            {evt.event === 'delivered' ? (
                              <CheckCircle className="h-3.5 w-3.5 text-emerald-600" />
                            ) : evt.event.includes('bounce') || evt.event === 'blocked' ? (
                              <Ban className="h-3.5 w-3.5 text-rose-600" />
                            ) : (
                              <AlertOctagon className="h-3.5 w-3.5 text-amber-600" />
                            )}
                            {evt.event}
                          </span>
                          <span className="text-slate-500">{fmtTime(evt.received_at)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
