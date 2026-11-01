/**
 * Locks the in-app AI support ticket contract (migration
 * 20270208000000_support_ai_message_sender.sql + the ai-ticket-responder Edge
 * Function + SupportTicketsPage).
 *
 * The requirements this guards:
 *  1. Every AI reply is generated FROM the stored ticket conversation and then
 *     saved as an AI-authored message — not returned only to the browser.
 *  2. Replies are written through a service-role-only RPC; the client can never
 *     append a message to a ticket it does not own, and no fake system user row
 *     is invented in `profiles`.
 *  3. The AI never resolves a ticket. Only the user can, after confirming the
 *     fix actually worked — "it says solved" without a real fix is the bug this
 *     whole flow exists to prevent.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const THIS_FILE = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(THIS_FILE), '../..');
const read = (p: string): string => fs.readFileSync(path.join(ROOT, p), 'utf8');

const MIGRATION = 'supabase/migrations/20270208000000_support_ai_message_sender.sql';
const RESPONDER = 'supabase/functions/ai-ticket-responder/index.ts';
const PAGE = 'src/pages/dashboard/SupportTicketsPage.tsx';
const SERVICE = 'src/lib/supportTicketService.ts';
const CHAT = 'src/components/AIChatSupport.tsx';

describe('AI support message persistence migration', () => {
  const sql = read(MIGRATION);

  it('marks AI replies with a constrained sender_type', () => {
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS sender_type');
    expect(sql).toContain("'user', 'assistant', 'support'");
    // Existing rows stay user-authored by default — history is never rewritten.
    expect(sql).toMatch(/sender_type text NOT NULL DEFAULT 'user'/);
  });

  it('exposes append_ai_support_message to the service role only', () => {
    expect(sql).toContain('append_ai_support_message');
    expect(sql).toContain(`coalesce(auth.role(), '') <> 'service_role'`);
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.append_ai_support_message(uuid, uuid, text) FROM PUBLIC, anon, authenticated');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.append_ai_support_message(uuid, uuid, text) TO service_role');
  });

  it('keeps the ticket pending instead of auto-resolving it', () => {
    expect(sql).toMatch(/UPDATE public\.support_tickets\s+SET status = 'pending'/);
    expect(sql).toContain("AND status NOT IN ('resolved', 'closed')");
    expect(sql).not.toMatch(/SET status = 'resolved'/);
  });

  it('verifies the ticket still belongs to the stated owner in the same statement', () => {
    expect(sql).toMatch(/WHERE id = p_ticket_id\s+AND user_id = p_owner_id/);
  });

  it('validates the message length before inserting', () => {
    expect(sql).toContain('length(p_message) > 12000');
    expect(sql).toContain("ERRCODE = '22023'");
  });
});

describe('ai-ticket-responder edge function', () => {
  const source = read(RESPONDER);

  it('authenticates the caller and enforces ticket ownership', () => {
    expect(source).toContain('await supabase.auth.getUser()');
    expect(source).toContain('ticket.user_id !== user.id && !isAdmin');
    expect(source).toContain('status: 403');
    // The caller identity comes from the JWT, never from the request body.
    expect(source).not.toMatch(/body\.(user_id|user_role)\s*\|\|/);
  });

  it('loads the stored conversation before generating the reply', () => {
    expect(source).toContain(".from('ticket_messages')");
    expect(source).toContain(".eq('is_internal', false)");
    expect(source).toContain('generateAIResponse({');
    // The history is passed into the model, so follow-ups are answered in
    // context rather than as fresh one-shot questions.
    expect(source).toMatch(/generateAIResponse\(\{[\s\S]*\}, history, proFlag === true\)/);
  });

  it('never inserts a fake system/support user into profiles', () => {
    expect(source).not.toMatch(/from\('profiles'\)\s*\.\s*insert/);
    expect(source).not.toContain('00000000-0000-0000-0000-000000000000');
  });

  it('persists the AI reply through the service-role-only RPC', () => {
    expect(source).toContain('SUPABASE_SERVICE_ROLE_KEY');
    expect(source).toContain("privileged.rpc('append_ai_support_message'");
    expect(source).toContain('p_owner_id: ticket.user_id');
    expect(source).toContain('saveError');
  });

  it('reports a saved-but-pending status and refuses closed tickets', () => {
    expect(source).toContain("ticket_status: 'pending'");
    expect(source).toMatch(/status === 'resolved' \|\| ticket\.status === 'closed'/);
    expect(source).toContain('status: 409');
  });

  it('degrades honestly when the AI or secrets are unavailable', () => {
    expect(source).toContain('503');
    expect(source).toMatch(/growlanzo\.own@gmail\.com/);
    // Rate limiting fails closed — every call costs real gateway credits.
    expect(source).toContain('increment_rate_limit');
    expect(source).toMatch(/failed closed/);
  });

  it('sanitizes attacker-controlled ticket text before it reaches the model', () => {
    expect(source).toContain('function sanitizeInput');
    expect(source).toContain('sanitizeInput(ticket.subject)');
    expect(source).toContain('sanitizeInput(ticket.description)');
    expect(source).toMatch(/ignore\|disregard\|forget/);
  });
});

describe('SupportTicketsPage conversation flow', () => {
  const page = read(PAGE);
  const service = read(SERVICE);

  it('saves the user message before asking the AI', () => {
    const save = page.indexOf('await ticketService.addMessage(');
    const ask = page.indexOf('await ticketService.askAI(');
    expect(save).toBeGreaterThan(-1);
    expect(ask).toBeGreaterThan(save);
  });

  it('reloads the thread after the AI answers so the reply is visible', () => {
    const ask = page.indexOf('await ticketService.askAI(');
    expect(page.indexOf('await loadThread(ticket.id);', ask)).toBeGreaterThan(ask);
  });

  it('offers a live-refreshing thread for both roles', () => {
    expect(service).toContain('subscribeToTickets');
    expect(page).toContain('ticketService.subscribeToTickets');
  });

  it('lets only the user resolve, and only from the open thread', () => {
    expect(page).toContain('My issue is resolved');
    expect(page).toMatch(/ticket\.status !== 'resolved' && ticket\.status !== 'closed'/);
    expect(page).toContain('ticketService.resolveTicket');
    // The AI path must never call resolve.
    expect(page.indexOf('askAI')).toBeGreaterThan(-1);
    const betweenAskAndResolve = page.slice(page.indexOf('askAI'), page.indexOf('resolveTicket'));
    expect(betweenAskAndResolve).not.toContain('resolve');
  });

  it('keeps a working email fallback and marks other channels as coming soon', () => {
    expect(page).toContain('mailto:growlanzo.own@gmail.com');
    expect(page.toLowerCase()).toContain('coming soon');
    // Email is the current human channel; phone/live-chat must not be claimed.
    expect(page.toLowerCase()).not.toMatch(/call us|live chat now|24\/7 human/);
  });

  it('surfaces the AI failure path without pretending the issue is solved', () => {
    expect(page).toContain('answer.error');
    expect(page).toMatch(/AI Support is temporarily unavailable/);
    // No success toast fires when the AI call fails.
    const failBranch = page.slice(page.indexOf('if (!answer.success)'));
    expect(failBranch.slice(0, 400)).not.toContain('toast.success');
  });
});

describe('AI chat escalates unsolved issues into a saved ticket', () => {
  const chat = read(CHAT);
  const service = read(SERVICE);

  it('offers escalation only after the user says they are still stuck', () => {
    expect(chat).toContain('setStuckAsked(true)');
    expect(chat).toContain('Still not fixed? Open a saved support ticket');
    expect(chat).toMatch(/chatMode === 'support' && stuckAsked && !loading/);
  });

  it('creates the ticket as the signed-in user with the chat transcript', () => {
    expect(chat).toContain('ticketService.create(');
    expect(chat).toContain('userId: user.id');
    expect(chat).toContain('userRole:');
    expect(chat).toContain('${transcript}');
    // The transcript is truncated so a long chat can never exceed row limits.
    expect(chat).toContain('.slice(0, 4000)');
  });

  it('routes the user to the ticket thread of their own role', () => {
    expect(chat).toContain("'/client/support-tickets'");
    expect(chat).toContain("'/dashboard/support-tickets'");
    expect(chat).toContain('Continue in Support Tickets');
  });

  it('never resolves the ticket from the chat and keeps an email fallback visible', () => {
    expect(chat).not.toContain('resolveTicket');
    expect(chat).toContain('mailto:growlanzo.own@gmail.com');
    expect(service).toContain('priority');
  });
});
