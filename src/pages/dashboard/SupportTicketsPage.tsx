import { InfoTip } from '../../components/InfoTip';
import { PageSkeleton } from '../../components/PageSkeleton';
import { useState, useEffect, useCallback } from 'react';
import {
  Headphones, Plus, ChevronDown, ChevronUp, MessageSquare,
  Clock, CheckCircle2, AlertCircle, Send, LifeBuoy, Loader2, Mail,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useProStatus } from '../../hooks/useProStatus';
import { ticketService, type SupportTicket, type TicketCategory, type TicketPriority, type TicketMessage } from '../../lib/supportTicketService';

const CATEGORIES: { value: TicketCategory; label: string; desc: string }[] = [
  { value: 'general', label: 'General', desc: 'Platform questions, how-to, general help' },
  { value: 'billing', label: 'Billing', desc: 'Payments, wallet, withdrawals, refunds' },
  { value: 'account', label: 'Account', desc: 'Profile, KYC, login issues, settings' },
  { value: 'technical', label: 'Technical', desc: 'Bugs, errors, something not working' },
  { value: 'dispute', label: 'Dispute Help', desc: 'Help with contract disputes' },
  { value: 'feature_request', label: 'Feature Request', desc: 'Suggest new features or improvements' },
  { value: 'other', label: 'Other', desc: 'Anything else' },
];

const PRIORITIES: { value: TicketPriority; label: string; color: string }[] = [
  { value: 'low', label: 'Low', color: 'bg-slate-100 text-slate-600' },
  { value: 'normal', label: 'Normal', color: 'bg-blue-100 text-blue-700' },
  { value: 'high', label: 'High', color: 'bg-amber-100 text-amber-700' },
  { value: 'urgent', label: 'Urgent', color: 'bg-red-100 text-red-700' },
];

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: typeof Clock }> = {
  open: { label: 'Open', color: 'bg-emerald-100 text-emerald-700', icon: MessageSquare },
  pending: { label: 'Pending', color: 'bg-amber-100 text-amber-700', icon: Clock },
  resolved: { label: 'Resolved', color: 'bg-slate-100 text-slate-600', icon: CheckCircle2 },
  closed: { label: 'Closed', color: 'bg-slate-100 text-slate-500', icon: CheckCircle2 },
};

