import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../components/Toast'
import { formatCurrency as libFormatCurrency } from '../lib/currency'
import { requireKycForAction } from '../lib/kycGate'
import { supabase, dbFunctions } from '../lib/supabase'
import { messagesService } from '../lib/messages'
import { fileUploadService } from '../lib/fileUpload'
import { safeFormatDate, safeFormatTime } from '../utils/date'
import { EscrowPayPalPayment } from '../components/EscrowPayPalPayment'
import {
  getMilestoneProgress,
  MilestoneItem,
} from '../lib/contractMilestones'
import {
  AlertCircle,
  AlertTriangle,
  Briefcase,
  Check,
  CheckCircle2,
  Award,
  ClipboardList,
  Clock,
  CreditCard,
  IndianRupee,
  Info,
  RefreshCw,
  Download,
  FileText,
  History,
  Laptop,
  Loader2,
  Lock,
  MessageSquare,
  Paperclip,
  Play,
  Plus,
  RotateCcw,
  Send,
  Shield,
  ShieldCheck,
  Snowflake,
  Star,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { refundService, type RefundRequest, type RefundHistoryEvent } from '../lib/refundService'
import { revisionService, type RevisionRequest } from '../lib/revisionService'
import { razorpayService } from '../lib/razorpay'
import { VerifiedBadge } from '../components/VerifiedBadge'
import { ProBadge } from '../components/ProBadge'
import { InfoTip } from '../components/InfoTip'
import { ReviewModal } from '../components/ReviewModal'

interface Contract {
  id: string
  client_id: string
  freelancer_id: string
  project_id: string
  status: string
  amount: number
  escrow_funded: boolean
  created_at: string
  updated_at: string
  dispute_reason: string | null
  dispute_description: string | null
  dispute_initiated_by: string | null
  dispute_escalated: boolean
  dispute_resolved: boolean
  freelancer_started_at: string | null
  delivered_at?: string | null
  auto_release_hours?: number | null
  cancellation_status?: string
  cancellation_requested_by?: string | null
  frozen_at?: string | null
  freeze_reason?: string | null
  freelancer?: {
    id: string
    name: string | null
    avatar: string | null
    verification_status?: string | null
    is_pro?: boolean | null
  }
  project?: {
    id: string
    title: string
  }
}

interface Message {
  id: string
  contract_id: string
  sender_id: string
  content: string
  created_at: string
  sender?: {
    id: string
    name: string | null
    avatar: string | null
  }
}

interface SharedTask {
  id: string
  contract_id: string
  title: string
  status: string
  created_by: string
  created_at: string
}

type NotesSaveStatus = 'saved' | 'unsaved' | 'saving'
type ActiveTab = 'chat' | 'canvas' | 'milestones'

export function ClientWorkspacePage() {
  const { user } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const { contractId: routeContractId } = useParams<{ contractId: string }>()
  const [searchParams] = useSearchParams()
  const contractId = searchParams.get('contract') || searchParams.get('contractId') || routeContractId || undefined
  const [contracts, setContracts] = useState<Contract[]>([])
  const [selectedContract, setSelectedContract] = useState<Contract | null>(null)
  const [loading, setLoading] = useState(true)
  const [reviewModalOpen, setReviewModalOpen] = useState(false)
  const [reviewedContractIds, setReviewedContractIds] = useState<Set<string>>(new Set())
  const [messages, setMessages] = useState<Message[]>([])
  const [newMessage, setNewMessage] = useState('')
  const [sendingMessage, setSendingMessage] = useState(false)
  const [contractFiles, setContractFiles] = useState<any[]>([])
  const [uploadingFile, setUploadingFile] = useState(false)
  const [showUploadModal, setShowUploadModal] = useState(false)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [fileDescription, setFileDescription] = useState('')
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [uploadBlocked, setUploadBlocked] = useState(false)
  const [showDisputeModal, setShowDisputeModal] = useState(false)
  const [disputeReason, setDisputeReason] = useState('')
  const [disputeDescription, setDisputeDescription] = useState('')
  const [submittingDispute, setSubmittingDispute] = useState(false)
  const [showRefundModal, setShowRefundModal] = useState(false)
  const [refundReason, setRefundReason] = useState('')
  const [refundDescription, setRefundDescription] = useState('')
  const [submittingRefund, setSubmittingRefund] = useState(false)
  const [revisionRequests, setRevisionRequests] = useState<RevisionRequest[]>([])
  const [showRevisionModal, setShowRevisionModal] = useState(false)
  const [revisionCount, setRevisionCount] = useState('1')
  const [revisionReason, setRevisionReason] = useState('')
  const [submittingRevision, setSubmittingRevision] = useState(false)
  const [payingRevision, setPayingRevision] = useState<string | null>(null)
  const [autoReleaseHours, setAutoReleaseHours] = useState('72')
  const [savingAutoRelease, setSavingAutoRelease] = useState(false)
  const [refundRequests, setRefundRequests] = useState<RefundRequest[]>([])
  const [refundHistory, setRefundHistory] = useState<RefundHistoryEvent[]>([])
  const [freelancerCerts, setFreelancerCerts] = useState<Array<{ skill: string; level: string }>>([])
  const [freelancerRating, setFreelancerRating] = useState<number | null>(null)
  const [freelancerReviewCount, setFreelancerReviewCount] = useState(0)
  const [showFundEscrow, setShowFundEscrow] = useState(false)

  // 🔒 Critical money action — identity must be verified before funding escrow.
  const openFundEscrow = useCallback(async () => {
    if (!user) return;
    const kyc = await requireKycForAction(user);
    if (!kyc.verified) {
      toast.info(
        'Verification required',
        'Please verify your identity to fund escrow — it takes under a minute and keeps every payment protected.'
      );
      window.location.href = `${kyc.kycPath}?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`;
      return;
    }
    setShowFundEscrow(true);
  }, [user, toast])
  const [releasingEscrow, setReleasingEscrow] = useState(false)
  const [activeTab, setActiveTab] = useState<ActiveTab>('chat')
  const [taskInput, setTaskInput] = useState('')
  const [notesText, setNotesText] = useState('')
  const [isTypingNotes, setIsTypingNotes] = useState(false)
  const [notesSaveStatus, setNotesSaveStatus] = useState<NotesSaveStatus>('saved')

  const chatMessagesEndRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    chatMessagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const refreshContract = useCallback(async (contractId: string) => {
    const { data, error } = await supabase
      .from('contracts')
      .select('*, freelancer:profiles!contracts_freelancer_id_fkey(id, name, avatar, verification_status, is_pro), project:projects!contracts_project_id_fkey(id, title)')
      .eq('id', contractId)
      .single()
    if (!error && data) {
      setSelectedContract(prev => prev?.id === contractId ? data as unknown as Contract : prev)
    }
  }, [])

  useEffect(() => {
    if (!user) return

    const fetchContracts = async () => {
      const { data: contractsData, error: contractsError } = await supabase
        .from('contracts')
        .select('*, freelancer:profiles!contracts_freelancer_id_fkey(id, name, avatar, verification_status, is_pro), project:projects!contracts_project_id_fkey(id, title)')
        .eq('client_id', user.id)
        .in('status', ['pending', 'active', 'in_progress', 'disputed', 'completed'])
        .order('created_at', { ascending: false })

      if (!contractsError && contractsData) {
        setContracts(contractsData as unknown as Contract[])
        if (contractId) {
          const found = contractsData.find((c: any) => c.id === contractId)
          if (found) setSelectedContract(found as unknown as Contract)
        } else if (contractsData.length > 0) {
          // When arriving via ?fund=1 (Fund Escrow deep-link), prefer the first
          // contract that still needs funding so the payment modal never opens
          // for an already-funded contract.
          const preferUnfunded = searchParams.get('fund') === '1'
          const target = preferUnfunded
            ? (contractsData.find((c: any) => c.escrow_funded === false) || contractsData[0])
            : contractsData[0]
          setSelectedContract(target as unknown as Contract)
          if (target?.id !== contractId) {
            window.history.replaceState(null, '', `/client/workspace/${target.id}`)
          }
        }

        // Direct fund-escrow entry: ?fund=1 auto-opens the payment modal once
        // a contract is selected (used by 'Fund Escrow' buttons on Contracts /
        // Payments pages). The param is cleaned so a refresh doesn't re-open it.
        if (searchParams.get('fund') === '1') {
          void openFundEscrow()
          const url = new URL(window.location.href)
          url.searchParams.delete('fund')
          window.history.replaceState(null, '', url.toString())
        }
      }
      setLoading(false)
    }
    void fetchContracts()
    // searchParams is read inside for the ?fund=1 deep-link; the effect is
    // idempotent so re-runs after the param is cleaned are safe.
  }, [user, contractId, searchParams, openFundEscrow])

  const fetchMessages = useCallback(async () => {
    if (!selectedContract || !user) return
    const { data, error } = await supabase
      .from('messages')
      .select('*, sender:profiles!messages_sender_id_fkey(id, name, avatar)')
      .eq('contract_id', selectedContract.id)
      .order('created_at', { ascending: true })
    if (!error && data) {
      setMessages(data as unknown as Message[])
      await messagesService.markContractAsRead(selectedContract.id, user.id)
    }
  }, [selectedContract, user])

  useEffect(() => {
    if (!selectedContract) return
    void fetchMessages()
  }, [selectedContract, fetchMessages])

  useEffect(() => {
    if (!selectedContract || !user) return

    const channel = supabase
      .channel(`client-workspace-${selectedContract.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `contract_id=eq.${selectedContract.id}`,
        },
        () => { void fetchMessages() }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'contracts',
          filter: `id=eq.${selectedContract.id}`,
        },
        () => { void refreshContract(selectedContract.id) }
      )
      .subscribe()

    const escrowChannel = supabase
      .channel(`escrow-${selectedContract.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'escrow', filter: `contract_id=eq.${selectedContract.id}` }, () => {
        void refreshContract(selectedContract.id)
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
      supabase.removeChannel(escrowChannel)
    }
  }, [selectedContract, user, fetchMessages, refreshContract])

  const fetchFiles = useCallback(async () => {
    if (!selectedContract) return
    try {
      const files = await fileUploadService.getContractFiles(selectedContract.id)
      setContractFiles(files)
    } catch { /* handled silently */ }
  }, [selectedContract])

  useEffect(() => {
    if (!selectedContract) return
    void fetchFiles()

    const subChannel = fileUploadService.subscribeToContractFiles(selectedContract.id, () => {
      void fetchFiles()
    })
    return () => {
      supabase.removeChannel(subChannel)
    }
  }, [selectedContract, fetchFiles])

  const handleSendMessage = async () => {
    if (!newMessage.trim() || !selectedContract || !user) return
    setSendingMessage(true)
    // receiver_id must be set so the OTHER party can see + receive the message in realtime
    const receiverId =
      selectedContract.client_id === user.id
        ? selectedContract.freelancer_id
        : selectedContract.client_id
    const { error } = await supabase.from('messages').insert({
      contract_id: selectedContract.id,
      sender_id: user.id,
      receiver_id: receiverId,
      content: newMessage.trim(),
    })
    if (!error) setNewMessage('')
    setSendingMessage(false)
  }

  const handleFileUpload = async () => {
    if (!selectedFile || !selectedContract || !user) return
    setUploadingFile(true)
    setUploadError(null)
    setUploadBlocked(false)
    try {
      const result = await fileUploadService.uploadFile(
        selectedFile,
        selectedContract.id,
        fileDescription || undefined
      )
      if (result.success) {
        setSelectedFile(null)
        setFileDescription('')
        setShowUploadModal(false)
        void fetchFiles()
      } else {
        setUploadError(result.error || 'Failed to upload file')
      }
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed. Please try again.')
    }
    setUploadingFile(false)
  }

  const handleDeleteFile = async (fileId: string) => {
    if (!selectedContract) return
    try {
      const result = await fileUploadService.deleteFile(fileId)
      if (result.success) void fetchFiles()
    } catch { /* handled silently */ }
  }

  const handleRaiseDispute = async () => {
    if (!selectedContract || !user || !disputeReason.trim()) return
    setSubmittingDispute(true)
    const { error } = await supabase.rpc('raise_contract_dispute' as any, {
      p_contract_id: selectedContract.id,
      p_reason: disputeReason.trim(),
      p_description: disputeDescription.trim() || null,
    })
    if (!error) {
      setShowDisputeModal(false)
      setDisputeReason('')
      setDisputeDescription('')
      void refreshContract(selectedContract.id)
    }
    setSubmittingDispute(false)
  }

  const handleReleaseEscrow = async () => {
    if (!selectedContract || !user) return
    setReleasingEscrow(true)
    const result = await dbFunctions.releaseEscrow(selectedContract.id, user.id)
    if (result) void refreshContract(selectedContract.id)
    setReleasingEscrow(false)
  }

  // ─── Refund / Cancellation ───────────────────────────────────
  const loadRefundData = useCallback(async () => {
    if (!selectedContract) return
    const reqs = await refundService.getRefundRequests(selectedContract.id)
    setRefundRequests(reqs)
    if (reqs.length > 0) {
      // timeline for the most recent active request
      const active = reqs.find(r => !['completed', 'rejected', 'cancelled', 'failed'].includes(r.status)) || reqs[0]
      const history = await refundService.getRefundHistory(active.id)
      setRefundHistory(history)
    } else {
      setRefundHistory([])
    }
  }, [selectedContract])

  // ─── Freelancer trust signals (certs + rating) ────────────────
  const loadFreelancerTrust = useCallback(async () => {
    if (!selectedContract?.freelancer?.id) return
    const fid = selectedContract.freelancer.id
    const [certsRes, ratingRes] = await Promise.all([
      supabase
        .from('skill_certifications')
        .select('skill, level')
        .eq('user_id', fid)
        .not('passed_at', 'is', null)
        .order('created_at', { ascending: false }),
      supabase
        .from('freelancer_profiles')
        .select('rating, total_reviews')
        .eq('user_id', fid)
        .maybeSingle(),
    ])
    if (!certsRes.error) {
      setFreelancerCerts((certsRes.data || []) as unknown as Array<{ skill: string; level: string }>)
    }
    if (!ratingRes.error && ratingRes.data) {
      setFreelancerRating(Number((ratingRes.data as { rating?: number | null }).rating ?? 0))
      setFreelancerReviewCount(Number((ratingRes.data as { total_reviews?: number | null }).total_reviews ?? 0))
    }
  }, [selectedContract?.freelancer?.id])

  useEffect(() => {
    if (!selectedContract) return
    void loadRefundData()
    void loadFreelancerTrust()

    const channel = supabase
      .channel(`refund-live-${selectedContract.id}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'refund_requests',
        filter: `contract_id=eq.${selectedContract.id}`,
      }, () => { void loadRefundData() })
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'refunds',
        filter: `contract_id=eq.${selectedContract.id}`,
      }, () => { void loadRefundData() })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [selectedContract, loadRefundData, loadFreelancerTrust])

  // ─── Extra revisions (client side) ───────────────────────────────
  const loadRevisionData = useCallback(async () => {
    if (!selectedContract) return
    const reqs = await revisionService.getForContract(selectedContract.id)
    setRevisionRequests(reqs)
  }, [selectedContract])

  useEffect(() => {
    if (!selectedContract) return
    void loadRevisionData()
    const sub = revisionService.subscribeToContract(selectedContract.id, () => { void loadRevisionData() })
    return () => { void supabase.removeChannel(sub.channel) }
  }, [selectedContract, loadRevisionData])

  const activeRevision = revisionRequests.find(r => ['pending_freelancer', 'accepted', 'paid'].includes(r.status))

  const handleRequestExtraRevision = async () => {
    if (!selectedContract) return
    const count = parseInt(revisionCount, 10)
    if (!count || count < 1 || count > 20) {
      toast.error('Invalid count', 'Enter a revision count between 1 and 20.')
      return
    }
    if (revisionReason.trim().length < 5) {
      toast.error('Describe the revision', 'Please describe what needs to change (min 5 characters).')
      return
    }
    setSubmittingRevision(true)
    const result = await revisionService.requestExtraRevision(selectedContract.id, count, revisionReason.trim())
    if (result.success) {
      setShowRevisionModal(false)
      setRevisionCount('1')
      setRevisionReason('')
      void loadRevisionData()
      toast.success('Request sent', 'The freelancer will review your extra revision request.')
    } else {
      toast.error(result.error || 'Failed to request extra revision')
    }
    setSubmittingRevision(false)
  }

  // Pay for an accepted extra revision via Razorpay (escrow-protected).
  const handlePayRevision = async (req: RevisionRequest) => {
    setPayingRevision(req.id)
    try {
      const { order, razorpay_key_id, amount, currency } = await razorpayService.createOrder({
        order_type: 'revision_payment',
        amount: Number(req.total_amount),
        currency: 'INR',
        description: `Extra revisions (${req.revision_count}) — contract #${req.contract_id.slice(0, 8)}`,
        metadata: { revision_request_id: req.id, contract_id: req.contract_id },
      })

      await razorpayService.openCheckout({
        key: razorpay_key_id,
        amount: Math.round(amount * 100),
        currency,
        name: 'Growlanzo',
        description: `${req.revision_count} extra revision(s)`,
        order_id: order.razorpay_order_id,
        config_id: import.meta.env.VITE_RAZORPAY_CONFIG_ID || undefined,
        prefill: { name: user?.name || '', email: user?.email || '' },
        theme: { color: '#14861f' },
        method: { card: true, upi: true, netbanking: true, wallet: true, emi: true },
        handler: async () => {
          toast.success('Payment received', 'Extra revision funds are now held in escrow.')
          void loadRevisionData()
          void refreshContract(selectedContract.id)
        },
        modal: { ondismiss: () => setPayingRevision(null) },
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not start payment.'
      // A dismissed Razorpay modal is a cancellation, not a failure.
      if (!msg.includes('cancelled by user')) {
        toast.error('Payment Failed', msg)
      }
    } finally {
      setPayingRevision(null)
    }
  }

  const handleRequestRefund = async () => {
    if (!selectedContract || !refundReason.trim()) return
    setSubmittingRefund(true)
    const result = await refundService.requestRefund(
      selectedContract.id,
      refundReason.trim(),
      refundDescription.trim() || undefined
    )
    if (result.success) {
      setShowRefundModal(false)
      setRefundReason('')
      setRefundDescription('')
      void refreshContract(selectedContract.id)
      void loadRefundData()
      toast.success(
        result.data?.request_type === 'client_cancel_before_work'
          ? 'Cancellation approved — automatic refund in progress'
          : 'Cancellation request sent — awaiting freelancer response'
      )
    } else {
      toast.error('Refund request failed', result.error || 'Unknown error')
    }
    setSubmittingRefund(false)
  }

  const activeRefund = refundRequests.find(r => ['pending_freelancer', 'pending_admin', 'approved', 'auto_approved'].includes(r.status))
  const isFrozen = !!selectedContract?.frozen_at

  // Prefill the auto-release window from the contract's current milestone setting.
  useEffect(() => {
    if (!selectedContract) return
    const ms = Array.isArray((selectedContract as any).milestones) ? (selectedContract as any).milestones : []
    const hours = ms[0]?.auto_release_hours
    if (typeof hours === 'number' && hours >= 10 && hours <= 168) {
      setAutoReleaseHours(String(hours))
    }
  }, [selectedContract])

  // Auto-release window override (client). 10–168 hours.
  const handleSetAutoReleaseHours = async () => {
    if (!selectedContract) return
    const hours = parseInt(autoReleaseHours, 10)
    if (!hours || hours < 10 || hours > 168) {
      toast.error('Invalid window', 'Auto-release window must be between 10 and 168 hours (10 hours – 7 days).')
      return
    }
    setSavingAutoRelease(true)
    const { data, error } = await supabase.rpc('set_auto_release_hours' as any, {
      p_contract_id: selectedContract.id,
      p_hours: hours,
    })
    const result = data as { success?: boolean; error?: string } | null
    if (error || !result?.success) {
      toast.error('Failed to update', result?.error || error?.message || 'Could not update auto-release window.')
    } else {
      toast.success('Auto-release window updated', `Delivered milestones will auto-release after ${hours} hours without your review.`)
      void refreshContract(selectedContract.id)
    }
    setSavingAutoRelease(false)
  }

  const getTasks = useCallback(async (): Promise<SharedTask[]> => {
    if (!selectedContract) return []
    const { data, error } = await supabase
      .from('workspace_tasks')
      .select('*')
      .eq('contract_id', selectedContract.id)
      .order('created_at', { ascending: true })
    if (!error && data) return data as unknown as SharedTask[]
    return []
  }, [selectedContract])

  const handleAddTask = async () => {
    if (!taskInput.trim() || !selectedContract || !user) return
    const { error } = await supabase.from('workspace_tasks').insert({
      contract_id: selectedContract.id,
      title: taskInput.trim(),
      status: 'todo',
      created_by: user.id,
    })
    if (!error) setTaskInput('')
  }

  const handleUpdateTaskStatus = async (taskId: string, newStatus: string) => {
    await supabase.from('workspace_tasks').update({ status: newStatus }).eq('id', taskId)
  }

  const handleDeleteTask = async (taskId: string) => {
    await supabase.from('workspace_tasks').delete().eq('id', taskId)
  }

  const handleNoteChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setNotesText(e.target.value)
    setIsTypingNotes(true)
    setNotesSaveStatus('unsaved')
  }

  const notesTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const debouncedUpdateNotes = useCallback(
    async (contractId: string, content: string) => {
      if (notesTimeoutRef.current) clearTimeout(notesTimeoutRef.current)
      notesTimeoutRef.current = setTimeout(async () => {
        setNotesSaveStatus('saving')
        try {
          const { data: existing } = await supabase
            .from('workspace_notes')
            .select('id')
            .eq('contract_id', contractId)
            .maybeSingle()

          if (existing) {
            await supabase.from('workspace_notes').update({ content, updated_at: new Date().toISOString() }).eq('id', existing.id)
          } else {
            await supabase.from('workspace_notes').insert({ contract_id: contractId, content, created_by: user?.id || '' })
          }
          setNotesSaveStatus('saved')
        } catch { setNotesSaveStatus('saved') }
        setIsTypingNotes(false)
      }, 1500)
    },
    [user]
  )

  useEffect(() => {
    if (!selectedContract) return
    const fetchNotes = async () => {
      const { data } = await supabase
        .from('workspace_notes')
        .select('content')
        .eq('contract_id', selectedContract.id)
        .maybeSingle()
      if (data) setNotesText((data as unknown as { content: string }).content || '')
    }
    void fetchNotes()

    const channel = supabase
      .channel(`notes-${selectedContract.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'workspace_notes', filter: `contract_id=eq.${selectedContract.id}` }, (payload: any) => {
        if (payload.new && !isTypingNotes) setNotesText(payload.new.content || '')
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [selectedContract, isTypingNotes])

  useEffect(() => {
    if (!selectedContract || !isTypingNotes) return
    void debouncedUpdateNotes(selectedContract.id, notesText)
  }, [notesText, selectedContract, isTypingNotes, debouncedUpdateNotes])

  const getTimelineEvents = () => {
    if (!selectedContract) return []
    const events: { date: string; title: string; description: string; icon: string; status: 'completed' | 'current' | 'pending' }[] = []

    events.push({
      date: safeFormatDate(selectedContract.created_at),
      title: 'Contract Created',
      description: 'Work agreement established',
      icon: 'file',
      status: 'completed',
    })

    if (selectedContract.escrow_funded) {
      events.push({
        date: '',
        title: 'Escrow Funded',
        description: `Payment of ${formatCurrency(selectedContract.amount)} secured in escrow`,
        icon: 'rupee',
        status: 'completed',
      })
    } else {
      events.push({
        date: '',
        title: 'Fund Escrow',
        description: 'Client needs to fund the escrow to begin work',
        icon: 'rupee',
        status: 'current',
      })
    }

    if (selectedContract.status === 'completed') {
      events.push({
        date: '',
        title: 'Payment Released',
        description: 'Funds released to freelancer',
        icon: 'check',
        status: 'completed',
      })
    } else if (selectedContract.escrow_funded) {
      events.push({
        date: '',
        title: 'Release Payment',
        description: 'Release escrow funds upon completion',
        icon: 'check',
        status: 'current',
      })
    } else {
      events.push({
        date: '',
        title: 'Release Payment',
        description: 'Funds will be released upon completion',
        icon: 'check',
        status: 'pending',
      })
    }

    if (selectedContract.status === 'disputed') {
      events.push({
        date: '',
        title: 'Dispute Active',
        description: 'An issue was reported on this contract',
        icon: 'alert',
        status: 'current',
      })
    }

    return events
  }

  const formatCurrency = (amount: number) => {
    // NaN-safe — contracts can have null/undefined amounts; never render ₹NaN.
    const safeAmount = Number.isFinite(Number(amount)) ? Number(amount) : 0
    return libFormatCurrency(safeAmount)
  }

  const milestoneProgress = selectedContract ? getMilestoneProgress((selectedContract as any).milestones) : { completed: 0, total: 0, percent: 0, milestones: [] }
  const milestones: MilestoneItem[] = Array.isArray((selectedContract as any)?.milestones)
    ? (selectedContract as any).milestones
    : typeof (selectedContract as any)?.milestones === 'string'
    ? (() => { try { return JSON.parse((selectedContract as any).milestones) } catch { return [] } })()
    : []
  const needsFunding = selectedContract && !selectedContract.escrow_funded && selectedContract.status !== 'completed'

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[80vh]">
        <Loader2 className="animate-spin h-8 w-8 text-emerald-600" />
      </div>
    )
  }

  if (!selectedContract && contracts.length === 0) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-1.5">
          <div className="w-10 h-10 bg-gradient-to-br from-emerald-500 to-emerald-600 rounded-xl flex items-center justify-center shadow-lg shadow-emerald-500/20">
            <Briefcase className="w-4 h-4 text-white" />
          </div>
          <div>
            <h1 className="font-display text-xl font-bold text-slate-900 flex items-center gap-2">Workspace <InfoTip title="Workspace overview" text="Your active contracts live here — milestones, deliverables, messaging, escrow payments and file sharing. Each contract is independent; work with multiple freelancers simultaneously without any overlap." /></h1>
            <p className="text-slate-500">Manage your active projects</p>
          </div>
        </div>
        <div className="bg-white rounded-xl p-12 border border-slate-100 text-center">
          <div className="w-20 h-20 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-2">
            <Briefcase className="w-7 h-7 text-slate-400" />
          </div>
          <h3 className="font-display text-xl font-bold text-slate-900 mb-2">No Active Contracts</h3>
          <p className="text-slate-500 max-w-md mx-auto mb-3">
            You don't have any active contracts yet. Post a project and hire a freelancer to get started!
          </p>
        </div>
      </div>
    )
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
        <div className="flex items-center gap-1.5">
          <div className="w-10 h-10 bg-gradient-to-br from-emerald-500 to-emerald-600 rounded-xl flex items-center justify-center shadow-lg shadow-emerald-500/20 flex-shrink-0">
            <Briefcase className="w-4 h-4 text-white" />
          </div>
          <div>
            <h1 className="font-display text-xl font-bold text-slate-900">Collaboration Workspace</h1>
            <p className="text-sm text-slate-500">
              Working with <span className="font-semibold text-slate-700">{selectedContract?.freelancer?.name || 'Freelancer'}</span>
              {(selectedContract?.freelancer as any)?.verification_status === 'verified' && (
                <VerifiedBadge size="xs" className="ml-1.5" />
              )}
              {(selectedContract?.freelancer as any)?.is_pro && (
                <ProBadge size="xs" className="ml-1" />
              )}
              {freelancerRating !== null && freelancerReviewCount > 0 && (
                <span className="ml-2 inline-flex items-center gap-1 text-xs font-semibold text-slate-600">
                  <Star className="w-4 h-4 text-amber-400 fill-amber-400" />
                  {freelancerRating.toFixed(1)}
                  <span className="text-slate-400 font-medium">({freelancerReviewCount})</span>
                </span>
              )}
              {freelancerCerts.length > 0 && (
                <span className="ml-2 inline-flex items-center gap-1.5 flex-wrap">
                  {freelancerCerts.slice(0, 3).map(cert => (
                    <span
                      key={cert.skill}
                      title={`Verified ${cert.skill} — ${cert.level} level (earned via Growlanzo skill assessment)`}
                      className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-50 text-amber-700 text-xs font-bold rounded-full border border-amber-200"
                    >
                      <Award className="w-4 h-4" />
                      {cert.skill}
                    </span>
                  ))}
                  {freelancerCerts.length > 3 && (
                    <span className="text-xs font-bold text-slate-500">+{freelancerCerts.length - 3} more</span>
                  )}
                </span>
              )}
              {selectedContract?.escrow_funded && (
                <span className="ml-2 inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-100 text-emerald-700 text-xs font-bold rounded-full">
                  <ShieldCheck className="w-4 h-4" />
                  Escrow Funded
                </span>
              )}
            </p>
          </div>
        </div>

        {/* Dynamic Nav Tabs */}
        <div className="flex items-center bg-slate-100/80 p-1.5 rounded-xl border border-slate-200/50 self-start lg:self-center">
          <button
            onClick={() => setActiveTab('chat')}
            className={`flex items-center gap-3 px-4 py-2 text-sm font-medium rounded-lg transition-all duration-200 ${
              activeTab === 'chat'
                ? 'bg-white text-emerald-600 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <MessageSquare className="w-4 h-4" />
            <span>Chat & Assets</span>
          </button>

          <button
            onClick={() => setActiveTab('canvas')}
            className={`flex items-center gap-3 px-4 py-2 text-sm font-medium rounded-lg transition-all duration-200 ${
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
            className={`flex items-center gap-3 px-4 py-2 text-sm font-medium rounded-lg transition-all duration-200 ${
              activeTab === 'milestones'
                ? 'bg-white text-emerald-600 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <ClipboardList className="w-4 h-4" />
            <span>Milestones & Escrow</span>
          </button>
        </div>

        {/* Actions: review / fund escrow / status pills */}
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
          {needsFunding && (
            <button
              onClick={() => void openFundEscrow()}
              className="inline-flex items-center px-4 py-2.5 bg-emerald-600 text-white rounded-xl text-sm font-medium hover:bg-emerald-700 transition-colors"
            >
              <IndianRupee className="h-4 w-4 mr-1.5" />
              Fund Escrow
            </button>
          )}
          {isFrozen && (
            <div className="inline-flex items-center px-3 py-1.5 bg-blue-50 text-blue-700 rounded-lg text-sm" title={selectedContract?.freeze_reason || ''}>
              <Snowflake className="h-4 w-4 mr-1.5" />
              Frozen
            </div>
          )}
          {selectedContract?.status === 'disputed' && (
            <div className="inline-flex items-center px-3 py-1.5 bg-red-50 text-red-700 rounded-lg text-sm">
              <AlertCircle className="h-4 w-4 mr-1.5" />
              Dispute Active
            </div>
          )}
          {activeRefund && (
            <div className="inline-flex items-center px-3 py-1.5 bg-amber-50 text-amber-700 rounded-lg text-sm">
              <RotateCcw className="h-4 w-4 mr-1.5" />
              Refund {activeRefund.status.replace('_', ' ')}
            </div>
          )}
        </div>

        {/* Contract Selector */}
        {contracts.length > 1 && (
          <select
            value={selectedContract?.id || ''}
            onChange={(e) => {
              const contract = contracts.find(c => c.id === e.target.value)
              if (contract) {
                setSelectedContract(contract)
                window.history.pushState(null, '', `/client/workspace/${contract.id}`)
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

      {/* Platform Policy — protect both sides (full-width) */}
      <div className="rounded-xl overflow-hidden border border-blue-200 shadow-sm">
        <div className="bg-gradient-to-r from-emerald-700 to-teal-700 px-2.5 py-4 flex items-center gap-1.5">
          <div className="w-7 h-7 bg-white/15 rounded-xl flex items-center justify-center shrink-0">
            <Shield className="w-4 h-4 text-white" />
          </div>
          <div>
            <p className="font-bold text-white text-sm">Growlanzo Payment, Refund & Safety Policy</p>
            <p className="text-xs text-emerald-100">Everything stays on the platform — payments are always protected</p>
          </div>
        </div>
        <div className="bg-blue-50/60 px-2.5 py-4 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
          <div className="flex items-start gap-3.5">
            <div className="w-4 h-4 rounded-full bg-emerald-100 flex items-center justify-center shrink-0 mt-0.5">
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
            </div>
            <p className="text-xs text-slate-700 leading-relaxed">
              <span className="font-bold text-slate-900">Escrow Protection.</span> All payments are held in
              Growlanzo’s escrow ledger — release funds to the freelancer only after you approve the complete work.
            </p>
          </div>
          <div className="flex items-start gap-3.5">
            <div className="w-4 h-4 rounded-full bg-emerald-100 flex items-center justify-center shrink-0 mt-0.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            </div>
            <p className="text-xs text-slate-700 leading-relaxed">
              <span className="font-bold text-slate-900">Release escrow only after approving work.</span> Review every
              deliverable before releasing — once released, funds go to the freelancer. Approve only when you are fully
              satisfied with the delivered work.
            </p>
          </div>
          <div className="flex items-start gap-3.5">
            <div className="w-4 h-4 rounded-full bg-violet-100 flex items-center justify-center shrink-0 mt-0.5">
              <Clock className="w-4 h-4 text-violet-600" />
            </div>
            <p className="text-xs text-slate-700 leading-relaxed">
              <span className="font-bold text-slate-900">Review window & auto-release.</span> Once a freelancer delivers,
              you get a review window (default 72h, adjustable 24h–7 days) to approve. If you don't respond in time, the
              escrow <span className="font-bold text-violet-700">auto-releases to the freelancer automatically</span> —
              funds can never be held hostage. Review promptly or release early to keep the project moving.
            </p>
          </div>
          <div className="flex items-start gap-3.5">
            <div className="w-4 h-4 rounded-full bg-red-100 flex items-center justify-center shrink-0 mt-0.5">
              <AlertTriangle className="w-4 h-4 text-red-600" />
            </div>
            <p className="text-xs text-slate-700 leading-relaxed">
              <span className="font-bold text-slate-900">You cannot pay freelancers outside Growlanzo.</span> All payments
              must happen through Growlanzo Escrow. Paying outside the platform is a violation of our policy — the
              freelancer can report it, and repeat violations lead to <span className="font-bold text-red-600">suspension
              or permanent ban</span>.
            </p>
          </div>
          <div className="flex items-start gap-3.5">
            <div className="w-4 h-4 rounded-full bg-red-100 flex items-center justify-center shrink-0 mt-0.5">
              <AlertTriangle className="w-4 h-4 text-red-600" />
            </div>
            <p className="text-xs text-slate-700 leading-relaxed">
              <span className="font-bold text-slate-900">Freelancer asks for outside payment? Report them.</span>
              Freelancers requesting off-platform payments can be{' '}
              <span className="font-bold text-red-600">suspended or permanently banned</span>. Your money stays protected.
            </p>
          </div>
          <div className="flex items-start gap-3.5">
            <div className="w-4 h-4 rounded-full bg-blue-100 flex items-center justify-center shrink-0 mt-0.5">
              <RotateCcw className="w-4 h-4 text-blue-600" />
            </div>
            <p className="text-xs text-slate-700 leading-relaxed">
              <span className="font-bold text-slate-900">Refunds.</span> If work is not delivered or you are not satisfied,
              raise a <span className="font-medium">refund request / dispute</span> from this workspace. The escrowed amount
              is refunded to you when the freelancer accepts or when our team rules in your favour.
            </p>
          </div>
          <div className="flex items-start gap-3.5">
            <div className="w-4 h-4 rounded-full bg-indigo-100 flex items-center justify-center shrink-0 mt-0.5">
              <CheckCircle2 className="w-4 h-4 text-indigo-600" />
            </div>
            <p className="text-xs text-slate-700 leading-relaxed">
              <span className="font-bold text-slate-900">Revisions.</span> Your service includes free revisions
              (shown before you order). If you request more, the freelancer may charge their published extra-revision
              rate or a mutually agreed price. Agree on the price before extra work begins — never ask freelancers
              to work outside the agreed scope for free.
            </p>
          </div>
          <div className="flex items-start gap-3.5">
            <div className="w-4 h-4 rounded-full bg-slate-100 flex items-center justify-center shrink-0 mt-0.5">
              <Shield className="w-4 h-4 text-slate-600" />
            </div>
            <p className="text-xs text-slate-700 leading-relaxed">
              <span className="font-bold text-slate-900">Legal.</span> All payments, refunds and disputes are governed by
              Growlanzo's Terms of Service, Escrow Policy and Refund Policy. These rules apply to every project on the platform.
            </p>
          </div>
        </div>
      </div>

      {selectedContract && (
        <div className="space-y-1.5">



              {/* Chat & Assets Tab */}
              {activeTab === 'chat' && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-1.5">
                  {/* Messages */}
                  <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200/80 shadow-sm flex flex-col h-[400px] sm:h-[500px] lg:h-[600px]">
                    <div className="p-4 border-b border-slate-100 bg-slate-50/50 rounded-t-2xl flex items-center gap-1.5">
                      <div className="w-8 h-8 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center shrink-0">
                        <MessageSquare className="w-4 h-4" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-slate-900">Project Chat Room</h3>
                        <p className="text-xs text-slate-500">Secure real-time correspondence with {selectedContract.freelancer?.name}</p>
                      </div>
                    </div>
                    <div className="flex-1 overflow-y-auto p-4 space-y-4">
                        {messages.length === 0 && (
                          <div className="flex flex-col items-center justify-center h-full text-slate-400">
                            <MessageSquare className="h-12 w-12 mb-3 opacity-50" />
                            <p>No messages yet. Start the conversation!</p>
                          </div>
                        )}
                        {messages.map(msg => (
                          <div
                            key={msg.id}
                            className={`flex ${msg.sender_id === user?.id ? 'justify-end' : 'justify-start'}`}
                          >
                            <div
                              className={`max-w-[80%] rounded-xl px-4 py-2.5 ${
                                msg.sender_id === user?.id
                                  ? 'bg-emerald-600 text-white rounded-br-md'
                                  : 'bg-slate-100 text-slate-900 rounded-bl-md'
                              }`}
                            >
                              {msg.sender_id !== user?.id && (
                                <p className="text-xs font-medium text-slate-500 mb-1">
                                  {msg.sender?.name || 'Unknown'}
                                </p>
                              )}
                              <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                              <p className={`text-xs mt-1 ${
                                msg.sender_id === user?.id ? 'text-emerald-200' : 'text-slate-400'
                              }`}>
                                {safeFormatTime(msg.created_at, { hour: '2-digit', minute: '2-digit' })}
                              </p>
                            </div>
                          </div>
                        ))}
                        <div ref={chatMessagesEndRef} />
                      </div>

                      {/* Message Input */}
                      <div className="p-4 border-t border-slate-100 bg-slate-50/50 rounded-b-2xl">
                        <div className="flex items-center gap-3">
                          <button
                            onClick={() => {
                              setShowUploadModal(true)
                              setUploadError(null)
                              setUploadBlocked(false)
                            }}
                            className="p-2 text-slate-400 hover:text-slate-600 transition-colors"
                            title="Attach file"
                          >
                            <Paperclip className="h-5 w-5" />
                          </button>
                          <input
                            type="text"
                            value={newMessage}
                            onChange={e => setNewMessage(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault()
                                void handleSendMessage()
                              }
                            }}
                            placeholder="Type your message..."
                            className="flex-1 px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 text-slate-900"
                          />
                          <button
                            onClick={() => void handleSendMessage()}
                            disabled={!newMessage.trim() || sendingMessage}
                            aria-label="Send message"
                            className="p-2.5 bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                          >
                            {sendingMessage ? (
                              <Loader2 className="h-5 w-5 animate-spin" />
                            ) : (
                              <Send className="h-5 w-5" />
                            )}
                          </button>
                        </div>
                      </div>
                    </div>

                  {/* Shared Assets */}
                  <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm flex flex-col h-[400px] sm:h-[500px] lg:h-[600px]">
                    <div className="p-4 border-b border-slate-100 bg-slate-50/50 rounded-t-2xl">
                      <div className="flex items-center justify-between">
                        <h3 className="font-semibold text-slate-900 flex items-center gap-3">
                          <FileText className="h-4 w-4" />
                          Shared Assets
                        </h3>
                        <button
                          onClick={() => {
                            setShowUploadModal(true)
                            setUploadError(null)
                            setUploadBlocked(false)
                          }}
                          className="text-sm text-emerald-600 hover:text-emerald-700"
                        >
                          + Upload
                        </button>
                      </div>
                    </div>
                    <div className="flex-1 overflow-y-auto">
                      {contractFiles.length === 0 ? (
                        <div className="p-4 text-center text-slate-500 text-sm">
                          <FileText className="h-8 w-8 mx-auto mb-2 opacity-50 text-slate-400" />
                          <p>No files shared yet</p>
                        </div>
                      ) : (
                        contractFiles.map((file: any) => (
                          <div
                            key={file.id}
                            className="p-4 border-b border-slate-200 hover:bg-slate-100 transition-colors"
                          >
                            <div className="flex items-start justify-between">
                              <div className="flex-1 min-w-0 break-words">
                                <p className="text-sm font-medium text-slate-900">
                                  {file.file_name || file.name}
                                </p>
                                {file.description && (
                                  <p className="text-xs text-slate-500 mt-0.5 truncate">
                                    {file.description}
                                  </p>
                                )}
                                <p className="text-xs text-slate-400 mt-1">
                                  {file.file_size
                                    ? `${(file.file_size / 1024).toFixed(1)} KB`
                                    : ''}
                                </p>
                              </div>
                              <div className="flex items-center gap-1 ml-2">
                                <a
                                  href={file.public_url || file.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="p-1.5 text-slate-400 hover:text-emerald-600 transition-colors"
                                  title="Download"
                                >
                                  <Download className="h-4 w-4" />
                                </a>
                                {file.uploaded_by === user?.id && (
                                  <button
                                    onClick={() => void handleDeleteFile(file.id)}
                                    className="p-1.5 text-slate-400 hover:text-red-600 transition-colors"
                                    title="Delete"
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Co-Working Canvas Tab */}
              {activeTab === 'canvas' && (
                <div className="grid grid-cols-1 lg:grid-cols-5 gap-1.5">
                  {/* Live Task Board */}
                  <div className="lg:col-span-3 bg-white rounded-xl border border-slate-200/80 shadow-sm flex flex-col">
                    <div className="p-4 border-b border-slate-100 bg-slate-50/50 rounded-t-2xl">
                      <h3 className="font-semibold text-slate-900 flex items-center gap-3">
                        <ClipboardList className="h-4 w-4" />
                        Live Task Board
                      </h3>
                    </div>
                    <div className="p-4 flex-1 overflow-y-auto">
                      <TasksSection
                        contractId={selectedContract.id}
                        getTasks={getTasks}
                        handleAddTask={handleAddTask}
                        handleUpdateTaskStatus={handleUpdateTaskStatus}
                        handleDeleteTask={handleDeleteTask}
                        taskInput={taskInput}
                        setTaskInput={setTaskInput}
                      />
                    </div>
                  </div>

                  {/* Collaborative Scratchpad */}
                  <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200/80 shadow-sm flex flex-col">
                    <div className="p-4 border-b border-slate-100 bg-slate-50/50 rounded-t-2xl">
                      <div className="flex items-center justify-between">
                        <h3 className="font-semibold text-slate-900 flex items-center gap-3">
                          <FileText className="h-4 w-4" />
                          Collaborative Scratchpad
                        </h3>
                        <span className={`text-xs flex items-center gap-1 ${
                          notesSaveStatus === 'saved'
                            ? 'text-green-600'
                            : notesSaveStatus === 'saving'
                            ? 'text-yellow-600'
                            : 'text-slate-400'
                        }`}>
                          {notesSaveStatus === 'saved' && <><Check className="h-3 w-3" /> Saved</>}
                          {notesSaveStatus === 'saving' && <><Loader2 className="h-3 w-3 animate-spin" /> Saving...</>}
                          {notesSaveStatus === 'unsaved' && 'Unsaved'}
                        </span>
                      </div>
                    </div>
                    <div className="p-4">
                      <textarea
                        value={notesText}
                        onChange={handleNoteChange}
                        placeholder="Share notes, ideas, or requirements with your freelancer..."
                        className="w-full h-[calc(100vh-24rem)] p-4 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-none text-slate-900"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Milestones & Escrow Tab */}
              {activeTab === 'milestones' && (
                <div className="space-y-1.5">
                  {/* Timeline */}
                  <div className="bg-white rounded-xl border border-slate-200/80 p-6">
                    <h3 className="text-lg font-semibold text-slate-900 mb-2">
                      Contract Timeline
                    </h3>
                    <div className="relative">
                      <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-slate-200" />
                      {getTimelineEvents().map((event, idx) => (
                        <div key={idx} className="relative flex items-start gap-3 pb-6 last:pb-0">
                          <div className={`relative z-10 w-8 h-8 rounded-full flex items-center justify-center ${
                            event.status === 'completed'
                              ? 'bg-green-100'
                              : event.status === 'current'
                              ? 'bg-amber-100'
                              : 'bg-slate-100'
                          }`}>
                            {event.icon === 'file' && <FileText className={`h-4 w-4 ${event.status === 'completed' ? 'text-green-600' : 'text-slate-400'}`} />}
                            {event.icon === 'rupee' && <IndianRupee className={`h-4 w-4 ${event.status === 'completed' ? 'text-green-600' : event.status === 'current' ? 'text-amber-600' : 'text-slate-400'}`} />}
                            {event.icon === 'check' && <CheckCircle2 className={`h-4 w-4 ${event.status === 'completed' ? 'text-green-600' : event.status === 'current' ? 'text-amber-600' : 'text-slate-400'}`} />}
                            {event.icon === 'alert' && <AlertCircle className="h-4 w-4 text-red-500" />}
                          </div>
                          <div className="flex-1 pt-1">
                            <h4 className={`text-sm font-semibold ${
                              event.status === 'completed'
                                ? 'text-green-700'
                                : event.status === 'current'
                                ? 'text-amber-700'
                                : 'text-slate-500'
                            }`}>
                              {event.title}
                            </h4>
                            <p className="text-sm text-slate-500 mt-0.5">{event.description}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Milestones */}
                  <div className="bg-white rounded-xl border border-slate-200/80 p-6">
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-lg font-semibold text-slate-900">
                        Milestones
                      </h3>
                      <span className="text-sm text-slate-500">
                        {milestoneProgress.completed} of {milestoneProgress.total} completed
                      </span>
                    </div>
                    <div className="w-full bg-slate-200 rounded-full h-2.5 mb-2">
                      <div
                        className="bg-emerald-600 h-2.5 rounded-full transition-all duration-500"
                        style={{ width: `${milestoneProgress.percent}%` }}
                      />
                    </div>

                    {/* Auto-release window control (client) */}
                    <div className="mb-2.5 p-4 rounded-xl bg-violet-50/60 border border-violet-200">
                      <p className="text-sm font-medium text-slate-900 flex items-center gap-3">
                        <Clock className="h-4 w-4 text-violet-600" />
                        Auto-Release Window
                      </p>
                      <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                        When a milestone is delivered, the payment releases automatically after this many hours
                        if you haven't reviewed it. Set a window that gives you enough review time.
                      </p>
                      <div className="flex items-center gap-3 mt-3">
                        <input
                          type="number"
                          min="10"
                          max="168"
                          value={autoReleaseHours}
                          onChange={(e) => setAutoReleaseHours(e.target.value)}
                          className="w-28 px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm text-slate-900 focus:ring-2 focus:ring-violet-500 focus:border-violet-500 outline-none"
                        />
                        <span className="text-sm text-slate-600">hours (10–168)</span>
                        <button
                          onClick={() => void handleSetAutoReleaseHours()}
                          disabled={savingAutoRelease}
                          className="inline-flex items-center justify-center gap-3 px-4 py-2.5 bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 disabled:opacity-50 transition-colors text-sm font-medium"
                        >
                          {savingAutoRelease ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Check className="h-4 w-4 mr-1.5" />}
                          Apply
                        </button>
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      {milestones.map((milestone, idx) => (
                        <div
                          key={idx}
                          className="flex items-center justify-between p-3 bg-slate-50 rounded-lg"
                        >
                          <div className="flex items-center gap-1.5">
                            <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center ${
                              milestone.status === 'completed'
                                ? 'border-green-500 bg-green-50'
                                : milestone.status === 'delivered'
                                ? 'border-violet-500 bg-violet-50'
                                : milestone.status === 'in_progress'
                                ? 'border-amber-500 bg-amber-50'
                                : 'border-slate-300'
                            }`}>
                              {milestone.status === 'completed' && <Check className="h-3 w-3 text-green-600" />}
                              {milestone.status === 'delivered' && <Clock className="h-3 w-3 text-violet-600" />}
                              {milestone.status === 'in_progress' && <Play className="h-3 w-3 text-amber-600" />}
                            </div>
                            <div>
                              <p className="text-sm font-medium text-slate-900">
                                {milestone.title}
                              </p>
                              {milestone.description && (
                                <p className="text-xs text-slate-500 mt-0.5">
                                  {milestone.description}
                                </p>
                              )}
                              {milestone.status === 'delivered' && (
                                <p className="text-xs text-violet-700 mt-1 font-medium">
                                  Delivered — review & release within {milestone.auto_release_hours ?? 10}h or payment releases automatically
                                </p>
                              )}
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="text-sm font-medium text-slate-900">
                              {formatCurrency(milestone.amount)}
                            </p>
                            <p className="text-xs text-slate-500 capitalize">
                              {milestone.status === 'in_progress' ? 'In Progress' : milestone.status === 'delivered' ? 'Delivered' : milestone.status}
                            </p>
                          </div>
                        </div>
                      ))}
                      {milestones.length === 0 && (
                        <div className="text-center py-4">
                          <p className="text-sm text-slate-500">
                            Full contract escrow — no milestones.
                          </p>
                          {(selectedContract as any).delivered_at ? (
                            <div className="mt-3 p-3.5 bg-violet-50 border border-violet-200 rounded-xl text-left">
                              <p className="text-xs font-bold text-violet-800 flex items-center gap-1.5">
                                <Clock className="w-4 h-4" />
                                Delivered — review & release within {(selectedContract as any).auto_release_hours ?? 10}h
                              </p>
                              <p className="text-xs text-violet-700 mt-1 leading-relaxed">
                                The freelancer has delivered the full project. Review the files and release the escrow when
                                satisfied — if you don't respond within{' '}
                                <strong>{(selectedContract as any).auto_release_hours ?? 10} hours</strong>, the payment
                                releases to the freelancer automatically.
                              </p>
                            </div>
                          ) : (
                            <p className="text-xs text-slate-400 mt-1">
                              Once the freelancer delivers, you get a review window before auto-release.
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Escrow Actions */}
                  <div className="bg-white rounded-xl border border-slate-200/80 p-6">
                    <h3 className="text-lg font-semibold text-slate-900 mb-2">
                      Escrow & Payment
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <div className="p-4 bg-slate-50 rounded-lg">
                        <p className="text-sm text-slate-500 mb-1">Total Amount</p>
                        <p className="text-xl font-bold text-slate-900">
                          {formatCurrency(selectedContract.amount)}
                        </p>
                      </div>
                      <div className="p-4 bg-slate-50 rounded-lg">
                        <p className="text-sm text-slate-500 mb-1">Status</p>
                        <div className="flex items-center gap-3 mt-1">
                          {selectedContract.escrow_funded ? (
                            <ShieldCheck className="h-5 w-5 text-green-500" />
                          ) : (
                            <Lock className="h-5 w-5 text-slate-400" />
                          )}
                          <p className="text-lg font-semibold text-slate-900">
                            {/* After a full release the escrow row flips to
                                released/refunded and escrow_funded resets — a
                                completed contract must read "Released", not
                                "Awaiting Funding". */}
                            {selectedContract.escrow_funded
                              ? 'Funded'
                              : ['completed', 'cancelled'].includes(String(selectedContract.status || ''))
                              ? 'Released'
                              : 'Awaiting Funding'}
                          </p>
                        </div>
                      </div>
                      <div className="p-4 bg-slate-50 rounded-lg">
                        <p className="text-sm text-slate-500 mb-1">Contract Status</p>
                        <p className="text-lg font-semibold text-slate-900 capitalize">
                          {selectedContract.status.replace('_', ' ')}
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5 mt-6">
                      {needsFunding && (
                        <button
                          onClick={() => void openFundEscrow()}
                          className="inline-flex items-center justify-center gap-3 px-3 py-3 bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 transition-colors font-semibold"
                        >
                          <IndianRupee className="h-5 w-5 mr-2" />
                          Fund Escrow
                        </button>
                      )}
                      {selectedContract.escrow_funded && selectedContract.status !== 'completed' && selectedContract.status !== 'disputed' && (
                        <button
                          onClick={() => void handleReleaseEscrow()}
                          disabled={releasingEscrow}
                          className="inline-flex items-center justify-center gap-3 px-3 py-3 bg-green-600 text-white rounded-xl hover:bg-green-700 disabled:opacity-50 transition-colors font-semibold"
                        >
                          {releasingEscrow ? (
                            <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                          ) : (
                            <CheckCircle2 className="h-5 w-5 mr-2" />
                          )}
                          Release Escrow
                        </button>
                      )}
                      {selectedContract.status !== 'disputed' && !isFrozen && selectedContract.escrow_funded && (
                        <button
                          onClick={() => setShowDisputeModal(true)}
                          className="inline-flex items-center px-3 py-3 bg-red-50 text-red-700 rounded-xl hover:bg-red-100 transition-colors font-medium"
                        >
                          <AlertCircle className="h-5 w-5 mr-2" />
                          Raise Dispute
                        </button>
                      )}
                      {selectedContract.status !== 'disputed' && !isFrozen && selectedContract.status !== 'completed' && (
                        <button
                          onClick={() => setShowRefundModal(true)}
                          disabled={!!activeRefund}
                          className="inline-flex items-center px-3 py-3 bg-slate-100 text-slate-700 rounded-xl hover:bg-slate-200 disabled:opacity-50 transition-colors font-medium"
                        >
                          <RotateCcw className="h-5 w-5 mr-2" />
                          {activeRefund ? 'Refund In Progress' : 'Cancel Project / Request Refund'}
                        </button>
                      )}
                      {selectedContract.status !== 'disputed' && !isFrozen && selectedContract.status !== 'completed' && !activeRevision && (
                        <button
                          onClick={() => setShowRevisionModal(true)}
                          className="inline-flex items-center px-3 py-3 bg-emerald-50 text-emerald-700 rounded-xl hover:bg-emerald-100 transition-colors font-medium"
                        >
                          <RefreshCw className="h-5 w-5 mr-2" />
                          Request Extra Revision
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Extra Revision Panel */}
                  {revisionRequests.length > 0 && (
                    <div className="bg-white rounded-xl border border-slate-200/80 p-6">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-3">
                          <RefreshCw className="h-5 w-5 text-emerald-600" />
                          <h3 className="text-lg font-semibold text-slate-900">Extra Revisions</h3>
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        {revisionRequests.map((req) => (
                          <div key={req.id} className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
                            <div className="flex items-start justify-between gap-1.5">
                              <div className="min-w-0">
                                <p className="text-sm font-medium text-slate-900">
                                  {req.revision_count} revision{req.revision_count > 1 ? 's' : ''} ·{' '}
                                  <span className="text-emerald-600 font-semibold">{formatCurrency(Number(req.total_amount))}</span>
                                </p>
                                <p className="text-xs text-slate-500 mt-1 line-clamp-4">{req.reason}</p>
                              </div>
                              <div className="flex flex-col items-end gap-3 shrink-0">
                                <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${req.status === 'paid' ? 'bg-emerald-100 text-emerald-700' : req.status === 'accepted' ? 'bg-blue-100 text-blue-700' : req.status === 'pending_freelancer' ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>
                                  {req.status === 'paid' ? 'Paid — In Escrow' : req.status === 'accepted' ? 'Accepted — Awaiting Payment' : req.status === 'pending_freelancer' ? 'Awaiting Freelancer' : 'Declined'}
                                </span>
                                {req.status === 'accepted' && (
                                  <button
                                    onClick={() => void handlePayRevision(req)}
                                    disabled={payingRevision === req.id}
                                    className="inline-flex items-center justify-center gap-3 px-4 py-2.5 bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 disabled:opacity-50 transition-colors text-sm font-medium"
                                  >
                                    {payingRevision === req.id ? (
                                      <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                                    ) : (
                                      <CreditCard className="h-4 w-4 mr-1.5" />
                                    )}
                                    Pay {formatCurrency(Number(req.total_amount))}
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Refunds & Cancellation Panel */}
                  {(refundRequests.length > 0 || selectedContract.cancellation_status === 'pending_freelancer') && (
                    <div className="bg-white rounded-xl border border-slate-200/80 p-6">
                      <div className="flex items-center justify-between mb-2">
                        <h3 className="text-lg font-semibold text-slate-900 flex items-center gap-3">
                          <RotateCcw className="h-5 w-5 text-amber-500" />
                          Refund & Cancellation
                        </h3>
                        {activeRefund && (
                          <span className="text-xs px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 font-medium capitalize">
                            {activeRefund.status.replace('_', ' ')}
                          </span>
                        )}
                      </div>

                      {refundRequests.map(req => (
                        <div key={req.id} className="p-4 bg-slate-50 rounded-xl mb-2">
                          <div className="flex items-center justify-between flex-wrap gap-3">
                            <div>
                              <p className="text-sm font-semibold text-slate-900">{req.reason}</p>
                              <p className="text-xs text-slate-500 mt-0.5 capitalize">
                                {req.request_type.replace(/_/g, ' ')}
                              </p>
                            </div>
                            <div className="text-right">
                              <p className="text-sm font-bold text-slate-900">
                                {formatCurrency(Number(req.refund_amount))}
                              </p>
                              <p className="text-xs text-slate-500 capitalize">{req.status.replace(/_/g, ' ')}</p>
                            </div>
                          </div>
                        </div>
                      ))}

                      {refundHistory.length > 0 && (
                        <div>
                          <p className="text-sm font-semibold text-slate-900 mb-3 flex items-center gap-3">
                            <History className="h-4 w-4 text-slate-400" />
                            Timeline
                          </p>
                          <div className="relative">
                            <div className="absolute left-3 top-0 bottom-0 w-0.5 bg-slate-200" />
                            {refundHistory.map((ev, idx) => (
                              <div key={idx} className="relative flex items-start gap-1.5 pb-4 last:pb-0">
                                <div className="relative z-10 w-6 h-6 rounded-full bg-amber-100 flex items-center justify-center">
                                  <RotateCcw className="h-3 w-3 text-amber-600" />
                                </div>
                                <div className="flex-1 pt-0.5">
                                  <p className="text-sm font-medium text-slate-800 capitalize">{ev.event.replace(/_/g, ' ')}</p>
                                  {ev.note && <p className="text-xs text-slate-500 mt-0.5">{ev.note}</p>}
                                  <p className="text-xs text-slate-400 mt-0.5">
                                    {new Date(ev.created_at).toLocaleString()}
                                  </p>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
          </div>
        )}

      {/* File Upload Modal */}
      {showUploadModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md my-auto max-h-[calc(100vh-2rem)] overflow-y-auto">
            <div className="flex items-center justify-between p-3 border-b border-slate-200">
              <h3 className="text-lg font-semibold text-slate-900">Upload File</h3>
              <button
                onClick={() => {
                  setShowUploadModal(false)
                  setSelectedFile(null)
                  setFileDescription('')
                  setUploadError(null)
                  setUploadBlocked(false)
                }}
                className="p-1 hover:bg-slate-100 rounded-lg transition-colors"
              >
                <X className="h-5 w-5 text-slate-500" />
              </button>
            </div>
            <div className="p-3 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  File
                </label>
                <input
                  type="file"
                  onChange={e => {
                    const file = e.target.files?.[0] || null
                    setSelectedFile(file)
                    setUploadError(null)
                    setUploadBlocked(false)
                    if (file) {
                      const ALLOWED_TYPES = [
                        'image/jpeg', 'image/png', 'image/gif', 'image/webp',
                        'application/pdf',
                        'application/msword',
                        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                        'application/vnd.ms-excel',
                        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                        'application/vnd.ms-powerpoint',
                        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
                        'text/plain', 'text/csv', 'application/zip', 'application/x-zip-compressed',
                      ]
                      if (file.size > 25 * 1024 * 1024) {
                        setUploadError('File exceeds the 25MB size limit')
                        setUploadBlocked(true)
                      } else if (!ALLOWED_TYPES.includes(file.type)) {
                        setUploadError('File type not supported. Use images, PDF, Word, Excel, PowerPoint, text, CSV, or ZIP.')
                        setUploadBlocked(true)
                      }
                    }
                  }}
                  className="w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-sm file:font-medium file:bg-emerald-50 file:text-emerald-700 hover:file:bg-emerald-100"
                />
                {uploadError && (
                  <p className="mt-2 flex items-start gap-1.5 text-xs text-red-600">
                    <AlertCircle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                    {uploadError}
                  </p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Description (optional)
                </label>
                <input
                  type="text"
                  value={fileDescription}
                  onChange={e => setFileDescription(e.target.value)}
                  placeholder="Brief description of the file..."
                  className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 text-slate-900"
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-1.5 p-3 border-t border-slate-200">
              <button
                onClick={() => {
                  setShowUploadModal(false)
                  setSelectedFile(null)
                  setFileDescription('')
                  setUploadError(null)
                  setUploadBlocked(false)
                }}
                className="px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-xl transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => void handleFileUpload()}
                disabled={!selectedFile || uploadingFile || uploadBlocked}
                className="inline-flex items-center px-4 py-2.5 bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 disabled:opacity-50 transition-colors text-sm font-medium"
              >
                {uploadingFile ? (
                  <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                ) : (
                  <Upload className="h-4 w-4 mr-1.5" />
                )}
                Upload
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Raise Dispute Modal */}
      {showDisputeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg my-auto max-h-[calc(100vh-2rem)] overflow-y-auto">
            <div className="flex items-center justify-between p-3 border-b border-slate-200">
              <h3 className="text-lg font-semibold text-slate-900">Raise a Dispute</h3>
              <button
                onClick={() => {
                  setShowDisputeModal(false)
                  setDisputeReason('')
                  setDisputeDescription('')
                }}
                className="p-1 hover:bg-slate-100 rounded-lg transition-colors"
              >
                <X className="h-5 w-5 text-slate-500" />
              </button>
            </div>
            <div className="p-3 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Reason <span className="text-red-500">*</span>
                </label>
                <select
                  value={disputeReason}
                  onChange={e => setDisputeReason(e.target.value)}
                  className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 text-slate-900"
                >
                  <option value="">Select a reason...</option>
                  <option value="incomplete_work">Incomplete Work</option>
                  <option value="poor_quality">Poor Quality</option>
                  <option value="missed_deadline">Missed Deadline</option>
                  <option value="no_show">No Show / Unresponsive</option>
                  <option value="scope_disagreement">Scope Disagreement</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Description
                </label>
                <textarea
                  value={disputeDescription}
                  onChange={e => setDisputeDescription(e.target.value)}
                  placeholder="Provide details about the issue..."
                  rows={4}
                  className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-none text-slate-900"
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-1.5 p-3 border-t border-slate-200">
              <button
                onClick={() => {
                  setShowDisputeModal(false)
                  setDisputeReason('')
                  setDisputeDescription('')
                }}
                className="px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-xl transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => void handleRaiseDispute()}
                disabled={!disputeReason.trim() || submittingDispute}
                className="inline-flex items-center px-4 py-2.5 bg-red-600 text-white rounded-xl hover:bg-red-700 disabled:opacity-50 transition-colors text-sm font-medium"
              >
                {submittingDispute ? (
                  <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                ) : (
                  <AlertCircle className="h-4 w-4 mr-1.5" />
                )}
                Submit Dispute
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Request Refund / Cancel Project Modal */}
      {showRefundModal && selectedContract && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg my-auto max-h-[calc(100vh-2rem)] overflow-y-auto">
            <div className="flex items-center justify-between p-3 border-b border-slate-200">
              <h3 className="text-lg font-semibold text-slate-900">Cancel Project / Request Refund</h3>
              <button
                onClick={() => {
                  setShowRefundModal(false)
                  setRefundReason('')
                  setRefundDescription('')
                }}
                className="p-1 hover:bg-slate-100 rounded-lg transition-colors"
              >
                <X className="h-5 w-5 text-slate-500" />
              </button>
            </div>
            <div className="p-3 space-y-4">
              <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800">
                {selectedContract.freelancer_started_at || (milestones.some(m => ['released', 'paid', 'completed', 'approved'].includes(m.status)))
                  ? 'Work has started on this project. The freelancer must accept your cancellation; if they decline, the case goes to dispute resolution. Released milestones are never refunded.'
                  : 'Work has not started yet. Your escrow will be refunded automatically — no questions asked, no platform fee.'}
              </div>

              {/* How refunds work — genuine-client path clarity */}
              <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl">
                <p className="text-xs font-bold text-emerald-900 mb-2 flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4" />
                  Your money is always protected — how refunds work here
                </p>
                <ul className="space-y-1.5 text-xs text-emerald-800 leading-relaxed">
                  <li className="flex items-start gap-1.5">
                    <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
                    <span><strong>Work not started</strong> — your escrow refunds automatically, in full, with no platform fee.</span>
                  </li>
                  <li className="flex items-start gap-1.5">
                    <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
                    <span><strong>Work started / delivered</strong> — the freelancer can accept (full refund) or reject, and the case is escalated to our resolution team with escrow frozen until a fair decision.</span>
                  </li>
                  <li className="flex items-start gap-1.5">
                    <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
                    <span><strong>Fraud, scam or non-delivery claims</strong> — escrow freezes instantly and our team reviews the workspace evidence (files, chat, timeline) before any money moves.</span>
                  </li>
                  <li className="flex items-start gap-1.5">
                    <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                    <span><strong>Tip:</strong> before requesting a refund, try a <strong>free revision</strong> — most issues are fixed within the included revisions and everyone saves time.</span>
                  </li>
                </ul>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Reason <span className="text-red-500">*</span>
                </label>
                <select
                  value={refundReason}
                  onChange={e => setRefundReason(e.target.value)}
                  className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 text-slate-900"
                >
                  <option value="">Select a reason...</option>
                  <option value="changed_mind">Changed my mind before work started</option>
                  <option value="scope_change">Project scope changed</option>
                  <option value="no_longer_needed">No longer needed</option>
                  <option value="duplicate_payment">Duplicate payment</option>
                  <option value="poor_quality">Poor quality of work</option>
                  <option value="missed_deadline">Missed deadline</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Description
                </label>
                <textarea
                  value={refundDescription}
                  onChange={e => setRefundDescription(e.target.value)}
                  placeholder="Provide details..."
                  rows={4}
                  className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-none text-slate-900"
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-1.5 p-3 border-t border-slate-200">
              <button
                onClick={() => {
                  setShowRefundModal(false)
                  setRefundReason('')
                  setRefundDescription('')
                }}
                className="px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-xl transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => void handleRequestRefund()}
                disabled={!refundReason.trim() || submittingRefund}
                className="inline-flex items-center px-4 py-2.5 bg-amber-600 text-white rounded-xl hover:bg-amber-700 disabled:opacity-50 transition-colors text-sm font-medium"
              >
                {submittingRefund ? (
                  <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                ) : (
                  <RotateCcw className="h-4 w-4 mr-1.5" />
                )}
                Submit Request
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Request Extra Revision Modal — compact & responsive */}
      {showRevisionModal && selectedContract && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-3 sm:p-4 overflow-y-auto">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md my-auto max-h-[calc(100vh-2rem)] overflow-y-auto">
            <div className="flex items-center justify-between p-4 sm:p-3 border-b border-slate-200 sticky top-0 bg-white z-10">
              <h3 className="text-base sm:text-lg font-semibold text-slate-900">Request Extra Revision</h3>
              <button
                onClick={() => setShowRevisionModal(false)}
                className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors"
              >
                <X className="h-5 w-5 text-slate-500" />
              </button>
            </div>
            <div className="p-4 sm:p-5 space-y-4">
              <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3 sm:p-4 text-xs sm:text-sm text-emerald-800 leading-relaxed">
                <p className="font-medium flex items-center gap-1.5">
                  <Info className="h-4 w-4 shrink-0" />
                  How extra revisions work
                </p>
                <p className="mt-1.5">
                  Your service agreement includes free revisions. Requests beyond that are paid — the freelancer
                  accepts your price request first, then you pay securely through escrow. Funds are only released
                  when you approve the revised work.
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Number of revisions *</label>
                <select
                  value={revisionCount}
                  onChange={(e) => setRevisionCount(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
                >
                  {[1, 2, 3, 5, 10].map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
                <p className="text-xs text-slate-500 mt-1.5">
                  The freelancer will quote a total price for these revisions based on their published extra-revision rate.
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">What needs to change? *</label>
                <textarea
                  value={revisionReason}
                  onChange={(e) => setRevisionReason(e.target.value)}
                  rows={3}
                  placeholder="Describe the changes you need (min 5 characters)..."
                  className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none resize-none"
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-1.5 p-4 sm:p-3 border-t border-slate-200">
              <button
                onClick={() => setShowRevisionModal(false)}
                className="px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-xl transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => void handleRequestExtraRevision()}
                disabled={!revisionReason.trim() || submittingRevision}
                className="inline-flex items-center px-4 py-2.5 bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 disabled:opacity-50 transition-colors text-sm font-medium"
              >
                {submittingRevision ? (
                  <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4 mr-1.5" />
                )}
                Send Request
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Fund Escrow Modal — compact & responsive */}
      {showFundEscrow && selectedContract && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-3 sm:p-4 overflow-y-auto">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md my-auto max-h-[calc(100vh-2rem)] overflow-y-auto">
            <div className="flex items-center justify-between p-4 sm:p-3 border-b border-slate-200 sticky top-0 bg-white z-10">
              <h3 className="text-base sm:text-lg font-semibold text-slate-900">Fund Escrow</h3>
              <button
                onClick={() => setShowFundEscrow(false)}
                className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors"
                aria-label="Close"
              >
                <X className="h-5 w-5 text-slate-500" />
              </button>
            </div>
            <div className="px-4 sm:px-2.5 pt-4">
              <p className="text-sm text-slate-500 mb-3">
                Fund the escrow account for{' '}
                <span className="font-semibold text-slate-900">
                  {formatCurrency(selectedContract.amount)}
                </span>{' '}
                to begin working with{' '}
                <span className="font-semibold text-slate-900">
                  {selectedContract.freelancer?.name || 'the freelancer'}
                </span>
                . Funds are securely held and only released upon your approval.
              </p>
            </div>
            <EscrowPayPalPayment
              contractId={selectedContract.id}
              amount={selectedContract.amount}
              freelancerName={selectedContract.freelancer?.name || 'the freelancer'}
              projectTitle={selectedContract.project?.title || 'Project'}
              onSuccess={() => {
                setShowFundEscrow(false)
                void refreshContract(selectedContract.id)
              }}
              onCancel={() => setShowFundEscrow(false)}
            />
          </div>
        </div>
      )}

      {/* Leave Review Modal — after contract completion */}
      {reviewModalOpen && selectedContract && (
        <ReviewModal
          contractId={selectedContract.id}
          revieweeId={selectedContract.freelancer_id}
          revieweeName={(selectedContract.freelancer as any)?.name || 'Freelancer'}
          projectTitle={(selectedContract.project as any)?.title}
          onClose={() => setReviewModalOpen(false)}
          onSubmitted={() => {
            setReviewedContractIds(prev => new Set(prev).add(selectedContract.id))
            toast.success('Review Submitted', 'Thank you! Your review has been published and the contract is now in your history.')
            // After review, the workspace closes — only the contract history remains.
            navigate('/client/contracts?tab=completed')
          }}
        />
      )}
    </div>
  )
}

/* ─── Tasks Section Subcomponent ─── */

function TasksSection({
  contractId,
  getTasks,
  handleAddTask,
  handleUpdateTaskStatus,
  handleDeleteTask,
  taskInput,
  setTaskInput,
}: {
  contractId: string
  getTasks: () => Promise<SharedTask[]>
  handleAddTask: () => Promise<void>
  handleUpdateTaskStatus: (taskId: string, newStatus: string) => Promise<void>
  handleDeleteTask: (taskId: string) => Promise<void>
  taskInput: string
  setTaskInput: (val: string) => void
}) {
  const [tasks, setTasks] = useState<SharedTask[]>([])
  const [dragIndex, setDragIndex] = useState<number | null>(null)

  useEffect(() => {
    void (async () => {
      const t = await getTasks()
      setTasks(t)
    })()
  }, [getTasks])

  useEffect(() => {
    const channel = supabase
      .channel(`tasks-${contractId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'workspace_tasks', filter: `contract_id=eq.${contractId}` },
        async () => {
          const t = await getTasks()
          setTasks(t)
        }
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [contractId, getTasks])

  const handleLocalAdd = async () => {
    await handleAddTask()
    const t = await getTasks()
    setTasks(t)
  }

  const handleLocalStatusChange = async (taskId: string, newStatus: string) => {
    await handleUpdateTaskStatus(taskId, newStatus)
    const t = await getTasks()
    setTasks(t)
  }

  const handleLocalDelete = async (taskId: string) => {
    await handleDeleteTask(taskId)
    const t = await getTasks()
    setTasks(t)
  }

  const handleDragStart = (idx: number) => setDragIndex(idx)
  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault()
    if (dragIndex === null || dragIndex === idx) return
    const reordered = [...tasks]
    const [moved] = reordered.splice(dragIndex, 1)
    reordered.splice(idx, 0, moved)
    setTasks(reordered)
    setDragIndex(idx)
  }
  const handleDragEnd = () => {
    setDragIndex(null)
  }

  return (
    <div>
      {/* Add Task */}
      <div className="flex items-center gap-3 mb-2">
        <input
          type="text"
          value={taskInput}
          onChange={e => setTaskInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void handleLocalAdd()
            }
          }}
          placeholder="Add a new task..."
          className="flex-1 px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 text-slate-900"
        />
        <button
          onClick={() => void handleLocalAdd()}
          disabled={!taskInput.trim()}
          className="p-2 bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 disabled:opacity-50 transition-colors"
        >
          <Plus className="h-5 w-5" />
        </button>
      </div>

      {/* Task Columns */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5">
        {['todo', 'in_progress', 'completed'].map(status => (
          <div
            key={status}
            className="bg-slate-50 rounded-xl p-3"
            onDragOver={e => e.preventDefault()}
            onDrop={e => {
              e.preventDefault()
              if (dragIndex === null) return
              const task = tasks[dragIndex]
              if (task && task.status !== status) {
                void handleLocalStatusChange(task.id, status)
              }
              setDragIndex(null)
            }}
          >
            <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
              {status === 'todo' ? 'To Do' : status.replace('_', ' ')}
            </h4>
            <div className="space-y-4">
              {tasks
                .filter(t => t.status === status)
                .map(task => (
                  <div
                    key={task.id}
                    draggable
                    onDragStart={() => handleDragStart(tasks.indexOf(task))}
                    onDragOver={e => handleDragOver(e, tasks.indexOf(task))}
                    onDragEnd={handleDragEnd}
                    className={`bg-white rounded-lg p-3 shadow-sm border border-slate-200 cursor-grab active:cursor-grabbing ${
                      dragIndex === tasks.indexOf(task) ? 'opacity-50' : ''
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-sm text-slate-900 flex-1">{task.title}</p>
                      <button
                        onClick={() => void handleLocalDelete(task.id)}
                        className="p-0.5 text-slate-300 hover:text-red-500 transition-colors flex-shrink-0"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <div className="flex items-center gap-1 mt-2">
                      {status !== 'todo' && (
                        <button
                          onClick={() => void handleLocalStatusChange(task.id, 'todo')}
                          className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors"
                        >
                          ← To Do
                        </button>
                      )}
                      {status !== 'in_progress' && (
                        <button
                          onClick={() => void handleLocalStatusChange(task.id, 'in_progress')}
                          className="text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-600 hover:bg-amber-100 transition-colors"
                        >
                          In Progress →
                        </button>
                      )}
                      {status !== 'completed' && (
                        <button
                          onClick={() => void handleLocalStatusChange(task.id, 'completed')}
                          className="text-xs px-2 py-0.5 rounded-full bg-green-50 text-green-600 hover:bg-green-100 transition-colors"
                        >
                          ✓ Done
                        </button>
                      )}
                    </div>
                  </div>
                ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}