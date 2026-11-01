import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { safeFormatDate, safeFormatTime, safeFormatDateTime } from '../../utils/date';
import { formatCurrency as libFormatCurrency, currencySymbol } from '../../lib/currency';
import {
  AlertCircle,
  AlertTriangle,
  Briefcase,
  Calendar,
  Check,
  CheckCircle2,
  ClipboardList,
  Clock,
  Download,
  FileCheck,
  FileText,
  Laptop,
  Loader2,
  Lock,
  MessageSquare,
  Paperclip,
  Play,
  Plus,
  RotateCcw,
  Save,
  Send,
  Shield,
  ShieldCheck,
  Star,
  Trash2,
  Upload,
  XCircle,
  X,
} from 'lucide-react';
import { PageSkeleton } from '../../components/PageSkeleton';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../components/Toast';
import { ConfirmModal } from '../../components/ConfirmModal';
import { supabase, realtimeChannels } from '../../lib/supabase';
import { refundService, type RefundRequest } from '../../lib/refundService';
import { revisionService, type RevisionRequest } from '../../lib/revisionService';
import { fileUploadService, type ContractFile } from '../../lib/fileUpload';
import { normalizeEscrow } from '../../lib/contractMilestones';
import { VerifiedBadge } from '../../components/VerifiedBadge';
import { InfoTip } from '../../components/InfoTip';
import { ReviewModal } from '../../components/ReviewModal';
import type { Tables } from '../../types/supabase';

type ContractWithDetails = Tables<'contracts'> & {
  project: Tables<'projects'>;
  client: Tables<'profiles'>;
  escrow?: { id: string; amount: number; status: string }[] | { id: string; amount: number; status: string } | null;
  escrow_funded?: boolean | null;
  freelancer_amount?: number;
  freelancer_started_at?: string | null;
  cancellation_status?: string | null;
  frozen_at?: string | null;
  freeze_reason?: string | null;
};

type Message = Tables<'messages'> & {
  sender: Tables<'profiles'>;
};

interface SharedTask {
  id: string;
  title: string;
  status: 'todo' | 'in_progress' | 'completed';
  created_by: string;
  created_at: string;
}

