import { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { useProStatus } from '../hooks/useProStatus';
import { useToast } from './Toast';
import { TipNote } from './TipNote';
import type { SupportOption, SupportTopic } from '../lib/supportTopics';
import { ticketService } from '../lib/supportTicketService';
import {
  Bot,
  Check,
  Copy,
  Globe,
  Headphones,
  Loader2,
  Mail,
  Send,
  Sparkles,
  Trash2,
  User,
} from 'lucide-react';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  isStreaming?: boolean;
}

interface AIChatSupportProps {
  context?: 'freelancer' | 'client';
  title?: string;
  /** Explicit mode override — when set, this takes priority over the
   * 'assistant' → free-typing mode, general help
   * 'support'   → guided topic flow, account/payment help
   * When omitted, defaults to 'assistant'. */
  chatMode?: 'assistant' | 'support';
  /** Preloaded support topics (role-aware). When provided in support mode,
   * the user clicks a topic and follows a guided flow instead of free-typing. */
  supportTopics?: SupportTopic[];
}

export function AIChatSupport({ context = 'freelancer', title = 'AI Assistant', chatMode: explicitMode, supportTopics = [] }: AIChatSupportProps) {
  const { user } = useAuth();
  // Real-time Pro status — Pro freelancers have unlimited AI messages, so the
  // usage meter must NOT render for them (a "0/10" bar would be a lie).
  const { isPro: userIsPro } = useProStatus();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [streamingContent, setStreamingContent] = useState('');
  // Real-time model name — defaults to the configured model, updates live from
  // the AI stream (the edge function relays the actual model on first chunk).
  const [modelName, setModelName] = useState(() => (import.meta.env.VITE_AI_MODEL as string | undefined) || 'Growlanzo AI');
  const toast = useToast();
  const [verifyCta, _setVerifyCta] = useState(false);
  // Escalation: a chat answer that does not fix the issue must not evaporate.
  // After a "still stuck" follow-up, the user can turn the conversation into a
  // saved support ticket that keeps getting worked on.
  const [stuckAsked, setStuckAsked] = useState(false);
  const [escalation, setEscalation] = useState<{ busy: boolean; ticketId: string | null; error: string | null }>({ busy: false, ticketId: null, error: null });
  const [resendingVerification, setResendingVerification] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  // ── Guided support flow state ──
  const [activeTopic, setActiveTopic] = useState<SupportTopic | null>(null);
  const [activeStepIndex, setActiveStepIndex] = useState(0);
  const [flowEnded, setFlowEnded] = useState(false);
  const [guestPrompted, setGuestPrompted] = useState(false);
  // ── AI usage tracking (freelancer free tier only) ──
  const [aiUsage, setAiUsage] = useState<{ used: number; limit: number } | null>(null);

  // ── Chat persistence ──
  // Chat history is saved per-user in localStorage so it survives page
  // refreshes and browser restarts. On first visit we show a time-based greeting.
  //
  // KEY ISOLATION: AI Assistant and AI Support are DIFFERENT chats and must
  // never share history. The key includes both the role (freelancer/client)
  // and the mode (assistant vs support) so the two never cross-contaminate.
  const chatMode = explicitMode || 'assistant';
  // Stable per-render key factory — deps are only the context/mode, so the
  // key never changes identity mid-chat and hooks deps stay clean.
  const CHAT_STORAGE_KEY = useCallback((uid: string) => `growlancer_ai_chat_v2_${context}_${chatMode}_${uid}`, [context, chatMode]);

  useEffect(() => {
    if (!user) return;
    const saved = localStorage.getItem(CHAT_STORAGE_KEY(user.id));
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as Array<{
          id: string;
          role: 'user' | 'assistant';
          content: string;
          timestamp: string;
        }>;
        if (Array.isArray(parsed) && parsed.length > 0) {
          setMessages(parsed.map((m) => ({ ...m, timestamp: new Date(m.timestamp), isStreaming: false })));
          return; // history restored — skip the greeting
        }
      } catch {
        // corrupted history — fall through to greeting
      }
    }
    // ONE friendly welcome message on first visit — no time-of-day greetings
    const name = user.name || user.email?.split('@')[0] || 'there';
    const assistantLabel = chatMode === 'support' ? 'AI support assistant' : 'AI assistant';
    setMessages([
      {
        id: `greeting-${Date.now()}`,
        role: 'assistant',
        content: `Hi ${name}! 👋 I'm your Growlanzo ${assistantLabel}. How can I help you today?`,
        timestamp: new Date(),
      },
    ]);
  }, [user, context, chatMode, CHAT_STORAGE_KEY]);

  // Persist chat history so it survives refreshes. When the chat is emptied
  // (e.g. every message deleted via selection), the saved key is removed so the
  // cleared history doesn't resurrect on the next page load.
  useEffect(() => {
    if (!user) return;
    try {
      if (messages.length === 0) {
        localStorage.removeItem(CHAT_STORAGE_KEY(user.id));
      } else {
        localStorage.setItem(CHAT_STORAGE_KEY(user.id), JSON.stringify(messages));
      }
    } catch {
      // storage unavailable — non-critical
    }
  }, [messages, user, context, chatMode, CHAT_STORAGE_KEY]);

  // Fetch AI usage stats for freelancers (free tier limit display). Exposed as
  // a callback so the meter also refreshes AFTER each message — the server
  // logs usage server-side, and the old mount-only fetch meant the bar never
  // moved while chatting ("rate limit not working in real time").
  const refreshAiUsage = useCallback(async () => {
    // The database is the source of truth (ai_support_entitlement reads the
    // same rows consume_ai_message writes), so the meter can never drift from
    // what the edge function will actually allow.
    if (!user || context === 'client') return;
    try {
      const { data, error } = await supabase.rpc('ai_support_entitlement' as any);
      if (error) throw error;
      const row = (data || {}) as Record<string, unknown>;
      if (row.unlimited === true) {
        setAiUsage(null); // Pro — unlimited is unlimited; a meter would be a lie
        return;
      }
      setAiUsage({
        used: Number(row.used) || 0,
        limit: Number(row.limit) || 10,
      });
    } catch (err) {
      console.error('Failed to fetch AI usage:', err);
    }
  }, [user, context]);

  useEffect(() => {
    void refreshAiUsage();
  }, [refreshAiUsage]);

  // Real-time quota: every AI message writes a usage_logs row and a Pro upgrade
  // rewrites the subscription. Subscribing here is what makes the meter move
  // the moment either happens — the old mount-only fetch meant the bar never
  // updated while chatting ("limit not working in real time").
  useEffect(() => {
    if (!user?.id || context === 'client') return;
    const channel = supabase
      .channel(`ai-usage-${context}-${user.id}-${Date.now()}-${Math.random().toString(36).slice(2)}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'usage_logs', filter: `user_id=eq.${user.id}` },
        () => void refreshAiUsage()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'subscriptions', filter: `user_id=eq.${user.id}` },
        () => void refreshAiUsage()
      )
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [user?.id, context, refreshAiUsage]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent]);

  // Cleanup abort controller on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  const handleCopy = async (content: string, id: string) => {
    await navigator.clipboard.writeText(content);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // ── Chat management: clear chat / delete selected messages ──
  const handleToggleSelectionMode = () => {
    setSelectionMode((prev) => !prev);
    setSelectedIds(new Set());
  };

  const handleToggleMessageSelection = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleDeleteSelected = () => {
    if (selectedIds.size === 0) return;
    setMessages((prev) => prev.filter((m) => !selectedIds.has(m.id)));
    setSelectedIds(new Set());
    setSelectionMode(false);
  };

  const handleClearAllChat = () => {
    setMessages([]);
    setSelectedIds(new Set());
    setSelectionMode(false);
    setStreamingContent('');
    if (user) {
      try {
        localStorage.removeItem(CHAT_STORAGE_KEY(user.id));
      } catch {
        // non-critical
      }
    }
  };

  const getStreamingAIResponse = async (userMessage: string): Promise<void> => {
    if (!user?.id) return;

    const history = messages.slice(-8).map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));
    history.push({ role: 'user', content: userMessage });

    try {
      const authResult = await supabase.auth.getSession();
      const session = authResult.data?.session ?? null;
      if (!session) throw new Error('Not authenticated');

      abortControllerRef.current = new AbortController();

      const response = await fetch(
        `${SUPABASE_URL}/functions/v1/ai-assistant`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
            'Accept': 'text/event-stream',
          },
          body: JSON.stringify({
            user_id: user.id,
            user_role: context,
            messages: history,
            context: chatMode === 'support'
              ? { mode: 'support', topic: activeTopic?.title || undefined }
              : undefined,
          }),
          signal: abortControllerRef.current.signal,
        }
      );

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        // 429 message_limit carries the authoritative used/limit — sync the
        // meter immediately instead of waiting for the next fetch.
        if (data?.code === 'message_limit' && typeof data.used === 'number') {
          setAiUsage({ used: data.used, limit: data.limit ?? 10 });
        }
        throw new Error(data.error || 'Failed to get AI response');
      }

      // Create a streaming message placeholder
      const assistantId = (Date.now() + 1).toString();
      const streamingMsg: Message = {
        id: assistantId,
        role: 'assistant',
        content: '',
        timestamp: new Date(),
        isStreaming: true,
      };
      setMessages((prev) => [...prev, streamingMsg]);
      setStreamingContent('');

      // Read the stream
      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let fullContent = '';
      let buffer = '';

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          // Accept BOTH SSE ('data: {...}') and raw-JSON ('{...}') chunk formats
          const trimmed = line.trim();
          if (!trimmed || trimmed === '[DONE]') continue;
          const jsonStr = trimmed.startsWith('data:') ? trimmed.slice(5).trim() : trimmed;
          if (!jsonStr || jsonStr === '[DONE]') continue;
          try {
            const parsed = JSON.parse(jsonStr);
              if (parsed.model) {
                setModelName(parsed.model);
              }
              // Server sends the authoritative quota in the first frame.
              if (parsed.usage && typeof parsed.usage.used === 'number') {
                setAiUsage(
                  parsed.usage.unlimited
                    ? null
                    : { used: parsed.usage.used, limit: parsed.usage.limit ?? 10 }
                );
              }
              if (parsed.text) {
                fullContent += parsed.text;
                setStreamingContent(fullContent);

                // Update the message with current content for line-by-line effect
                setMessages((prev) =>
                  prev.map((msg) =>
                    msg.id === assistantId
                      ? { ...msg, content: fullContent }
                      : msg
                  )
                );
              }
              if (parsed.warning) {
                fullContent += `\n\n⚠️ ${parsed.warning}`;
                setStreamingContent(fullContent);
                setMessages((prev) =>
                  prev.map((msg) =>
                    msg.id === assistantId
                      ? { ...msg, content: fullContent }
                      : msg
                  )
                );
              }
            } catch {
              // Skip malformed JSON
            }
        }
      }

      // Finalize the message
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === assistantId
            ? { ...msg, content: fullContent, isStreaming: false }
            : msg
        )
      );
      setStreamingContent('');

      // Real-time meter — the server just logged this message; reflect it now
      // instead of waiting for the next mount.
      void refreshAiUsage();

      // ⚠️ Usage is recorded SERVER-SIDE by the ai-assistant edge function (for
      // non-Pro users). Do NOT insert another usage_logs row here — that would
      // double-count free users and make them hit their monthly limit 2× fast.

    } catch (error: any) {
      if (error.name === 'AbortError') return; // User cancelled
      console.error('Error getting AI response:', error);
      toast.error('AI Error', 'Failed to get response. Please try again.');
      let errMsg = error.message || 'Something went wrong';
      if (/localhost|connection refused|econnrefused|fetch failed|temporarily unavailable/i.test(errMsg)) {
        errMsg = 'The AI service is temporarily unavailable. Please try again in a few moments.';
      }
      setMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: `Sorry, I couldn't respond right now: ${errMsg}`,
          timestamp: new Date(),
        },
      ]);
    } finally {
      setStreamingContent('');
      abortControllerRef.current = null;
    }
  };

  const sendText = async (rawText: string) => {
    const text = rawText.trim();
    if (!text || loading) return;
    setSelectionMode(false);
    setSelectedIds(new Set());

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: text,
      timestamp: new Date(),
    };

    // ── GUEST (no account): professional account-creation message — no AI
    // call, no dead end. Applies to the public 24/7 Contact chat.
    if (!user?.id) {
      setMessages((prev) => [
        ...prev,
        userMessage,
        {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: `Thanks for reaching out! 💚 To chat with our 24/7 AI support and get help with your account, please create a **free Growlanzo account** first (it takes under a minute) — or log in if you already have one. Your question matters to us, and we'll be right here waiting.`,
          timestamp: new Date(),
        },
      ]);
      setInput('');
      setGuestPrompted(true);
      return;
    }

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setLoading(true);

    await getStreamingAIResponse(userMessage.content);

    setLoading(false);
  };

  const handleSend = () => {
    // Client-side stop so the user doesn't type a full message the server will
    // refuse. The server remains the enforcement point.
    if (
      chatMode === 'assistant' &&
      context === 'freelancer' &&
      !userIsPro &&
      aiUsage &&
      aiUsage.used >= aiUsage.limit
    ) {
      toast.error(
        'Free AI limit reached',
        'You have used all free AI messages this month. Premium (₹199/month) gives you unlimited AI messages with priority replies.'
      );
      return;
    }
    void sendText(input);
  };

  const supportTicketPath = user?.role === 'client' ? '/client/support-tickets' : '/dashboard/support-tickets';

  const handleOpenTicket = async () => {
    if (!user?.id || escalation.busy || escalation.ticketId) return;
    setEscalation({ busy: true, ticketId: null, error: null });
    const transcript = messages
      .slice(-8)
      .map((m) => `${m.role === 'user' ? 'User' : 'AI'}: ${m.content}`)
      .join('\n\n')
      .slice(0, 4000);
    const result = await ticketService.create({
      userId: user.id,
      userRole: user.role === 'client' ? 'client' : 'freelancer',
      subject: activeTopic ? `Still stuck: ${activeTopic.title}` : 'AI chat follow-up needed',
      description: `Raised from the in-app AI support chat because the issue was not resolved.\n\nConversation so far:\n${transcript}`,
      category: 'technical',
      priority: 'high',
    });
    if (!result.success || !result.ticket) {
      setEscalation({ busy: false, ticketId: null, error: result.error || 'Could not open a ticket. Email growlanzo.own@gmail.com instead.' });
      return;
    }
    setEscalation({ busy: false, ticketId: result.ticket.id, error: null });
    toast.success('Support ticket opened', 'Your conversation was saved — AI will keep working the issue with you there.');
  };

  // ── Guided support flow: pick a topic ──
  const handlePickTopic = (topic: SupportTopic) => {
    if (loading || !user) return;
    setActiveTopic(topic);
    setActiveStepIndex(0);
    setFlowEnded(false);
    const first = topic.steps[0];
    setMessages((prev) => [
      ...prev,
      {
        id: `topic-${topic.id}-${Date.now()}`,
        role: 'assistant',
        content: `${topic.emoji} **${topic.title}**\n\n${first.text}`,
        timestamp: new Date(),
      },
    ]);
  };

  // ── Guided support flow: pick an option ──
  const handlePickOption = (option: SupportOption) => {
    if (!activeTopic || loading) return;
    // User's choice appears in chat
    setMessages((prev) => [
      ...prev,
      {
        id: `opt-${Date.now()}`,
        role: 'user',
        content: option.label,
        timestamp: new Date(),
      },
    ]);

    if (option.done) {
      setFlowEnded(true);
      setMessages((prev) => [
        ...prev,
        {
          id: `done-${Date.now()}`,
          role: 'assistant',
          content: option.done || 'Glad I could help!',
          timestamp: new Date(),
        },
      ]);
      return;
    }
    if (typeof option.next === 'number' && activeTopic.steps[option.next]) {
      const step = activeTopic.steps[option.next];
      setActiveStepIndex(option.next);
      setMessages((prev) => [
        ...prev,
        {
          id: `step-${option.next}-${Date.now()}`,
          role: 'assistant',
          content: step.text,
          timestamp: new Date(),
        },
      ]);
    }
  };

  // ── Resend the email verification link ──
  const handleResendVerification = async () => {
    if (!user?.email || resendingVerification) return;
    setResendingVerification(true);
    try {
      const { error } = await supabase.auth.resend({ type: 'signup', email: user.email });
      if (error) throw error;
      toast.success('Verification Email Sent', 'Check your inbox (and spam folder) for the verification link.');
      setMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: `📧 **Verification email sent to ${user.email}.** Open the link in your inbox to verify, then come back and continue chatting — I'm here to help!`,
        timestamp: new Date(),
      }]);
    } catch (err) {
      console.error('Failed to resend verification:', err);
      toast.error('Failed', 'Could not resend the verification email. Please try again.');
    } finally {
      setResendingVerification(false);
    }
  };



  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Format content with proper line breaks for streaming effect
  const formatContent = (content: string) => {
    // Split by double newlines for paragraphs
    const paragraphs = content.split('\n\n');
    return paragraphs.map((para, i) => {
      // Check if it's a bullet list
      if (para.includes('\n• ') || para.includes('\n- ')) {
        const lines = para.split('\n');
        return (
          <div key={i} className="mb-3 last:mb-0">
            {lines.map((line, j) => {
              if (line.startsWith('• ') || line.startsWith('- ')) {
                return (
                  <div key={j} className="flex items-start gap-3 ml-1 mb-1">
                    <span className="text-emerald-500 mt-1">•</span>
                    <span>{line.substring(2)}</span>
                  </div>
                );
              }
              if (line.startsWith('## ')) {
                return (
                  <h4 key={j} className="font-bold text-slate-800 mb-1 mt-2">
                    {line.substring(3)}
                  </h4>
                );
              }
              return (
                <p key={j} className="mb-1">
                  {line}
                </p>
              );
            })}
          </div>
        );
      }
      // Single line
      return (
        <p key={i} className="mb-2 last:mb-0">
          {para}
        </p>
      );
    });
  };

  return (
    <div className="flex flex-col h-full bg-white rounded-xl border border-slate-200 overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-slate-100 bg-gradient-to-r from-emerald-50 to-teal-50">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-emerald-100 rounded-xl">
              <Bot className="w-5 h-5 text-emerald-600" />
            </div>
            <div>
              <h3 className="font-bold text-slate-900">{title}</h3>
              <p className="text-xs text-slate-500">
                <span className="flex items-center gap-1 text-emerald-600 font-semibold">
                  <Sparkles className="w-3.5 h-3.5" />
                  {modelName}
                </span>
                <span className="mx-2 text-slate-300">·</span>
                <span className="flex items-center gap-1">
                  <Globe className="w-3.5 h-3.5" />
                  Any language
                </span>
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {messages.length > 0 && (
              <button
                onClick={handleToggleSelectionMode}
                title={selectionMode ? 'Cancel selection' : 'Manage / clear chat'}
                className={`p-2 rounded-lg transition-colors ${
                  selectionMode
                    ? 'bg-emerald-100 text-emerald-700'
                    : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100'
                }`}
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
        {chatMode === 'assistant' && (
          <TipNote tone="info" compact className="mt-3">
            This is your <strong>AI Assistant</strong> — great for day-to-day questions about{' '}
            {context === 'freelancer' ? 'proposals, contracts, escrow and growing your business' : 'hiring, contracts, escrow and managing projects'}.
            For account, payment or dispute issues use the <strong>AI Support</strong> chat or tap{' '}
            <strong>AI Support</strong> tab for account, payment or dispute issues — your conversations stay separate and private.
          </TipNote>
        )}
        {chatMode === 'assistant' && context === 'freelancer' && aiUsage && !userIsPro && (
          <div className="flex items-center justify-between mt-2 px-1">
            <div className="flex items-center gap-2">
              <div className="w-full bg-slate-100 rounded-full h-1.5 w-32">
                <div
                  className={`h-1.5 rounded-full transition-all ${aiUsage.used >= aiUsage.limit ? 'bg-red-500' : 'bg-emerald-500'}`}
                  style={{ width: `${Math.min(100, (aiUsage.used / aiUsage.limit) * 100)}%` }}
                />
              </div>
              <span className="text-[10px] text-slate-500 font-medium">
                {aiUsage.used}/{aiUsage.limit} messages this month
              </span>
            </div>
            {aiUsage.used >= aiUsage.limit && (
              <Link to="/dashboard/pro" className="text-[10px] text-emerald-600 font-bold hover:underline">
                Upgrade for unlimited →
              </Link>
            )}
          </div>
        )}
        {chatMode === 'assistant' && userIsPro && (
          <div className="flex items-center gap-1.5 mt-2 px-1 text-[10px] font-bold text-emerald-600">
            <Sparkles className="w-3 h-3" />
            Priority support active — your AI requests are routed to the fastest lane.
          </div>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {messages.length === 0 && chatMode === 'support' && supportTopics.length > 0 && (
          <div className="py-4">
            <div className="text-center mb-3">
              <div className="p-4 bg-emerald-100 rounded-full w-10 h-10 mx-auto mb-2">
                <Headphones className="w-8 h-8 text-emerald-600" />
              </div>
              <h4 className="font-semibold text-slate-900 mb-1">How can we help you today?</h4>
              <p className="text-sm text-slate-500">
                Pick a topic — no typing needed. Every topic takes you through a quick guided flow.
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {supportTopics.map((topic) => (
                <button
                  key={topic.id}
                  onClick={() => handlePickTopic(topic)}
                  className="text-left rounded-xl border border-slate-200 bg-white p-4 hover:border-emerald-300 hover:shadow-sm transition-all group"
                >
                  <div className="flex items-start gap-3">
                    <span className="text-lg leading-none">{topic.emoji}</span>
                    <div className="min-w-0">
                      <p className="font-bold text-slate-900 text-sm group-hover:text-emerald-700 transition-colors">{topic.title}</p>
                      <p className="text-xs text-slate-500 mt-0.5">{topic.description}</p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.length === 0 && !(chatMode === 'support' && supportTopics.length > 0) && (
          <div className="text-center py-12">
            <div className="p-4 bg-emerald-100 rounded-full w-10 h-10 mx-auto mb-2">
              <Sparkles className="w-8 h-8 text-emerald-600" />
            </div>
            <h4 className="font-semibold text-slate-900 mb-2">Ask me anything</h4>
            <p className="text-sm text-slate-500">
              I can help in any language — English, Hindi, Spanish, and more.
              <br />
              {`Ask me about ${context === 'freelancer' ? 'freelancing, projects, or career growth' : 'hiring, project management, or finding talent'}.`}
            </p>
          </div>
        )}

        {messages.map((message) => (
          <div
            key={message.id}
            className={`flex gap-3 items-start ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            {selectionMode && (
              <button
                onClick={() => handleToggleMessageSelection(message.id)}
                className={`mt-1 w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                  selectedIds.has(message.id)
                    ? 'bg-emerald-600 border-emerald-600 text-white'
                    : 'border-slate-300 hover:border-emerald-400'
                }`}
                title={selectedIds.has(message.id) ? 'Remove from selection' : 'Select message'}
              >
                {selectedIds.has(message.id) && <Check className="w-3.5 h-3.5" />}
              </button>
            )}
            {message.role === 'assistant' && (
              <div className="p-2 bg-emerald-100 rounded-xl self-start">
                <Bot className="w-4 h-4 text-emerald-600" />
              </div>
            )}
            <div
              className={`max-w-[80%] rounded-xl px-4 py-3 ${
                message.role === 'user'
                  ? 'bg-emerald-600 text-white'
                  : 'bg-slate-100 text-slate-900'
              }`}
            >
              {message.isStreaming && !message.content ? (
                <div className="flex gap-1 py-1">
                  <div className="w-2 h-2 bg-emerald-500 rounded-full animate-bounce" />
                  <div className="w-2 h-2 bg-emerald-500 rounded-full animate-bounce delay-100" />
                  <div className="w-2 h-2 bg-emerald-500 rounded-full animate-bounce delay-200" />
                </div>
              ) : (
                <div className="text-sm whitespace-pre-wrap">
                  {message.role === 'assistant' ? formatContent(message.content) : message.content}
                </div>
              )}
              <div className="flex items-center justify-between mt-2 pt-2 border-t border-white/10">
                <span className="text-xs opacity-70">
                  {message.isStreaming ? 'Typing...' : message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
                {!message.isStreaming && message.content && (
                  <button
                    onClick={() => handleCopy(message.content, message.id)}
                    aria-label={copiedId === message.id ? 'Copied' : 'Copy message'}
                    className="opacity-70 hover:opacity-100 transition-opacity"
                  >
                    {copiedId === message.id ? (
                      <Check className="w-3.5 h-3.5" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                  </button>
                )}
              </div>
            </div>
            {message.role === 'user' && (
              <div className="p-2 bg-slate-200 rounded-xl self-start">
                <User className="w-4 h-4 text-slate-600" />
              </div>
            )}
          </div>
        ))}

        {/* Guided support flow — clickable options under the last assistant step */}
        {activeTopic && !flowEnded && !loading && (
          <div className="flex flex-wrap gap-3 pl-1">
            {activeTopic.steps[activeStepIndex]?.options.map((opt, idx) => (
              <button
                key={`${activeTopic.id}-${activeStepIndex}-${idx}`}
                onClick={() => handlePickOption(opt)}
                className="px-4 py-2 rounded-full border border-emerald-200 bg-emerald-50/60 text-sm font-medium text-emerald-800 hover:bg-emerald-100 hover:border-emerald-300 transition-all"
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}

        {chatMode === 'support' && activeTopic && flowEnded && !loading && (
          <div className="pl-1">
            <button
              type="button"
              onClick={() => {
                setStuckAsked(true);
                void sendText(
                  `I followed the "${activeTopic.title}" steps above but my issue is not solved yet. Please help me fix it step by step.`
                );
              }}
              className="px-4 py-2 rounded-full border border-emerald-500 bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 transition-all"
            >
              Still stuck? Ask AI Support for a step-by-step fix
            </button>
          </div>
        )}

        {chatMode === 'support' && stuckAsked && !loading && (
          <div className="pl-1 space-y-2">
            {escalation.ticketId ? (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
                Your issue is saved as a support ticket and stays open until <strong>you</strong> confirm it is fixed.{' '}
                <Link to={supportTicketPath} className="font-semibold underline">Continue in Support Tickets →</Link>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => void handleOpenTicket()}
                  disabled={escalation.busy}
                  className="px-4 py-2 rounded-full border border-slate-300 bg-white text-slate-700 text-sm font-semibold hover:bg-slate-50 disabled:opacity-60 inline-flex items-center gap-2"
                >
                  {escalation.busy ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Headphones className="w-4 h-4" aria-hidden="true" />}
                  Still not fixed? Open a saved support ticket
                </button>
                <a href="mailto:growlanzo.own@gmail.com" className="text-xs font-semibold text-emerald-700 underline inline-flex items-center gap-1">
                  <Mail className="w-3.5 h-3.5" aria-hidden="true" /> Email support
                </a>
              </div>
            )}
            {escalation.error && (
              <p className="text-xs text-red-600">{escalation.error}</p>
            )}
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Selection action bar */}
      {selectionMode && (
        <div className="px-6 py-3 border-t border-slate-100 bg-slate-50 flex items-center justify-between gap-3">
          <span className="text-xs font-medium text-slate-500">
            {selectedIds.size > 0
              ? `${selectedIds.size} message${selectedIds.size > 1 ? 's' : ''} selected`
              : 'Select messages to delete'}
          </span>
          <div className="flex items-center gap-3">
            <button
              onClick={handleToggleSelectionMode}
              className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-200 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleDeleteSelected}
              disabled={selectedIds.size === 0}
              className="px-3 py-1.5 text-xs font-medium text-red-600 bg-red-50 hover:bg-red-100 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Delete Selected
            </button>
            <button
              onClick={handleClearAllChat}
              className="px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-100 rounded-lg transition-colors"
            >
              Delete All
            </button>
          </div>
        </div>
      )}

      {/* Input */}
      <div className="p-4 border-t border-slate-100 bg-slate-50">
        {verifyCta && (
          <div className="mb-3">
            <button
              onClick={handleResendVerification}
              disabled={resendingVerification}
              className="w-full flex items-center justify-center gap-3 py-2.5 px-4 border border-amber-300 bg-amber-50 rounded-xl text-xs font-medium text-amber-800 hover:bg-amber-100 transition-all disabled:opacity-50"
            >
              {resendingVerification ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Mail className="w-4 h-4" />
              )}
              {resendingVerification ? 'Sending...' : 'Verify Email & Resend Link'}
            </button>
          </div>
        )}
        {/* Guest CTA — professional account-creation call to action */}
        {guestPrompted && !user && (
          <div className="mb-3 grid grid-cols-2 gap-3">
            <Link
              to="/signup"
              className="flex items-center justify-center gap-1.5 py-2.5 px-4 rounded-xl bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 transition-colors"
            >
              <User className="w-4 h-4" />
              Create Free Account
            </Link>
            <Link
              to="/?modal=login"
              className="flex items-center justify-center gap-1.5 py-2.5 px-4 rounded-xl border border-emerald-300 bg-white text-emerald-700 text-xs font-bold hover:bg-emerald-50 transition-colors"
            >
              Log In
            </Link>
          </div>
        )}
        <div className="flex gap-3">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyPress}
            aria-label="Message to AI support"
            placeholder={!user
              ? 'Type your question — we’ll help you get started...'
              : chatMode === 'support'
                ? 'Tell AI Support what is still wrong…'
                : 'Ask me anything in any language...'}
            className="flex-1 px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all text-sm"
            disabled={loading}
          />
          <button
            onClick={handleSend}
            disabled={loading || !input.trim()}
            aria-label="Send message"
            className="px-4 py-3 bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
