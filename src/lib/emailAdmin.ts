/**
 * Client for the `email-admin` edge function.
 *
 * All reads of email_logs go through the edge function because the table is
 * service-role only (recipient addresses are PII). The admin check happens
 * server-side — this module never decides who is an admin.
 */
import { supabase } from './supabase';

const FN = 'email-admin';

export type EmailStatus =
  | 'queued'
  | 'processing'
  | 'sent'
  | 'delivered'
  | 'deferred'
  | 'bounced'
  | 'blocked'
  | 'failed';

export type EmailSenderKey = 'security' | 'support' | 'hello' | 'info';

export interface EmailLogRow {
  id: string;
  recipient_email: string;
  sender_email: string;
  sender_name: string;
  event_type: string;
  subject: string;
  template_id: string | null;
  brevo_message_id: string | null;
  status: EmailStatus;
  error_message: string | null;
  retry_count: number;
  created_at: string;
  sent_at: string | null;
  delivered_at: string | null;
  bounced_at: string | null;
  failed_at: string | null;
}

export interface EmailStats {
  total: number;
  queued: number;
  processing: number;
  sent: number;
  delivered: number;
  deferred: number;
  bounced: number;
  failed: number;
  since: string;
}

export interface SendOutcome {
  ok: boolean;
  status: EmailStatus | 'skipped';
  logId?: string;
  messageId?: string;
  duplicate?: boolean;
  skipped?: boolean;
  error?: string;
}

export interface EmailSenderInfo {
  key: EmailSenderKey;
  name: string;
  email: string;
  configured: boolean;
}

export interface EmailEventInfo {
  event: string;
  sender: EmailSenderKey;
  label: string;
  essential: boolean;
}

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(FN, { method: 'POST', body });
  if (error) {
    // Supabase wraps the function's JSON error body in `context`.
    const ctx = (error as { context?: { body?: string; status?: number } }).context;
    let message = error.message;
    if (ctx?.body) {
      try {
        const parsed = JSON.parse(ctx.body) as { error?: string };
        if (parsed?.error) message = parsed.error;
      } catch {
        /* keep the transport message */
      }
    }
    throw new Error(message);
  }
  const payload = data as { error?: string };
  if (payload?.error) throw new Error(payload.error);
  return data as T;
}

export async function fetchEmailStats(days = 30): Promise<EmailStats> {
  const res = await call<{ stats: EmailStats }>({ action: 'stats', days });
  return res.stats;
}

export interface EmailListFilters {
  recipient?: string;
  event_type?: string;
  sender?: string;
  status?: EmailStatus | '';
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export async function fetchEmailLogs(
  filters: EmailListFilters = {},
): Promise<{ rows: EmailLogRow[]; total: number }> {
  return call<{ rows: EmailLogRow[]; total: number }>({ action: 'list', ...filters });
}

export async function fetchEmailDetail(id: string): Promise<{
  log: EmailLogRow & { metadata?: Record<string, unknown>; last_event_at?: string | null };
  events: Array<{ event: string; event_at: string | null; received_at: string; payload?: Record<string, unknown> }>;
}> {
  return call({ action: 'detail', id });
}

export async function retryEmail(id: string): Promise<SendOutcome> {
  const res = await call<{ outcome: SendOutcome }>({ action: 'retry', id });
  return res.outcome;
}

export async function fetchEmailSenders(): Promise<EmailSenderInfo[]> {
  const res = await call<{ senders: EmailSenderInfo[] }>({ action: 'senders' });
  return res.senders;
}

export async function fetchEmailEvents(): Promise<EmailEventInfo[]> {
  const res = await call<{ events: EmailEventInfo[] }>({ action: 'events' });
  return res.events;
}

/** Send a real test to the calling admin's own address. */
export async function sendTestEmail(params: {
  sender?: EmailSenderKey;
  event?: string;
  idempotencyKey?: string;
}): Promise<{ outcome: SendOutcome; recipient: string }> {
  return call({ action: 'test', ...params });
}