export function WorkspacePage() {
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const contractId = searchParams.get('contract');
  
  const [contracts, setContracts] = useState<ContractWithDetails[]>([]);
  const [selectedContract, setSelectedContract] = useState<ContractWithDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [sendingMessage, setSendingMessage] = useState(false);
  const [milestones, setMilestones] = useState<Array<{ title: string; description?: string; amount: number; status: string; due_date?: string; delivered_at?: string | null; auto_release_hours?: number | null }>>([]);
  const [pendingCancellation, setPendingCancellation] = useState<RefundRequest | null>(null);
  const [cancellationBusy, setCancellationBusy] = useState(false);
  const [pendingRevision, setPendingRevision] = useState<RevisionRequest | null>(null);
  const [revisionPriceInput, setRevisionPriceInput] = useState('');
  const [revisionBusy, setRevisionBusy] = useState(false);
  const [startBusy, setStartBusy] = useState(false);
  const [declineBusy, setDeclineBusy] = useState(false);
  const [deliverBusy, setDeliverBusy] = useState(false);
  const [contractFiles, setContractFiles] = useState<ContractFile[]>([]);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileDescription, setFileDescription] = useState('');
  const [deleteFileConfirm, setDeleteFileConfirm] = useState<string | null>(null);
  const toast = useToast();
  const navigate = useNavigate();

  // Symmetrical Tab State
  const [activeTab, setActiveTab] = useState<'chat' | 'canvas' | 'milestones'>('chat');
  const [reviewModalOpen, setReviewModalOpen] = useState(false);
  const [reviewedContractIds, setReviewedContractIds] = useState<Set<string>>(new Set());

  // Co-Working Canvas States
  const [taskInput, setTaskInput] = useState('');
  const [notesText, setNotesText] = useState('');
  const [notesSaveStatus, setNotesSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [sharedTasks, setSharedTasks] = useState<SharedTask[]>([]);

  const refreshContract = useCallback(async (id: string) => {
    try {
      const { data, error } = await supabase
        .from('contracts')
        .select(`
          *,
          project:projects(*),
          client:profiles!contracts_client_id_fkey(*),
          escrow:escrow(id, amount, status)
        `)
        .eq('id', id)
        .single();

      if (error) throw error;

      if (data) {
        const typedContract = data as unknown as ContractWithDetails;
        setSelectedContract(typedContract);
        setContracts(prev => prev.map(c => c.id === id ? typedContract : c));
        
        if (typedContract.milestones && Array.isArray(typedContract.milestones)) {
          setMilestones(typedContract.milestones as Array<{ title: string; description?: string; amount: number; status: string; due_date?: string }>);
        }
      }
    } catch (err) {
      toast.error('Error', 'Failed to refresh contract.');
    }
  }, [toast]);

  useEffect(() => {
    if (!user) return;

    const fetchData = async () => {
      try {
        // Fetch active contracts
        const { data: contractsData, error } = await supabase
          .from('contracts')
          .select(`
            *,
            project:projects(*),
            client:profiles!contracts_client_id_fkey(*),
            escrow:escrow(id, amount, status)
          `)
          .eq('freelancer_id', user.id)
          .in('status', ['pending', 'active', 'in_progress', 'disputed', 'completed'])
          .order('created_at', { ascending: false });

        if (error) throw error;

        if (contractsData) {
          const typedContracts = contractsData as unknown as ContractWithDetails[];
          setContracts(typedContracts);
          
          const targetContract = contractId 
            ? typedContracts.find(c => c.id === contractId)
            : typedContracts[0];
          
          if (targetContract) {
            setSelectedContract(targetContract);
            if (targetContract.milestones && Array.isArray(targetContract.milestones)) {
              setMilestones(targetContract.milestones as Array<{ title: string; description?: string; amount: number; status: string; due_date?: string }>);
            }
          }
        }

        setLoading(false);
    } catch (error) {
      toast.error('Error', 'Failed to load workspace data.');
      setLoading(false);
      }
    };

    const timeoutId = setTimeout(() => setLoading(false), 3000);

    fetchData();

    return () => clearTimeout(timeoutId);
  }, [user, contractId, toast]);

  const fetchSharedTasks = useCallback(async () => {
    if (!selectedContract) return;
    try {
      const { data, error } = await supabase
        .from('workspace_tasks')
        .select('id, title, status, created_by, created_at')
        .eq('contract_id', selectedContract.id)
        .order('created_at', { ascending: true });
      if (!error && data) {
        setSharedTasks(data as SharedTask[]);
      }
    } catch (error) {
      toast.error('Error', 'Failed to load shared tasks.');
    }
  }, [selectedContract, toast]);

  const [messagesPage, setMessagesPage] = useState(0);
  const [hasMoreMessages, setHasMoreMessages] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const messagesPageSize = 50;
  const loadMoreMessagesRef = useRef<(() => Promise<void>) | null>(null);

  const fetchSharedNotes = useCallback(async () => {
    if (!selectedContract) return;
    try {
      const { data, error } = await supabase
        .from('workspace_notes')
        .select('content')
        .eq('contract_id', selectedContract.id)
        .maybeSingle();
      if (!error && data) {
        setNotesText(data.content || '');
      } else {
        setNotesText('');
      }
    } catch (error) {
      toast.error('Error', 'Failed to load shared notes.');
      setNotesText('');
    }
  }, [selectedContract, toast]);

  useEffect(() => {
    if (!selectedContract) return;
    void fetchSharedTasks();
    void fetchSharedNotes();
  }, [selectedContract, fetchSharedNotes, fetchSharedTasks]);

  // Subscribe to workspace_tasks and workspace_notes realtime changes
  useEffect(() => {
    if (!selectedContract) return;

    const tasksChannel = supabase
      .channel(`workspace-tasks-${selectedContract.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'workspace_tasks',
          filter: `contract_id=eq.${selectedContract.id}`,
        },
        () => {
          void fetchSharedTasks();
        }
      )
      .subscribe();

    const notesChannel = supabase
      .channel(`workspace-notes-${selectedContract.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'workspace_notes',
          filter: `contract_id=eq.${selectedContract.id}`,
        },
        () => {
          void fetchSharedNotes();
        }
      )
      .subscribe();

    return () => {
      void tasksChannel.unsubscribe();
      void notesChannel.unsubscribe();
    };
  }, [selectedContract, fetchSharedTasks, fetchSharedNotes]);

  // Fetch messages and setup subscriptions
  useEffect(() => {
    if (!selectedContract) return;

    const fetchMessages = async (loadMore = false) => {
      if (loadMore) setLoadingMessages(true);
      try {
        const from = loadMore ? (messagesPage + 1) * messagesPageSize : 0;
        const to = from + messagesPageSize - 1;

        // Fetch most recent messages first, then reverse for display.
        // NOTE: `messages` has THREE FKs to `profiles` (sender_id, receiver_id,
        // typing_user_id), so PostgREST cannot auto-resolve the join — without
        // the explicit FK hint this query throws PGRST201 and the chat fails
        // with "Failed to load messages".
        const { data, error } = await supabase
          .from('messages')
          .select(`
            *,
            sender:profiles!messages_sender_id_fkey(id, name, avatar)
          `)
          .eq('contract_id', selectedContract.id)
          .order('created_at', { ascending: false })
          .range(from, to);

        if (error) throw error;

        if (data) {
          const reversed = (data as unknown as Message[]).reverse();
          if (loadMore) {
            // Dedup by id — realtime may have already delivered some of these
            // messages; never render duplicates when paging back.
            setMessages(prev => {
              const known = new Set(prev.map(m => m.id));
              return [...reversed.filter(m => !known.has(m.id)), ...prev];
            });
          } else {
            setMessages(reversed);
          }
          setHasMoreMessages(data.length === messagesPageSize);
        }
      } catch (error) {
        toast.error('Error', 'Failed to load messages.');
      } finally {
        if (loadMore) setLoadingMessages(false);
      }
    };

    // Store fetchMessages in ref so the button can call it with the latest messagesPage
    loadMoreMessagesRef.current = () => fetchMessages(true);

    fetchMessages();

    // Subscribe to messages
    const channel = realtimeChannels.messages(`workspace-${selectedContract.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `contract_id=eq.${selectedContract.id}`,
        },
        async (payload) => {
          const { data: newMessage } = await supabase
            .from('messages')
            .select(`
              *,
              sender:profiles!messages_sender_id_fkey(id, name, avatar)
            `)
            .eq('id', payload.new.id)
            .single();

          if (newMessage) {
            // Dedup by id — realtime can deliver the same INSERT twice;
            // never append the same message twice.
            const msg = newMessage as unknown as Message;
            setMessages(prev =>
              prev.some(m => m.id === msg.id) ? prev : [...prev, msg]
            );
          }
        }
      )
      .subscribe();

    // Subscribe to contract changes
    const contractSub = realtimeChannels.contracts(`workspace-contract-sub-${selectedContract.id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'contracts',
          filter: `id=eq.${selectedContract.id}`,
        },
        () => {
          void refreshContract(selectedContract.id);
        }
      )
      .subscribe();

    return () => {
      void channel.unsubscribe();
      void contractSub.unsubscribe();
    };
  }, [selectedContract, refreshContract, messagesPage, toast]);

  // Fetch contract files
  useEffect(() => {
    if (!selectedContract) return;

    const fetchFiles = async () => {
      const files = await fileUploadService.getContractFiles(selectedContract.id);
      setContractFiles(files);
    };

    fetchFiles();

    // Subscribe to file updates
    const fileChannel = fileUploadService.subscribeToContractFiles(selectedContract.id, () => {
      void fetchFiles();
    });

    return () => {
      void supabase.removeChannel(fileChannel);
    };
  }, [selectedContract]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || !selectedContract || !user) return;

    setSendingMessage(true);
    
    try {
      // receiver_id must be set so the OTHER party can see + receive the message in realtime
      const receiverId =
        selectedContract.client_id === user.id
          ? selectedContract.freelancer_id
          : selectedContract.client_id;
      const { error } = await supabase
        .from('messages')
        .insert({
          contract_id: selectedContract.id,
          sender_id: user.id,
          receiver_id: receiverId,
          content: newMessage,
          message_type: 'text',
        });

      if (error) throw error;

      setNewMessage('');
    } catch (error) {
      console.error('Error sending message:', error);
      toast.error('Failed to send message. Please try again.');
    } finally {
      setSendingMessage(false);
    }
  };

  const handleFileUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile || !selectedContract) return;

    setUploadingFile(true);

    try {
      const result = await fileUploadService.uploadFile(selectedFile, selectedContract.id, fileDescription);

      if (result.success) {
        setShowUploadModal(false);
        setSelectedFile(null);
        setFileDescription('');
        const updatedFiles = await fileUploadService.getContractFiles(selectedContract.id);
        setContractFiles(updatedFiles);
        toast.success('File uploaded successfully');
      } else {
        toast.error(result.error || 'Failed to upload file');
      }
    } catch (error) {
      toast.error('Upload Error', 'Failed to upload file. Please try again.');
    } finally {
      setUploadingFile(false);
    }
  };

  const handleDeleteFile = async (fileId: string) => {
    const result = await fileUploadService.deleteFile(fileId);
    if (result.success) {
      setContractFiles(prev => prev.filter(f => f.id !== fileId));
      toast.success('File deleted');
    } else {
      toast.error(result.error || 'Failed to delete file');
    }
    setDeleteFileConfirm(null);
  };

  // ─── Refund / Cancellation (freelancer side) ─────────────────
  const loadPendingCancellation = useCallback(async () => {
    if (!selectedContract) return;
    const reqs = await refundService.getRefundRequests(selectedContract.id);
    const pending = reqs.find(r => r.status === 'pending_freelancer') || null;
    setPendingCancellation(pending);
  }, [selectedContract]);

  useEffect(() => {
    if (!selectedContract) return;
    void loadPendingCancellation();
    const channel = supabase
      .channel(`freelancer-refund-${selectedContract.id}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'refund_requests',
        filter: `contract_id=eq.${selectedContract.id}`,
      }, () => { void loadPendingCancellation(); })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [selectedContract, loadPendingCancellation]);

  // ─── Extra Revisions (freelancer side) ────────────────────────
  const loadPendingRevision = useCallback(async () => {
    if (!selectedContract) return;
    const reqs = await revisionService.getForContract(selectedContract.id);
    const pending = reqs.find(r => r.status === 'pending_freelancer') || null;
    setPendingRevision(pending);
    // Prefill the price only when a NEW pending request appears (never clobber
    // the freelancer's own typing — revisionPriceInput is not a dependency).
    if (pending) {
      setRevisionPriceInput(prev => prev === '' ? String(Number(pending.per_revision_price) || '') : prev);
    }
  }, [selectedContract]);

  useEffect(() => {
    if (!selectedContract) return;
    void loadPendingRevision();
    const sub = revisionService.subscribeToContract(selectedContract.id, () => { void loadPendingRevision(); });
    return () => { void supabase.removeChannel(sub.channel); };
  }, [selectedContract, loadPendingRevision]);

  const handleRespondRevision = async (accept: boolean) => {
    if (!pendingRevision) return;
    setRevisionBusy(true);
    const price = accept ? parseFloat(revisionPriceInput) : undefined;
    if (accept && (!Number.isFinite(price) || (price ?? 0) <= 0)) {
      toast.error('Invalid price', 'Enter a valid per-revision price to accept.');
      setRevisionBusy(false);
      return;
    }
    const result = await revisionService.respondToExtraRevision(pendingRevision.id, accept, price);
    if (result.success) {
      setPendingRevision(null);
      setRevisionPriceInput('');
      toast.success(
        accept
          ? 'Revision request accepted — the client will now pay the quoted amount through escrow'
          : 'Revision request declined — the client has been notified'
      );
    } else {
      toast.error(result.error || 'Failed to respond to revision request');
    }
    setRevisionBusy(false);
  };

  const handleRespondCancellation = async (accept: boolean) => {
    if (!pendingCancellation) return;
    setCancellationBusy(true);
    const result = await refundService.respondToCancellation(pendingCancellation.id, accept);
    if (result.success) {
      setPendingCancellation(null);
      toast.success(
        accept
          ? 'Cancellation accepted — remaining escrow will be refunded to the client'
          : 'Cancellation rejected — a dispute has been opened automatically'
      );
      void refreshContract(selectedContract.id);
    } else {
      toast.error(result.error || 'Failed to respond to cancellation');
    }
    setCancellationBusy(false);
  };

  const workStarted = !!selectedContract?.freelancer_started_at;
  const handleStartWork = async () => {
    if (!selectedContract) return;
    setStartBusy(true);
    const result = await refundService.markStarted(selectedContract.id);
    if (result.success) {
      toast.success('Work started — escrow protection is now active');
      void refreshContract(selectedContract.id);
    } else {
      toast.error(result.error || 'Failed to start work');
    }
    setStartBusy(false);
  };

  const handleDeclineProject = async () => {
    if (!selectedContract) return;
    setDeclineBusy(true);
    const result = await refundService.freelancerDecline(selectedContract.id);
    if (result.success) {
      toast.success('Project declined — escrow will be refunded to the client automatically');
      void refreshContract(selectedContract.id);
    } else {
      toast.error(result.error || 'Failed to decline project');
    }
    setDeclineBusy(false);
  };

  /** Milestone-less (full contract) delivery — starts the auto-release timer. */
  const handleContractDeliver = async () => {
    if (!selectedContract) return;
    setDeliverBusy(true);
    const { data, error } = await supabase.rpc('mark_contract_delivered' as any, {
      p_contract_id: selectedContract.id,
    });
    const result = data as { success?: boolean; error?: string; auto_release_hours?: number } | null;
    if (error || !result?.success) {
      toast.error('Delivery failed', result?.error || error?.message || 'Could not mark contract delivered.');
    } else {
      toast.success(
        'Work delivered — auto-release timer started',
        `The client can review and release sooner; if they don't respond within ~${result.auto_release_hours ?? 10} hours, the escrow auto-releases to your wallet.`
      );
      void refreshContract(selectedContract.id);
    }
    setDeliverBusy(false);
  };

  const handleMilestoneStatusChange = async (index: number, newStatus: string) => {
    if (!selectedContract) return;
    if (selectedContract.status === 'disputed') {
      toast.warning('Milestone actions are frozen while this contract is in dispute.');
      return;
    }

    const previousStatus = milestones[index]?.status;

    // First progress = work started (Case 1 -> Case 3 boundary)
    if (!workStarted && ['in_progress', 'completed', 'delivered'].includes(newStatus)) {
      void refundService.markStarted(selectedContract.id);
    }

    // Optimistic update for instant UI feedback
    const updatedMilestones = [...milestones];
    updatedMilestones[index] = { ...updatedMilestones[index], status: newStatus };
    setMilestones(updatedMilestones);

    // 🛡️ Server-validated via the SECURITY DEFINER mark_milestone_status RPC:
    // the caller must be a party to the contract and the contract must not be
    // disputed. Direct contracts.update() fails RLS (contracts has no UPDATE
    // policy) — this RPC is the only sanctioned way to change milestone status.
    const { data, error } = await supabase.rpc('mark_milestone_status', {
      p_contract_id: selectedContract.id,
      p_milestone_index: index,
      p_status: newStatus,
    });

    const result = data as { success?: boolean; error?: string } | null;
    if (error || !result?.success) {
      // Roll back the optimistic update
      const rolledBack = [...milestones];
      if (previousStatus !== undefined) {
        rolledBack[index] = { ...rolledBack[index], status: previousStatus };
        setMilestones(rolledBack);
      }
      toast.error(result?.error || error?.message || 'Failed to update milestone');
    }
  };

  // Live Task Board Handlers
  const getTasks = (): SharedTask[] => sharedTasks;

  const handleAddTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!taskInput.trim() || !selectedContract || !user) return;

    try {
      const { error } = await supabase
        .from('workspace_tasks')
        .insert({
          contract_id: selectedContract.id,
          title: taskInput.trim(),
          status: 'todo',
          created_by: user.id,
        } as any);
      if (!error) {
        setTaskInput('');
        void fetchSharedTasks();
      }
    } catch (err) {
      toast.error('Error', 'Failed to add task.');
    }
  };

  const handleUpdateTaskStatus = async (taskId: string, newStatus: 'todo' | 'in_progress' | 'completed') => {
    try {
      const { error } = await supabase
        .from('workspace_tasks')
        .update({ status: newStatus } as any)
        .eq('id', taskId);
      if (!error) void fetchSharedTasks();
    } catch (err) {
      toast.error('Error', 'Failed to update task.');
    }
  };

  const handleDeleteTask = async (taskId: string) => {
    try {
      const { error } = await supabase
        .from('workspace_tasks')
        .delete()
        .eq('id', taskId);
      if (!error) void fetchSharedTasks();
    } catch (err) {
      toast.error('Error', 'Failed to delete task.');
    }
  };

  // Collaborative Scratchpad Handlers
  const [_isTypingNotes, setIsTypingNotes] = useState(false);
  const notesUpdateTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleNoteChange = (text: string) => {
    setNotesText(text);
    setIsTypingNotes(true);
    setNotesSaveStatus('saving');
    debouncedUpdateNotes(text);
  };

  const debouncedUpdateNotes = useCallback(
    async (text: string) => {
      if (notesUpdateTimeoutRef.current) {
        clearTimeout(notesUpdateTimeoutRef.current);
      }
      notesUpdateTimeoutRef.current = setTimeout(async () => {
        if (selectedContract && user) {
          const { data: existing } = await supabase
            .from('workspace_notes')
            .select('id')
            .eq('contract_id', selectedContract.id)
            .maybeSingle();

          if (existing) {
            await supabase
              .from('workspace_notes')
              .update({ content: text, updated_at: new Date().toISOString() } as any)
              .eq('id', existing.id);
            setNotesSaveStatus('saved');
          } else {
            await supabase
              .from('workspace_notes')
              .insert({ contract_id: selectedContract.id, content: text, created_by: user.id } as any);
            setNotesSaveStatus('saved');
          }
          setTimeout(() => setNotesSaveStatus('idle'), 2000);
        }
        setIsTypingNotes(false);
      }, 1000);
    },
    [selectedContract, user]
  );

  // Chronological event timeline compiler
  const getTimelineEvents = () => {
    if (!selectedContract) return [];
    
    const events: Array<{
      id: string;
      title: string;
      description: string;
      timestamp: string;
      type: 'system' | 'milestone' | 'file' | 'dispute' | 'escrow';
      icon: any;
      color: string;
    }> = [];

    // 1. Contract Started
    events.push({
      id: 'contract-started',
      title: 'Contract Initialized',
      description: `Project kicked off with client ${selectedContract.client?.name || 'Client'}.`,
      timestamp: selectedContract.created_at,
      type: 'system',
      icon: Briefcase,
      color: 'bg-indigo-500 text-white shadow-indigo-100'
    });

    // 2. Milestones completed
    milestones.forEach((m, idx) => {
      if (m.status === 'completed') {
        events.push({
          id: `milestone-completed-${idx}`,
          title: `Milestone Completed`,
          description: `"${m.title}" marked as completed. Amount: ${formatCurrency(m.amount)}.`,
          timestamp: selectedContract.updated_at || selectedContract.created_at,
          type: 'milestone',
          icon: CheckCircle2,
          color: 'bg-emerald-500 text-white shadow-emerald-100'
        });
      }
    });

    // 3. File uploads
    contractFiles.forEach((file) => {
      const isFreelancer = file.uploaded_by === user?.id;
      events.push({
        id: `file-${file.id}`,
        title: `Deliverable Shared`,
        description: `${isFreelancer ? 'You' : 'Client'} uploaded "${file.file_name}" (${fileUploadService.formatFileSize(file.file_size)}). ${file.description || ''}`,
        timestamp: file.created_at,
        type: 'file',
        icon: FileText,
        color: 'bg-blue-500 text-white shadow-blue-100'
      });
    });

    // 4. Escrow status
    const escrowData = selectedContract as { escrow?: { id: string; amount: number; status: string }[] | { id: string; amount: number; status: string } | null };
    const escrow = escrowData.escrow;
    if (escrow) {
      const escrowRow = normalizeEscrow(escrow);
      if (escrowRow) {
        if (escrowRow.status === 'funded') {
          events.push({
            id: 'escrow-funded',
            title: 'Escrow protection active',
            description: `Client funded ${formatCurrency(escrowRow.amount)} in Growlanzo Escrow protection.`,
            timestamp: selectedContract.updated_at || selectedContract.created_at,
            type: 'escrow',
            icon: ShieldCheck,
            color: 'bg-emerald-600 text-white shadow-emerald-100'
          });
        } else if (escrowRow.status === 'released') {
          events.push({
            id: 'escrow-released',
            title: 'Payment Released',
            description: `Growlanzo Escrow released ${formatCurrency(escrowRow.amount)} to your Freelancer Wallet!`,
            timestamp: selectedContract.updated_at || selectedContract.created_at,
            type: 'escrow',
            icon: FileCheck,
            color: 'bg-indigo-600 text-white shadow-indigo-200'
          });
        }
      }
    }

    // 5. Dispute status
    if (selectedContract.status === 'disputed') {
      events.push({
        id: 'dispute-opened',
        title: 'Project In Dispute Resolution',
        description: 'Escrow assets locked. Support team is investigating files and chat transcripts.',
        timestamp: selectedContract.updated_at || selectedContract.created_at,
        type: 'dispute',
        icon: AlertCircle,
        color: 'bg-red-500 text-white animate-pulse shadow-red-100'
      });
    }

    return events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  };

  const formatCurrency = (amount: number) => {
    // NaN-safe — contracts can have null/undefined amounts; never render ₹NaN.
    const safeAmount = Number.isFinite(Number(amount)) ? Number(amount) : 0;
    return libFormatCurrency(safeAmount);
  };

  if (loading) {
    return <PageSkeleton />;
  }

  if (contracts.length === 0) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-1.5">
          <div className="w-10 h-10 bg-gradient-to-br from-emerald-500 to-emerald-600 rounded-xl flex items-center justify-center shadow-lg shadow-emerald-500/20">
            <Briefcase className="w-4 h-4 text-white" />
          </div>
          <div>
            <h1 className="font-display text-xl font-bold text-slate-900 flex items-center gap-2">Workspace <InfoTip title="Workspace overview" text="Your active contracts live here — milestones, deliverables, messaging, escrow payments and file sharing. Each contract is independent; work with multiple clients without any overlap." /></h1>
            <p className="text-slate-500">Manage your active projects</p>
          </div>
        </div>

        <div className="bg-white rounded-xl p-12 border border-slate-100 text-center">
          <div className="w-20 h-20 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-2">
            <Briefcase className="w-7 h-7 text-slate-400" />
          </div>
          <h3 className="font-display text-xl font-bold text-slate-900 mb-2">No Active Contracts</h3>
          <p className="text-slate-500 max-w-md mx-auto mb-3">
            You don't have any active contracts. Submit proposals to get hired and start working!
          </p>
        </div>
      </div>
    );
  }

  if (!selectedContract && contracts.length > 0) {
    return (
      <div className="flex items-center justify-center min-h-[80vh]">
        <Loader2 className="animate-spin h-8 w-8 text-emerald-600" />
      </div>
    )
  }

  return (
    <div className="space-y-1.5">
      {/* Top Banner / Header */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 bg-white/60 backdrop-blur-md border border-slate-100 p-5 rounded-xl shadow-sm">
        <div className="flex items-center gap-1.5 min-w-0">
          <div className="w-10 h-10 bg-gradient-to-br from-emerald-500 to-emerald-600 rounded-xl flex items-center justify-center shadow-lg shadow-emerald-500/20 flex-shrink-0">
            <Briefcase className="w-4 h-4 text-white" />
          </div>
          <div className="min-w-0">
            <h1 className="font-display text-xl font-bold text-slate-900">Collaboration Workspace</h1>
            <p className="text-sm text-slate-500 flex flex-wrap items-center gap-x-1 gap-y-0.5">
              Co-working with <span className="font-semibold text-slate-700 break-words">{selectedContract?.client?.name}</span>
              {(selectedContract?.client as any)?.verification_status === 'verified' && (
                <VerifiedBadge size="xs" className="ml-1.5" tone="blue" />
              )}
              {(() => {
                const esc = normalizeEscrow((selectedContract as any)?.escrow);
                return esc && esc.status === 'funded' ? (
                  <span className="ml-2 inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-100 text-emerald-700 text-xs font-bold rounded-full">
                    <ShieldCheck className="w-3.5 h-3.5" />
                    Verified Payment
                  </span>
                ) : null;
              })()}
            </p>
          </div>
        </div>

        {/* Dynamic Nav Tabs — horizontally scrollable on mobile so the three
            tabs never overflow the viewport */}
        <div className="flex items-center bg-slate-100/80 p-1.5 rounded-xl border border-slate-200/50 self-start lg:self-center max-w-full overflow-x-auto">
          <button
            onClick={() => setActiveTab('chat')}
            className={`flex items-center gap-3 px-4 py-2 text-sm font-medium rounded-lg transition-all duration-200 whitespace-nowrap ${
              activeTab === 'chat'
                ? 'bg-white text-emerald-600 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <MessageSquare className="w-4 h-4 shrink-0" />
            <span>Chat & Assets</span>
          </button>
          
          <button
            onClick={() => setActiveTab('canvas')}
            className={`flex items-center gap-3 px-4 py-2 text-sm font-medium rounded-lg transition-all duration-200 whitespace-nowrap ${
              activeTab === 'canvas'
                ? 'bg-white text-emerald-600 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Laptop className="w-4 h-4" />
            <span>Co-Working Canvas</span>
          </button>

          <button
            onClick={() => setActiveTab('milestones')}
            className={`flex items-center gap-3 px-4 py-2 text-sm font-medium rounded-lg transition-all duration-200 whitespace-nowrap ${
              activeTab === 'milestones'
                ? 'bg-white text-emerald-600 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <ClipboardList className="w-4 h-4" />
            <span>Milestones & Escrow</span>
          </button>
        </div>

        {/* Actions: review / status pills */}
        <div className="flex flex-wrap items-center gap-3">
          {selectedContract?.status === 'completed' &&
            (reviewedContractIds.has(selectedContract.id) ? (
              <span className="inline-flex items-center gap-3 px-4 py-2.5 bg-emerald-50 text-emerald-700 rounded-xl text-sm font-medium">
                <Check className="w-4 h-4" />
                Review Submitted
              </span>
            ) : (
              <button
                onClick={() => setReviewModalOpen(true)}
                className="inline-flex items-center gap-3 px-4 py-2.5 bg-emerald-600 text-white rounded-xl text-sm font-medium hover:bg-emerald-700 transition-colors"
              >
                <Star className="w-4 h-4" />
                Leave Review
              </button>
            ))}
        </div>

        {/* Contract Selector */}
        {contracts.length > 1 && (
          <select
            value={selectedContract?.id || ''}
            onChange={(e) => {
              const contract = contracts.find(c => c.id === e.target.value);
              if (contract) {
                setSelectedContract(contract);
                if (contract.milestones && Array.isArray(contract.milestones)) {
                  setMilestones(contract.milestones as Array<{ title: string; description?: string; amount: number; status: string; due_date?: string }>);
                }
              }
            }}
            className="px-4 py-2.5 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 text-sm"
          >
            {contracts.map((contract) => (
              <option key={contract.id} value={contract.id}>
                {contract.project?.title || 'Project'}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Platform Policy — protect both sides (full-width, client-consistent design) */}
      <div className="rounded-xl overflow-hidden border border-blue-200 shadow-sm">
        <div className="bg-gradient-to-r from-emerald-700 to-teal-700 px-2.5 py-4 flex items-center gap-1.5">
          <div className="w-7 h-7 bg-white/15 rounded-xl flex items-center justify-center shrink-0">
            <Shield className="w-4 h-4 text-white" />
          </div>
          <div>
            <p className="font-bold text-white text-sm">Growlanzo Payment, Refund & Safety Policy</p>
            <p className="text-xs text-emerald-100">Your earnings and work are always protected — everything stays on the platform</p>
          </div>
        </div>
        <div className="bg-blue-50/60 px-2.5 py-4 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
          <div className="flex items-start gap-3.5">
            <div className="w-4 h-4 rounded-full bg-emerald-100 flex items-center justify-center shrink-0 mt-0.5">
              <Shield className="w-4 h-4 text-emerald-600" />
            </div>
            <p className="text-xs text-slate-700 leading-relaxed">
              <span className="font-bold text-slate-900">Escrow Protection + Auto-Release.</span> All payments are
              held in Growlanzo Escrow. When you deliver work, the client can approve and release it — but if they
              don't respond within the review window (default 72h), the funds{' '}
              <span className="font-bold text-emerald-700">auto-release to your wallet automatically</span>. Your
              payment can never be held hostage.
            </p>
          </div>
          <div className="flex items-start gap-3.5">
            <div className="w-4 h-4 rounded-full bg-amber-100 flex items-center justify-center shrink-0 mt-0.5">
              <AlertTriangle className="w-4 h-4 text-amber-600" />
            </div>
            <p className="text-xs text-slate-700 leading-relaxed">
              <span className="font-bold text-slate-900">Never work outside Growlanzo.</span> If a client asks you
              to work or pay outside the platform, refuse and report them immediately.
            </p>
          </div>
          <div className="flex items-start gap-3.5">
            <div className="w-4 h-4 rounded-full bg-red-100 flex items-center justify-center shrink-0 mt-0.5">
              <AlertTriangle className="w-4 h-4 text-red-600" />
            </div>
            <p className="text-xs text-slate-700 leading-relaxed">
              <span className="font-bold text-slate-900">Fraud = Ban.</span> Clients caught paying outside the
              platform or attempting fraud can be{' '}
              <span className="font-bold text-red-600">suspended or permanently banned</span>.
            </p>
          </div>
          <div className="flex items-start gap-3.5">
            <div className="w-4 h-4 rounded-full bg-blue-100 flex items-center justify-center shrink-0 mt-0.5">
              <CheckCircle2 className="w-4 h-4 text-blue-600" />
            </div>
            <p className="text-xs text-slate-700 leading-relaxed">
              <span className="font-bold text-slate-900">Disputes.</span> Have an issue? Raise a dispute or
              refund request from this workspace — our support team resolves it fairly, in real time.
            </p>
          </div>
          <div className="flex items-start gap-3.5">
            <div className="w-4 h-4 rounded-full bg-indigo-100 flex items-center justify-center shrink-0 mt-0.5">
              <RotateCcw className="w-4 h-4 text-indigo-600" />
            </div>
            <p className="text-xs text-slate-700 leading-relaxed">
              <span className="font-bold text-slate-900">Revisions & review.</span> You agree to the included free
              revisions on your service. If the client asks for more, you may charge your published extra-revision
              rate or a mutually agreed price — never work for free beyond the agreed scope.
            </p>
          </div>
          <div className="flex items-start gap-3.5">
            <div className="w-4 h-4 rounded-full bg-red-100 flex items-center justify-center shrink-0 mt-0.5">
              <AlertTriangle className="w-4 h-4 text-red-600" />
            </div>
            <p className="text-xs text-slate-700 leading-relaxed">
              <span className="font-bold text-slate-900">Client offers outside payment? Report them.</span>
              Freelancers who accept off-platform payments also risk{' '}
              <span className="font-bold text-red-600">suspension or permanent ban</span>. Report it from this workspace.
            </p>
          </div>
          <div className="flex items-start gap-3.5">
            <div className="w-4 h-4 rounded-full bg-slate-100 flex items-center justify-center shrink-0 mt-0.5">
              <FileText className="w-4 h-4 text-slate-600" />
            </div>
            <p className="text-xs text-slate-700 leading-relaxed">
              <span className="font-bold text-slate-900">Legal.</span> All payments, refunds and disputes are governed by
              Growlanzo's Terms of Service, Escrow Policy and Refund Policy. These rules apply to every project on the platform.
            </p>
          </div>
          <div className="flex items-start gap-3.5">
            <div className="w-4 h-4 rounded-full bg-emerald-100 flex items-center justify-center shrink-0 mt-0.5">
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
            </div>
            <p className="text-xs text-slate-700 leading-relaxed">
              <span className="font-bold text-slate-900">You keep 95%.</span> Growlanzo&apos;s flat 5% commission is
              deducted once, when escrow is released — the client pays exactly the agreed amount, with nothing added at
              checkout. No other platform fee touches your payout.
            </p>
          </div>
        </div>
      </div>

      {selectedContract && (
        <div className="space-y-1.5">
          {/* Load Earlier Messages */}
          {hasMoreMessages && (
            <button
              onClick={() => { setMessagesPage(p => p + 1); loadMoreMessagesRef.current?.(); }}
              disabled={loadingMessages}
              className="w-full py-2 text-xs font-medium text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 rounded-lg transition-colors disabled:opacity-50"
            >
              {loadingMessages ? 'Loading...' : 'Load Earlier Messages'}
            </button>
          )}
          {/* Dispute Alert Banner */}
          {selectedContract.status === 'disputed' && (
            <div className="bg-red-50/90 border border-red-200 rounded-xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-3 animate-scale-in">
              <div className="flex items-start gap-1.5">
                <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5 animate-workflow-pulse" />
                <div>
                  <h4 className="font-bold text-red-900">Contract Frozen Under Active Dispute</h4>
                  <p className="text-xs text-red-700 mt-1 leading-relaxed max-w-2xl">
                    A dispute has been raised regarding project deliverables. Escrow payouts are locked and milestone actions are frozen.
                    Please contact support to resolve this dispute.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Extra Revision Request Banner */}
          {pendingRevision && (
            <div className="bg-blue-50/90 border border-blue-200 rounded-xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-3 animate-scale-in">
              <div className="flex items-start gap-1.5">
                <RotateCcw className="w-4 h-4 text-blue-600 flex-shrink-0 mt-0.5 animate-workflow-pulse" />
                <div>
                  <h4 className="font-bold text-blue-900">Extra Revision Request</h4>
                  <p className="text-xs text-blue-700 mt-1 leading-relaxed max-w-2xl">
                    <span className="font-semibold">Client wants:</span> {pendingRevision.revision_count} extra revision{pendingRevision.revision_count > 1 ? 's' : ''}.
                    <span className="block mt-1 font-semibold">Reason:</span> {pendingRevision.reason}
                  </p>
                  <label className="block mt-3 text-xs font-medium text-blue-800">
                    Per-revision price ({currencySymbol()}) — default from your published rate:
                    <input
                      type="number"
                      min="1"
                      step="0.01"
                      value={revisionPriceInput}
                      onChange={(e) => setRevisionPriceInput(e.target.value)}
                      placeholder="e.g. 500"
                      className="mt-1 w-40 px-3 py-2 bg-white border border-blue-200 rounded-lg text-sm text-slate-900 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                    />
                  </label>
                  {Number(revisionPriceInput) > 0 && (
                    <p className="text-xs text-blue-700 mt-1.5 font-semibold">
                      Client will pay {formatCurrency(Number(revisionPriceInput) * pendingRevision.revision_count)} through escrow
                    </p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <button
                  onClick={() => void handleRespondRevision(true)}
                  disabled={revisionBusy}
                  className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 disabled:opacity-50 transition-all text-sm font-medium"
                >
                  {revisionBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                  Accept & Quote
                </button>
                <button
                  onClick={() => void handleRespondRevision(false)}
                  disabled={revisionBusy}
                  className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-slate-100 text-slate-700 rounded-xl hover:bg-slate-200 disabled:opacity-50 transition-all text-sm font-medium"
                >
                  <XCircle className="w-4 h-4" />
                  Decline
                </button>
              </div>
            </div>
          )}

          {/* Cancellation Request Banner */}
          {pendingCancellation && (
            <div className="bg-amber-50/90 border border-amber-200 rounded-xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-3 animate-scale-in">
              <div className="flex items-start gap-1.5">
                <RotateCcw className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5 animate-workflow-pulse" />
                <div>
                  <h4 className="font-bold text-amber-900">Client Requested Cancellation</h4>
                  <p className="text-xs text-amber-700 mt-1 leading-relaxed max-w-2xl">
                    <span className="font-semibold">Reason:</span> {pendingCancellation.reason}.{' '}
                    Accept to refund the remaining escrow ({formatCurrency(Number(pendingCancellation.refund_amount))}) to the client,
                    or reject to open a dispute for admin review.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <button
                  onClick={() => void handleRespondCancellation(true)}
                  disabled={cancellationBusy}
                  className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 disabled:opacity-50 transition-all text-sm font-medium"
                >
                  {cancellationBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                  Accept & Refund
                </button>
                <button
                  onClick={() => void handleRespondCancellation(false)}
                  disabled={cancellationBusy}
                  className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-red-600 text-white rounded-xl hover:bg-red-700 disabled:opacity-50 transition-all text-sm font-medium"
                >
                  <XCircle className="w-4 h-4" />
                  Reject → Dispute
                </button>
              </div>
            </div>
          )}

          {/* TAB 1: Chat & Assets Hub */}
          {activeTab === 'chat' && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-1.5">
              {/* Left Column - Chat Room */}
              <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200/80 shadow-sm flex flex-col h-[400px] sm:h-[500px] lg:h-[400px] sm:h-[500px] lg:h-[600px]">
                {/* Chat Header */}
                <div className="p-4 border-b border-slate-100 bg-slate-50/50 rounded-t-2xl">
                  <div className="flex items-center gap-1.5">
                    <div className="w-8 h-8 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center">
                      <MessageSquare className="w-4 h-4" />
                    </div>
          <div className="min-w-0">
            <h3 className="font-semibold text-slate-900">Project Chat Room</h3>
            <p className="text-xs text-slate-500 truncate">Secure real-time correspondence with {selectedContract.client?.name}</p>
          </div>
                  </div>
                </div>

                {/* Messages */}
                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                  {messages.map((message) => (
                    <div
                      key={message.id}
                      className={`flex ${message.sender_id === user?.id ? 'justify-end' : 'justify-start'}`}
                    >
                      <div className="max-w-[80%]">
                        {message.sender_id !== user?.id && (
                          <p className="text-xs text-slate-500 mb-1 ml-1">{message.sender?.name || 'Client'}</p>
                        )}
                        <div
                          className={`p-3 rounded-xl ${
                            message.sender_id === user?.id
                              ? 'bg-emerald-600 text-white rounded-br-none'
                              : 'bg-slate-100 text-slate-900 rounded-bl-none'
                          }`}
                        >
                          <p className="text-sm">{message.content}</p>
                          <p className={`text-xs mt-1 text-right ${message.sender_id === user?.id ? 'text-emerald-200' : 'text-slate-400'}`}>
                            {safeFormatTime(message.created_at, { hour: '2-digit', minute: '2-digit' })}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Message Input */}
                <form onSubmit={handleSendMessage} className="p-4 border-t border-slate-100 bg-slate-50/50 rounded-b-2xl">
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => setShowUploadModal(true)}
                      className="w-9 h-9 flex items-center justify-center text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-200 transition-colors shrink-0"
                      title="Upload deliverable files"
                      aria-label="Upload deliverable files"
                    >
                      <Paperclip className="w-4 h-4" />
                    </button>
                    <input
                      type="text"
                      value={newMessage}
                      onChange={(e) => setNewMessage(e.target.value)}
                      placeholder="Type a secure message..."
                      className="flex-1 px-4 py-2.5 bg-white border border-slate-200 rounded-full focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 text-sm"
                    />
                    <button
                      type="submit"
                      disabled={!newMessage.trim() || sendingMessage}
                      className="w-10 h-10 shrink-0 bg-emerald-600 text-white rounded-full flex items-center justify-center hover:bg-emerald-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      aria-label="Send message"
                    >
                      {sendingMessage ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Send className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </form>
              </div>

              {/* Right Column - Deliverables & Assets Locker */}
              <div className="bg-white rounded-xl border border-slate-200/80 p-5 shadow-sm space-y-5 h-[400px] sm:h-[500px] lg:h-[600px] flex flex-col">
                <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                  <div>
                    <h3 className="font-semibold text-slate-900">Shared Asset Locker</h3>
                    <p className="text-xs text-slate-500">Contracts, code, and mockups</p>
                  </div>
                  {selectedContract.status !== 'disputed' ? (
                    <button
                      onClick={() => setShowUploadModal(true)}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 transition-all font-medium rounded-lg"
                    >
                      <Plus className="w-4 h-4" />
                      <span>Upload</span>
                    </button>
                  ) : (
                    <span className="text-xs text-red-500 font-semibold px-2 py-1 bg-red-50 border border-red-100 rounded-lg flex items-center gap-1">
                      <Lock className="w-3.5 h-3.5" /> Locked
                    </span>
                  )}
                </div>

                {/* Uploaded Files List */}
                <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
                  {contractFiles.length > 0 ? (
                    contractFiles.map((file) => (
                      <div key={file.id} className="flex items-center gap-1.5 p-3 bg-slate-50/80 border border-slate-100 rounded-xl hover:border-slate-200 transition-all shadow-sm">
                        <div className="w-7 h-7 bg-white border border-slate-100 rounded-lg flex items-center justify-center text-xl flex-shrink-0 shadow-sm">
                          {fileUploadService.getFileIcon(file.file_type)}
                        </div>
                        <div className="flex-1 min-w-0 break-words">
                          <p className="text-xs font-semibold text-slate-900">{file.file_name}</p>
                          <p className="text-xs text-slate-500">
                            {fileUploadService.formatFileSize(file.file_size)} • {file.uploaded_by === user?.id ? 'You' : 'Client'}
                          </p>
                        </div>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          <a
                            href={file.public_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-1.5 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors border border-slate-200 bg-white"
                          >
                            <Download className="w-4 h-4" />
                          </a>
                          {file.uploaded_by === user?.id && selectedContract.status !== 'disputed' && (
                             <button
                               onClick={() => setDeleteFileConfirm(file.id)}
                               className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors border border-slate-200 bg-white"
                             >
                               <Trash2 className="w-4 h-4" />
                             </button>
                           )}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="text-center py-12 text-slate-400">
                      <FileText className="w-8 h-8 mx-auto mb-2 text-slate-300" />
                      <p className="text-xs">No files shared yet.</p>
                      <p className="text-xs text-slate-400 max-w-[200px] mx-auto mt-1">Upload code, templates, or assets for real-time client verification.</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: Real-Time Shared Canvas */}
          {activeTab === 'canvas' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-1.5">
              {/* Shared Live Task Board */}
              <div className="bg-white rounded-xl border border-slate-200/80 p-5 shadow-sm space-y-4 flex flex-col h-[400px] sm:h-[500px] lg:h-[600px]">
                <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                  <div>
                    <h3 className="font-semibold text-slate-900 flex items-center gap-3">
                      <ClipboardList className="w-4 h-4 text-emerald-600" />
                      <span>Live Task Board</span>
                    </h3>
                    <p className="text-xs text-slate-500">Shared checklist synced in real-time</p>
                  </div>
                  <span className="text-xs font-semibold text-emerald-600 bg-emerald-50 border border-emerald-100 px-2 py-0.5 rounded-full">
                    {getTasks().filter(t => t.status === 'completed').length}/{getTasks().length} Done
                  </span>
                </div>

                {/* Add Task Input Form */}
                <form onSubmit={handleAddTask} className="flex gap-3">
                  <input
                    type="text"
                    value={taskInput}
                    onChange={(e) => setTaskInput(e.target.value)}
                    placeholder="Add a co-working task..."
                    className="flex-1 px-3 py-2 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none bg-slate-50/50"
                  />
                  <button
                    type="submit"
                    className="px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-medium flex items-center gap-1 transition-all"
                  >
                    <Plus className="w-4 h-4" /> Add
                  </button>
                </form>

                {/* Shared Task Columns / Lists */}
                <div className="flex-1 overflow-y-auto space-y-4 pr-1">
                  {/* Todo List */}
                  <div>
                    <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full" />
                      <span>To Do ({getTasks().filter(t => t.status === 'todo').length})</span>
                    </h4>
                    <div className="space-y-1.5">
                      {getTasks().filter(t => t.status === 'todo').map((task) => (
                        <div key={task.id} className="flex items-center justify-between p-2.5 bg-slate-50 border border-slate-100 rounded-lg hover:border-slate-200 transition-all text-xs group">
                          <span className="text-slate-700 font-medium">{task.title}</span>
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => handleUpdateTaskStatus(task.id, 'in_progress')}
                              className="p-1 text-indigo-600 hover:bg-indigo-50 border border-indigo-100 rounded bg-white"
                              title="Start work"
                            >
                              <Play className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => handleDeleteTask(task.id)}
                              className="p-1 text-slate-400 hover:text-red-500 hover:bg-red-50 border border-slate-200 rounded bg-white opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                      {getTasks().filter(t => t.status === 'todo').length === 0 && (
                        <p className="text-xs text-slate-400 italic py-1 pl-3">No tasks in queue.</p>
                      )}
                    </div>
                  </div>

                  {/* In Progress List */}
                  <div>
                    <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 bg-blue-400 rounded-full" />
                      <span>In Progress ({getTasks().filter(t => t.status === 'in_progress').length})</span>
                    </h4>
                    <div className="space-y-1.5">
                      {getTasks().filter(t => t.status === 'in_progress').map((task) => (
                        <div key={task.id} className="flex items-center justify-between p-2.5 bg-blue-50/20 border border-blue-100 rounded-lg hover:border-blue-200 transition-all text-xs group">
                          <span className="text-blue-900 font-medium">{task.title}</span>
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => handleUpdateTaskStatus(task.id, 'completed')}
                              className="p-1 text-emerald-600 hover:bg-emerald-50 border border-emerald-100 rounded bg-white"
                              title="Mark complete"
                            >
                              <Check className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => handleUpdateTaskStatus(task.id, 'todo')}
                              className="p-1 text-slate-500 hover:bg-slate-100 border border-slate-200 rounded bg-white"
                              title="Put back in queue"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                      {getTasks().filter(t => t.status === 'in_progress').length === 0 && (
                        <p className="text-xs text-slate-400 italic py-1 pl-3">No tasks currently active.</p>
                      )}
                    </div>
                  </div>

                  {/* Completed List */}
                  <div>
                    <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full" />
                      <span>Completed ({getTasks().filter(t => t.status === 'completed').length})</span>
                    </h4>
                    <div className="space-y-1.5">
                      {getTasks().filter(t => t.status === 'completed').map((task) => (
                        <div key={task.id} className="flex items-center justify-between p-2.5 bg-emerald-50/10 border border-emerald-100/50 rounded-lg text-xs group line-through text-slate-400">
                          <span>{task.title}</span>
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => handleUpdateTaskStatus(task.id, 'in_progress')}
                              className="p-1 text-slate-400 hover:text-blue-600 hover:bg-blue-50 border border-slate-200 rounded bg-white line-normal"
                              title="Re-open task"
                            >
                              <Play className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => handleDeleteTask(task.id)}
                              className="p-1 text-slate-400 hover:text-red-500 hover:bg-red-50 border border-slate-200 rounded bg-white opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                      {getTasks().filter(t => t.status === 'completed').length === 0 && (
                        <p className="text-xs text-slate-400 italic py-1 pl-3">No tasks completed yet.</p>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Collaborative Scratchpad / Notes */}
              <div className="bg-white rounded-xl border border-slate-200/80 p-5 shadow-sm space-y-4 flex flex-col h-[400px] sm:h-[500px] lg:h-[600px]">
                <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                  <div>
                    <h3 className="font-semibold text-slate-900 flex items-center gap-3">
                      <FileText className="w-4 h-4 text-emerald-600" />
                      <span>Co-Working Scratchpad</span>
                    </h3>
                    <p className="text-xs text-slate-500">Shared collaborative project pad</p>
                  </div>
                  
                  {/* Save Indicator */}
                  <div className="text-xs flex items-center gap-1.5 font-medium px-2 py-0.5 rounded-md border border-slate-200/60 shadow-sm bg-slate-50">
                    {notesSaveStatus === 'saving' && (
                      <span className="text-indigo-600 flex items-center gap-1">
                        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving...
                      </span>
                    )}
                    {notesSaveStatus === 'saved' && (
                      <span className="text-emerald-600 flex items-center gap-1">
                        <Check className="w-3.5 h-3.5" /> Synced
                      </span>
                    )}
                    {notesSaveStatus === 'idle' && (
                      <span className="text-slate-500 flex items-center gap-1">
                        <Save className="w-3.5 h-3.5" /> Safe
                      </span>
                    )}
                  </div>
                </div>

                <textarea
                  value={notesText}
                  onChange={(e) => handleNoteChange(e.target.value)}
                  placeholder="Collaborate on project outlines, tech stack details, credentials, or custom deadlines. Synced instantly on both sides..."
                  className="flex-1 w-full p-4 bg-slate-50/50 border border-slate-200 rounded-xl text-xs leading-relaxed focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 focus:outline-none resize-none font-mono"
                />
                
                <p className="text-xs text-slate-400 leading-normal flex items-start gap-1">
                  <AlertCircle className="w-3.5 h-3.5 text-slate-400 mt-0.5 flex-shrink-0" />
                  <span>Use this board for persistent notes. Keeps credentials, staging servers, and APIs synced without scrolling the chat room.</span>
                </p>
              </div>
            </div>
          )}

          {/* TAB 3: Milestones & Escrow Timeline */}
          {activeTab === 'milestones' && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-1.5 animate-fade-in">
              {/* Financial Dashboard details (Left 2 spans) */}
              <div className="lg:col-span-2 space-y-1.5">
                {/* Project Milestone Card */}
                <div className="bg-white rounded-xl p-3 border border-slate-200/80 shadow-sm">
                  <div className="flex items-start justify-between mb-2 pb-3 border-b border-slate-100">
                    <div>
                      <h3 className="font-semibold text-slate-900 text-lg">
                        {selectedContract.project?.title || 'Project'}
                      </h3>
                      <p className="text-xs text-slate-500 mt-0.5">Budget protected in Growlanzo Escrow protection</p>
                    </div>
                    <div className="flex items-center gap-3 flex-wrap">
                      {!workStarted && selectedContract.status !== 'disputed' && !pendingCancellation && (
                        <>
                          <button
                            onClick={() => void handleStartWork()}
                            disabled={startBusy}
                            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-full bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 transition-all"
                          >
                            {startBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                            Start Work
                          </button>
                          <button
                            onClick={() => void handleDeclineProject()}
                            disabled={declineBusy}
                            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-full bg-slate-100 text-slate-600 hover:bg-slate-200 disabled:opacity-50 transition-all"
                          >
                            {declineBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />}
                            Decline Project
                          </button>
                        </>
                      )}
                      <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-indigo-50 border border-indigo-100 text-indigo-700 uppercase">
                        {selectedContract.status === 'disputed' ? 'Locked (Dispute)' : workStarted ? 'In Progress' : 'Pending Start'}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-3 mb-3">
                    <div className="p-4 bg-slate-50 border border-slate-100 rounded-xl">
                      <p className="text-xs text-slate-500 mb-1">Contract Budget</p>
                      <p className="text-xl font-bold text-slate-950">{formatCurrency(selectedContract.amount)}</p>
                    </div>
                    <div className="p-4 bg-emerald-50/50 border border-emerald-100 rounded-xl">
                      <p className="text-xs text-emerald-600 mb-1">Escrow Secured</p>
                      <p className="text-xl font-bold text-emerald-800">
                        {selectedContract.status === 'disputed' ? 'Locked' : formatCurrency(selectedContract.freelancer_amount)}
                      </p>
                    </div>
                    <div className="p-4 bg-orange-50/50 border border-orange-100 rounded-xl">
                      <p className="text-xs text-orange-600 mb-1">Target End Date</p>
                      <p className="text-base font-bold text-orange-800">
                        {selectedContract.end_date 
                          ? safeFormatDate(selectedContract.end_date, { month: 'short', day: 'numeric', year: 'numeric' })
                          : 'Not Set'}
                      </p>
                    </div>
                  </div>

                  {/* Escrow Details Banner */}
                  {(selectedContract as any).escrow && (
                    <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-4 flex items-center justify-between text-xs mb-2">
                      <div className="flex items-center gap-3">
                        <ShieldCheck className="w-4 h-4 text-emerald-600" />
                        <div>
                          <p className="font-semibold text-slate-900">Escrow Security active</p>
                          <p className="text-xs text-slate-500">Funds are held by Growlanzo until you finish mockups and deliverables.</p>
                        </div>
                      </div>
                      <span className="px-2 py-0.5 rounded-full bg-emerald-100 border border-emerald-200 text-emerald-800 text-xs font-semibold uppercase tracking-wider">
                        Funded
                      </span>
                    </div>
                  )}
                </div>

                {/* Auto-release protection — delivered milestones can never be held hostage */}
                {milestones.length > 0 && (
                  <div className="rounded-xl overflow-hidden border border-violet-200 shadow-sm">
                    <div className="bg-gradient-to-r from-violet-600 to-fuchsia-600 px-2.5 py-3.5 flex items-center gap-1.5">
                      <div className="w-9 h-9 bg-white/15 rounded-xl flex items-center justify-center shrink-0">
                        <ShieldCheck className="w-4 h-4 text-white" />
                      </div>
                      <div>
                        <p className="font-bold text-white text-xs">Your Payment Is Protected — Auto-Release Is Active</p>
                        <p className="text-xs text-violet-100">Delivered milestones release to your wallet automatically — a client can never hold your payment</p>
                      </div>
                    </div>
                    <div className="bg-violet-50/70 px-2.5 py-3.5">
                      <p className="text-xs text-slate-700 leading-relaxed">
                        Once you deliver a milestone, the client can review and release it sooner — but if they don't
                        respond within the <span className="font-bold">review window</span>, the escrow{' '}
                        <span className="font-bold text-emerald-700">auto-releases to your wallet automatically</span>.
                        Even if the client forgets or attempts fraud, they <span className="font-bold">cannot keep your payment</span>.
                        Fraud and outside-platform payment attempts lead to{' '}
                        <span className="font-bold text-red-600">suspension or permanent ban</span>.
                      </p>
                    </div>
                  </div>
                )}

                {/* Milestones list */}
                <div className="bg-white rounded-xl p-3 border border-slate-200/80 shadow-sm">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-semibold text-slate-900">Contract Milestones</h3>
                    <span className="text-xs text-slate-500">
                      {milestones.filter(m => m.status === 'completed').length} of {milestones.length} Completed
                    </span>
                  </div>

                  {milestones.length > 0 ? (
                    <div className="space-y-1.5">
                      {milestones.map((milestone, idx) => (
                        <div
                          key={idx}
                          className={`p-3.5 rounded-xl border transition-all text-xs ${
                            milestone.status === 'completed'
                              ? 'bg-emerald-50/20 border-emerald-100/50 text-slate-600'
                              : milestone.status === 'in_progress'
                              ? 'bg-blue-50/20 border-blue-100/50'
                              : 'bg-slate-50/50 border-slate-100'
                          }`}
                        >
                          <div className="flex items-start gap-1.5">
                            <button
                              onClick={() => handleMilestoneStatusChange(idx, ['delivered', 'completed'].includes(milestone.status) ? 'pending' : 'delivered')}
                              disabled={selectedContract.status === 'disputed'}
                              title={['delivered', 'completed'].includes(milestone.status) ? 'Mark as pending' : 'Deliver this milestone (auto-release timer starts)'}
                              className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 transition-all border ${
                                selectedContract.status === 'disputed'
                                  ? 'bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed'
                                  : ['delivered', 'completed'].includes(milestone.status)
                                  ? 'bg-emerald-500 border-emerald-600 text-white'
                                  : 'bg-white border-slate-300 hover:border-emerald-500'
                              }`}
                            >
                              {['delivered', 'completed'].includes(milestone.status) && <Check className="w-3.5 h-3.5" />}
                            </button>
                            
                            <div className="flex-1 min-w-0 break-words">
                              <div className="flex items-center justify-between mb-0.5">
                                <h4 className={`font-semibold text-xs ${['delivered', 'completed'].includes(milestone.status) ? 'text-slate-400 line-through' : 'text-slate-900'}`}>
                                  {milestone.title}
                                </h4>
                                <span className="font-bold text-slate-900">{formatCurrency(milestone.amount)}</span>
                              </div>
                              {milestone.description && (
                                <p className="text-xs text-slate-500 leading-relaxed mb-2">{milestone.description}</p>
                              )}
                              <div className="flex items-center gap-1.5 text-xs">
                                <span className={`px-2 py-0.5 rounded-md border font-medium uppercase tracking-wider ${
                                  milestone.status === 'delivered'
                                    ? 'bg-violet-50 border-violet-100 text-violet-700'
                                    : milestone.status === 'completed'
                                    ? 'bg-emerald-50 border-emerald-100 text-emerald-700'
                                    : milestone.status === 'in_progress'
                                    ? 'bg-blue-50 border-blue-100 text-blue-700'
                                    : 'bg-slate-100 border-slate-200 text-slate-600'
                                }`}>
                                  {milestone.status === 'delivered' ? 'Delivered' : milestone.status === 'completed' ? 'Completed' : milestone.status === 'in_progress' ? 'In Progress' : 'Pending'}
                                </span>
                                {milestone.status === 'delivered' && milestone.auto_release_hours && (
                                  <span className="flex items-center gap-1 text-violet-600 font-medium">
                                    <Clock className="w-4 h-4" />
                                    Auto-release in ~{milestone.auto_release_hours}h if client doesn't respond
                                  </span>
                                )}
                                {milestone.due_date && (
                                  <span className="flex items-center gap-1 text-slate-400">
                                    <Calendar className="w-4 h-4" />
                                    Due {safeFormatDate(milestone.due_date)}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-3 border border-dashed border-slate-200 rounded-xl">
                      <AlertCircle className="w-7 h-7 text-slate-300 mx-auto mb-2" />
                      <p className="text-xs text-slate-500">Full contract escrow — no milestones</p>

                      {workStarted && selectedContract.escrow_funded && selectedContract.status !== 'disputed' && selectedContract.status !== 'completed' && (
                        <div className="mt-4 space-y-1.5">
                          {selectedContract.delivered_at ? (
                            <div className="mx-auto max-w-sm p-3.5 bg-violet-50 border border-violet-200 rounded-xl">
                              <p className="text-xs font-bold text-violet-800 flex items-center justify-center gap-1.5">
                                <CheckCircle2 className="w-4 h-4" />
                                Delivered — auto-release active
                              </p>
                              <p className="text-xs text-violet-700 mt-1 leading-relaxed">
                                The client can review and release sooner — if they don't respond within{' '}
                                <strong>~{selectedContract.auto_release_hours ?? 72} hours</strong>, the escrow
                                auto-releases to your wallet automatically. Re-deliver to refresh the timer if you
                                share updated files.
                              </p>
                            </div>
                          ) : (
                            <button
                              onClick={() => void handleContractDeliver()}
                              disabled={deliverBusy}
                              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-full bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 transition-all"
                            >
                              {deliverBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                              Deliver Work (starts auto-release timer)
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Chronological Project Timeline (Right Column) */}
              <div className="bg-white rounded-xl border border-slate-200/80 p-5 shadow-sm space-y-4 flex flex-col h-[400px] sm:h-[500px] lg:h-[600px]">
                <div className="pb-3 border-b border-slate-100">
                  <h3 className="font-semibold text-slate-900 flex items-center gap-3">
                    <Clock className="w-4 h-4 text-emerald-600" />
                    <span>Project Event Timeline</span>
                  </h3>
                  <p className="text-xs text-slate-500">Co-working log feed</p>
                </div>

                <div className="flex-1 overflow-y-auto pr-1 relative pl-4 space-y-5">
                  {/* Timeline central wire */}
                  <div className="absolute left-6 top-3 bottom-3 w-0.5 bg-slate-100" />
                  
                  {getTimelineEvents().length > 0 ? (
                    getTimelineEvents().map(event => (
                      <div key={event.id} className="relative flex items-start gap-3 animate-scale-in">
                        {/* Timeline event icon */}
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 z-10 shadow-md ${event.color}`}>
                          <event.icon className="w-4 h-4" />
                        </div>
                        <div className="flex-1 min-w-0 bg-slate-50/60 border border-slate-100 rounded-xl p-3 hover:bg-slate-50 hover:border-slate-200 transition-all shadow-sm">
                          <span className="text-[10px] text-slate-400 font-semibold block mb-0.5 uppercase tracking-wider">
                            {safeFormatDateTime(event.timestamp, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </span>
                          <h4 className="text-xs font-semibold text-slate-900 leading-normal">{event.title}</h4>
                          <p className="text-xs text-slate-500 mt-1 leading-normal">{event.description}</p>
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="text-xs text-slate-400 text-center py-12">Timeline compilation idle.</p>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* File Upload Modal */}
      <ConfirmModal
        isOpen={!!deleteFileConfirm}
        onClose={() => setDeleteFileConfirm(null)}
        onConfirm={() => deleteFileConfirm ? handleDeleteFile(deleteFileConfirm) : Promise.resolve()}
        title="Delete File"
        message="Are you sure you want to delete this file? This action cannot be undone."
        confirmLabel="Delete"
        variant="danger"
      />

      {showUploadModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
          <div className="bg-white rounded-xl p-6 max-w-md w-full shadow-2xl animate-scale-in border border-slate-100">
            <div className="flex items-center justify-between mb-2.5">
              <h3 className="font-display text-xl font-bold text-slate-900">Upload Project Deliverable</h3>
              <button 
                onClick={() => setShowUploadModal(false)}
                className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-slate-100 transition-colors border border-slate-200"
              >
                <X className="w-4 h-4 text-slate-400" />
              </button>
            </div>

            <form onSubmit={handleFileUpload} className="space-y-4">
              <div className="border-2 border-dashed border-slate-300 rounded-xl p-6 hover:border-emerald-500 hover:bg-emerald-50/20 transition-all cursor-pointer">
                <input
                  type="file"
                  onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                  className="hidden"
                  id="file-input-freelancer"
                />
                <label htmlFor="file-input-freelancer" className="block text-center cursor-pointer">
                  <Upload className="w-8 h-8 text-slate-400 mx-auto mb-2" />
                  <p className="text-xs font-semibold text-slate-700">
                    {selectedFile ? selectedFile.name : 'Select or drag contract deliverable'}
                  </p>
                  <p className="text-xs text-slate-400 mt-1">Supported: Code, Images, PDFs, Zip (Max 50MB)</p>
                </label>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Description / Client Note</label>
                <textarea
                  value={fileDescription}
                  onChange={(e) => setFileDescription(e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 text-xs resize-none"
                  placeholder="Explain this release or deliverable (e.g. Mockups v1, DB schema)..."
                />
              </div>

              <div className="flex gap-1.5 pt-2">
                <button
                  type="button"
                  onClick={() => setShowUploadModal(false)}
                  className="flex-1 py-2.5 px-4 border border-slate-200 text-slate-700 text-xs font-medium rounded-xl hover:bg-slate-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!selectedFile || uploadingFile}
                  className="flex-1 py-2.5 px-4 bg-emerald-600 text-white text-xs font-medium rounded-xl hover:bg-emerald-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5 shadow-md shadow-emerald-600/10"
                >
                  {uploadingFile ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Uploading...
                    </>
                  ) : (
                    'Upload Deliverable'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Leave Review Modal — after contract completion */}
      {reviewModalOpen && selectedContract && (
        <ReviewModal
          contractId={selectedContract.id}
          revieweeId={selectedContract.client_id}
          revieweeName={selectedContract.client?.name || 'Client'}
          projectTitle={selectedContract.project?.title}
          onClose={() => setReviewModalOpen(false)}
          onSubmitted={() => {
            setReviewedContractIds(prev => new Set(prev).add(selectedContract.id));
            void refreshContract(selectedContract.id);
            toast.success('Review Submitted', 'Thank you! Your review has been published and the contract is now in your history.');
            // After review, the workspace closes — only the contract history remains.
            navigate('/dashboard/contracts?tab=completed');
          }}
        />
      )}
    </div>
  );
}