export default function SupportTicketsPage() {
  const { user } = useAuth();
  const { isPro } = useProStatus();
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [ticketThreads, setTicketThreads] = useState<Record<string, TicketMessage[]>>({});
  const [replyText, setReplyText] = useState('');
  const [threadLoading, setThreadLoading] = useState(false);
  const [threadSending, setThreadSending] = useState(false);
  const [threadError, setThreadError] = useState('');

  // Create form state
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<TicketCategory>('general');
  const [priority, setPriority] = useState<TicketPriority>('normal');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [submitSuccess, setSubmitSuccess] = useState(false);

  const loadTickets = useCallback(async () => {
    if (!user?.id) { setLoading(false); return; }
    setLoading(true);
    const result = await ticketService.getUserTickets(user.id);
    if (result.success) setTickets(result.tickets);
    setLoading(false);
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id) return;
    void loadTickets();
    const channel = ticketService.subscribeToTickets(user.id, () => {
      void loadTickets();
      if (expandedId) void loadThread(expandedId);
    });
    return () => { void channel.unsubscribe(); };
  }, [user?.id, loadTickets, expandedId]);

  // Pro members are escalated server-side on insert; the form default follows
  // so the priority they actually get is the one they can see.
  useEffect(() => {
    if (isPro) setPriority((current) => (current === 'normal' ? 'high' : current));
  }, [isPro]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!user?.id || !subject.trim() || !description.trim()) return;
    setSubmitting(true);
    setSubmitError('');
    setSubmitSuccess(false);

    const result = await ticketService.create({
      userId: user.id,
      userRole: (user.role as 'freelancer' | 'client') || 'freelancer',
      subject: subject.trim(),
      description: description.trim(),
      category,
      priority,
    });

    setSubmitting(false);
    if (result.success) {
      setSubmitSuccess(true);
      setSubject('');
      setDescription('');
      setCategory('general');
      setPriority('normal');
      loadTickets();
      setTimeout(() => { setShowForm(false); setSubmitSuccess(false); }, 2000);
    } else {
      // Surface user-friendly errors
      const err = result.error || 'Failed to create ticket. Please try again.';
      if (err.includes('Failed to send') || err.includes('Edge Function')) {
        setSubmitError('Your ticket was created but we had trouble sending a notification. Our team will still see it.');
      } else {
        setSubmitError(err);
      }
    }
  }

  async function loadThread(ticketId: string) {
    setThreadLoading(true);
    setThreadError('');
    const result = await ticketService.getTicket(ticketId);
    if (result.success) {
      setTicketThreads((current) => ({ ...current, [ticketId]: result.messages || [] }));
      if (result.ticket) setTickets((current) => current.map((item) => item.id === ticketId ? result.ticket! : item));
    } else {
      setThreadError(result.error || 'Could not load this ticket conversation.');
    }
    setThreadLoading(false);
  }

  function toggleExpand(id: string) {
    const next = expandedId === id ? null : id;
    setExpandedId(next);
    setReplyText('');
    setThreadError('');
    if (next) void loadThread(next);
  }

  async function handleReply(ticket: SupportTicket) {
    if (!user?.id || !replyText.trim() || threadSending) return;
    setThreadSending(true);
    setThreadError('');
    const text = replyText.trim();
    if (ticket.status === 'resolved' || ticket.status === 'closed') {
      const reopened = await ticketService.reopenTicket(ticket.id, user.id);
      if (!reopened.success) {
        setThreadError(reopened.error || 'Could not reopen this conversation.');
        setThreadSending(false);
        return;
      }
      setTickets((current) => current.map((item) => item.id === ticket.id ? { ...item, status: 'open' } : item));
    }
    const added = await ticketService.addMessage({ ticketId: ticket.id, userId: user.id, message: text });
    if (!added.success) {
      setThreadError(added.error || 'Your message could not be saved.');
      setThreadSending(false);
      return;
    }
    setReplyText('');
    await loadThread(ticket.id);
    const answer = await ticketService.askAI(ticket);
    setThreadSending(false);
    if (!answer.success) {
      setThreadError(answer.error || 'AI Support is temporarily unavailable. Email growlanzo.own@gmail.com for human help.');
      return;
    }
    await loadThread(ticket.id);
    await loadTickets();
  }

  async function handleResolve(ticket: SupportTicket) {
    if (!user?.id) return;
    const result = await ticketService.resolveTicket(ticket.id, user.id);
    if (!result.success) {
      setThreadError(result.error || 'Could not mark this issue resolved.');
      return;
    }
    await loadTickets();
    await loadThread(ticket.id);
  }

  const isFreelancer = user?.role === 'freelancer';

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-700 flex items-center justify-center">
            <Headphones className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="font-display text-xl font-bold text-slate-900 flex items-center gap-2">Support Tickets <InfoTip title="How support works" text="Create an in-app ticket and Growlanzo AI will work through the issue with you. Your conversation stays saved and updates live; mark it resolved only after the solution works for you. If AI cannot safely handle it, email growlanzo.own@gmail.com. Other support channels are coming soon." /></h1>
            <p className="text-slate-500 text-xs">
              In-app AI support · email fallback · other channels coming soon
              {isPro && (
                <span className="ml-2 font-semibold text-emerald-600">· Priority support active</span>
              )}
            </p>
          </div>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white font-semibold text-sm rounded-xl hover:bg-emerald-700 transition-all"
        >
          <Plus className="w-4 h-4" />
          New Ticket
        </button>
      </div>

      {/* Create Form */}
      {showForm && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-display text-lg font-bold text-slate-900">Create Support Ticket</h2>
            <button onClick={() => setShowForm(false)} className="text-slate-400 hover:text-slate-600">
              <ChevronUp className="w-5 h-5" />
            </button>
          </div>

          {submitSuccess ? (
            <div className="flex items-center gap-3 p-4 bg-emerald-50 rounded-xl border border-emerald-200">
              <CheckCircle2 className="w-5 h-5 text-emerald-600" />
              <span className="text-emerald-700 font-medium">Ticket created successfully!</span>
            </div>
          ) : (
            <form onSubmit={handleCreate} className="space-y-4">
              {submitError && (
                <div className="flex items-center gap-3 p-3 bg-red-50 rounded-xl border border-red-200">
                  <AlertCircle className="w-4 h-4 text-red-500" />
                  <span className="text-sm text-red-700">{submitError}</span>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Subject</label>
                <input
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="Brief description of your issue"
                  required
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Category</label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value as TicketCategory)}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  >
                    {CATEGORIES.map((c) => (
                      <option key={c.value} value={c.value}>{c.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Priority</label>
                  <select
                    value={priority}
                    onChange={(e) => setPriority(e.target.value as TicketPriority)}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  >
                    {PRIORITIES.map((p) => (
                      <option key={p.value} value={p.value}>{p.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Description</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Explain your issue in detail — include any error messages, steps to reproduce, or screenshots if possible"
                  required
                  rows={5}
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent resize-none"
                />
              </div>

              <div className="flex items-center gap-2 pt-2">
                <button
                  type="submit"
                  disabled={submitting || !subject.trim() || !description.trim()}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white font-semibold text-sm rounded-xl hover:bg-emerald-700 transition-all disabled:opacity-50"
                >
                  <Send className="w-4 h-4" />
                  {submitting ? 'Submitting...' : 'Submit Ticket'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="px-4 py-2 border border-slate-200 text-slate-600 font-medium text-sm rounded-xl hover:bg-slate-50 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      {/* Tickets List */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <PageSkeleton showStats={false} cards={false} />
        </div>
      ) : tickets.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-xl border border-slate-200 shadow-sm">
          <div className="w-12 h-12 rounded-xl bg-emerald-100 flex items-center justify-center mx-auto mb-3">
            <LifeBuoy className="w-6 h-6 text-emerald-600" />
          </div>
          <h3 className="font-display text-lg font-bold text-slate-900 mb-1">No tickets yet</h3>
          <p className="text-slate-500 text-xs mb-4 max-w-sm mx-auto">
            {isFreelancer
              ? "You haven't submitted any support tickets. If you need help, click 'New Ticket' above."
              : "You haven't submitted any support tickets. We're here to help — just click 'New Ticket'."}
          </p>
          <button
            onClick={() => setShowForm(true)}
            className="inline-flex items-center gap-3 px-6 py-3 bg-emerald-600 text-white font-semibold rounded-xl hover:bg-emerald-700 transition-all"
          >
            <Plus className="w-4 h-4" /> Create Your First Ticket
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {tickets.map((ticket) => {
            const status = STATUS_CONFIG[ticket.status] || STATUS_CONFIG.open;
            const isExpanded = expandedId === ticket.id;

            return (
              <div
                key={ticket.id}
                className="bg-white rounded-xl border border-slate-200 shadow-sm"
              >
                <button
                  onClick={() => toggleExpand(ticket.id)}
                  className="w-full flex items-center justify-between p-3 text-left hover:bg-slate-50/50 transition-colors"
                >
                  <div className="flex items-center gap-4 min-w-0">
                    <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center flex-shrink-0">
                      <MessageSquare className="w-5 h-5 text-slate-500" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="font-semibold text-slate-900">{ticket.subject}</h3>
                      <div className="flex items-center gap-3 mt-0.5 text-xs text-slate-500">
                        <span className={`px-2 py-0.5 rounded-full font-medium ${status.color}`}>
                          {status.label}
                        </span>
                        <span>•</span>
                        <span>{CATEGORIES.find(c => c.value === ticket.category)?.label || ticket.category}</span>
                        <span>•</span>
                        <span>{new Date(ticket.created_at).toLocaleDateString()}</span>
                      </div>
                    </div>
                  </div>
                  {isExpanded ? (
                    <ChevronUp className="w-5 h-5 text-slate-400 flex-shrink-0" />
                  ) : (
                    <ChevronDown className="w-5 h-5 text-slate-400 flex-shrink-0" />
                  )}
                </button>

                {isExpanded && (
                  <div className="px-4 pb-4 border-t border-slate-100 pt-3 space-y-3">
                    <div className="rounded-xl border border-slate-200 p-3 sm:p-4 bg-slate-50">
                      <p className="text-xs font-semibold text-slate-500 mb-1">Your issue</p>
                      <p className="text-sm text-slate-700 whitespace-pre-wrap break-words">{ticket.description}</p>
                    </div>
                    {threadLoading && !(ticketThreads[ticket.id]?.length) ? (
                      <div className="flex items-center gap-2 text-sm text-slate-500 py-3"><Loader2 className="w-4 h-4 animate-spin" /> Loading conversation…</div>
                    ) : (
                      <div className="space-y-2" aria-live="polite" aria-label="Support conversation">
                        {(ticketThreads[ticket.id] || []).map((message) => (
                          <div key={message.id} className={`max-w-[92%] rounded-xl p-3 ${message.sender_type === 'assistant' ? 'mr-auto bg-emerald-50 border border-emerald-100' : 'ml-auto bg-white border border-slate-200'}`}>
                            <p className="text-[11px] font-semibold text-slate-500 mb-1">{message.sender_type === 'assistant' ? 'Growlanzo AI Support' : message.sender_type === 'support' ? 'Growlanzo Support' : 'You'}</p>
                            <p className="text-sm text-slate-700 whitespace-pre-wrap break-words">{message.message}</p>
                            <time className="block text-[10px] text-slate-400 mt-1">{new Date(message.created_at).toLocaleString()}</time>
                          </div>
                        ))}
                      </div>
                    )}
                    {threadError && (
                      <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 space-y-2">
                        <p>{threadError}</p>
                        <a className="inline-flex items-center gap-1 underline font-semibold" href={`mailto:growlanzo.own@gmail.com?subject=${encodeURIComponent(`Support ticket ${ticket.id.slice(0, 8)}: ${ticket.subject}`)}`}><Mail className="w-3.5 h-3.5" /> Email support</a>
                      </div>
                    )}
                    <form onSubmit={(event) => { event.preventDefault(); void handleReply(ticket); }} className="space-y-2">
                      <label className="sr-only" htmlFor={`reply-${ticket.id}`}>Reply to AI Support</label>
                      <textarea id={`reply-${ticket.id}`} value={replyText} onChange={(event) => setReplyText(event.target.value)} rows={3} maxLength={8000} placeholder="Describe what is still wrong or ask a follow-up question…" className="w-full rounded-xl border border-slate-200 bg-white p-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-y" />
                      <div className="flex flex-wrap items-center gap-2">
                        <button type="submit" disabled={threadSending || !replyText.trim()} className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
                          {threadSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}{threadSending ? 'Getting AI help…' : 'Send to AI Support'}
                        </button>
                        {ticket.status !== 'resolved' && ticket.status !== 'closed' && (
                          <button type="button" onClick={() => void handleResolve(ticket)} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-white"><CheckCircle2 className="w-4 h-4" /> My issue is resolved</button>
                        )}
                      </div>
                      <p className="text-xs text-slate-500">AI cannot access or change your account, payment, or verification. For those issues, email is available now; other channels are coming soon.</p>
                    </form>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                      <span>Created: {new Date(ticket.created_at).toLocaleString()}</span>
                      {ticket.updated_at && <span>Updated: {new Date(ticket.updated_at).toLocaleString()}</span>}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
