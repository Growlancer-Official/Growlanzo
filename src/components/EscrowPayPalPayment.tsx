// Escrow Payment with PayPal Integration
// This component allows clients to fund escrow using PayPal
// Supports both full-amount funding and milestone-based partial releases

import { useState, useEffect } from 'react';
import { AlertCircle,
  Banknote,
  CheckCircle,
  ChevronRight,
  IndianRupee,
  ListChecks,
  Loader2,
  Shield } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { PayPalCheckout } from './PayPalCheckout';
import { RazorpayCheckout } from './RazorpayCheckout';
import { PAYMENTS_CONFIG } from '../lib/payments';
import { formatCurrency } from '../lib/currency';
import { supabase } from '../lib/supabase';
import { withdrawalService } from '../lib/withdrawal';
import { calculateFreelancerAmount, calculateTotalWithFee } from '../lib/config';
import { milestoneService, getMilestoneProgress } from '../lib/contractMilestones';
import type { MilestoneItem } from '../lib/contractMilestones';

interface EscrowPayPalPaymentProps {
  contractId: string;
  amount: number;
  freelancerName: string;
  projectTitle: string;
  /** Optional milestones array for milestone-based partial funding */
  milestones?: MilestoneItem[];
  onSuccess?: () => void;
  onCancel?: () => void;
}

type PaymentStep = 'select_milestones' | 'review' | 'payment' | 'processing' | 'success' | 'error';

/**
 * Milestone step indicator showing progress across the milestone payment flow.
 */
function MilestoneStepIndicator({
  milestones,
  selectedIndices,
  onToggle,
}: {
  milestones: MilestoneItem[];
  selectedIndices: Set<number>;
  onToggle: (index: number) => void;
}) {
  const progress = getMilestoneProgress(milestones);

  return (
    <div className="mb-3">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-slate-900">Select Milestones to Fund</h3>
        <span className="text-sm text-slate-500">
          {progress.completed} of {progress.total} completed
        </span>
      </div>

      {/* Overall Progress Bar */}
      {progress.total > 0 && (
        <div className="w-full bg-slate-100 rounded-full h-2 mb-2">
          <div
            className="bg-emerald-500 h-2 rounded-full transition-all duration-500"
            style={{ width: `${progress.percent}%` }}
          />
        </div>
      )}

      <div className="space-y-4">
        {milestones.map((milestone, idx) => {
          const status = String(milestone.status || 'pending').toLowerCase();
          const isCompleted = ['completed', 'approved', 'released', 'paid'].includes(status);
          const isDisputed = status === 'disputed';
          const isSelected = selectedIndices.has(idx);

          return (
            <div
              key={idx}
              className={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${
                isCompleted
                  ? 'bg-emerald-50 border-emerald-200'
                  : isDisputed
                  ? 'bg-red-50 border-red-200'
                  : isSelected
                  ? 'bg-blue-50 border-blue-300 ring-2 ring-blue-200'
                  : 'bg-slate-50 border-slate-200 hover:border-slate-300'
              }`}
            >
              {/* Checkbox for selection */}
              {!isCompleted && !isDisputed ? (
                <button
                  onClick={() => onToggle(idx)}
                  className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                    isSelected
                      ? 'bg-blue-600 border-blue-600 text-white'
                      : 'border-slate-300 hover:border-blue-400'
                  }`}
                >
                  {isSelected && <CheckCircle className="w-4 h-4" />}
                </button>
              ) : (
                <div className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 ${
                  isCompleted ? 'bg-emerald-500' : 'bg-red-500'
                }`}>
                  {isCompleted ? (
                    <CheckCircle className="w-4 h-4 text-white" />
                  ) : (
                    <AlertCircle className="w-4 h-4 text-white" />
                  )}
                </div>
              )}

              {/* Milestone info */}
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-medium ${isCompleted ? 'text-emerald-800' : isDisputed ? 'text-red-800' : 'text-slate-800'}`}>
                  {milestone.title || `Milestone ${idx + 1}`}
                </p>
                {milestone.description && (
                  <p className="text-xs text-slate-500 truncate">{milestone.description}</p>
                )}
              </div>

              {/* Amount and status */}
              <div className="text-right flex-shrink-0">
                <p className="text-sm font-semibold text-slate-900">
                  {formatCurrency(Number(milestone.amount || 0))}
                </p>
                <span className={`text-xs font-medium capitalize ${
                  isCompleted ? 'text-emerald-600' : isDisputed ? 'text-red-600' : 'text-slate-400'
                }`}>
                  {isCompleted ? 'Funded' : isDisputed ? 'Disputed' : isSelected ? 'Selected' : status.replace('_', ' ')}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Escrow progress bar showing funded vs total amounts.
 */
function EscrowProgressBar({ funded, total }: { funded: number; total: number }) {
  const safeTotal = Number.isFinite(Number(total)) ? Number(total) : 0;
  const safeFunded = Number.isFinite(Number(funded)) ? Number(funded) : 0;
  const percent = safeTotal > 0 ? Math.min(100, Math.round((safeFunded / safeTotal) * 100)) : 0;
  const remaining = Math.max(0, safeTotal - safeFunded);

  return (
    <div className="p-4 bg-slate-50 rounded-lg">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-slate-700">Escrow Funding Progress</span>
        <span className="text-sm font-bold text-slate-900">{formatCurrency(safeFunded)} / {formatCurrency(safeTotal)}</span>
      </div>
      <div className="w-full bg-slate-200 rounded-full h-3 mb-2">
        <div
          className={`h-3 rounded-full transition-all duration-500 ${
            percent >= 100 ? 'bg-emerald-500' : percent >= 50 ? 'bg-teal-500' : 'bg-amber-500'
          }`}
          style={{ width: `${percent}%` }}
        />
      </div>
      <div className="flex justify-between text-xs text-slate-500">
        <span>{percent}% funded</span>
        {remaining > 0 && <span>{formatCurrency(remaining)} remaining</span>}
      </div>
    </div>
  );
}

export function EscrowPayPalPayment({
  contractId,
  amount,
  freelancerName,
  projectTitle,
  milestones: propMilestones,
  onSuccess,
  onCancel,
}: EscrowPayPalPaymentProps) {
  const { user } = useAuth();
  // NaN-safe amount — contracts can have null/undefined amounts; never crash the payment UI.
  const safeAmount = Number.isFinite(Number(amount)) ? Number(amount) : 0;
  const [step, setStep] = useState<PaymentStep>(propMilestones && propMilestones.length > 0 ? 'select_milestones' : 'review');
  const [error, setError] = useState<string | null>(null);
  const [isCreatingContract, setIsCreatingContract] = useState(false);
  const [selectedMilestones, setSelectedMilestones] = useState<Set<number>>(new Set());
  const [milestones, setMilestones] = useState<MilestoneItem[]>(propMilestones || []);

  // Wallet funding — pay escrow from the client's wallet balance
  const [walletBalance, setWalletBalance] = useState<number | null>(null);
  const [walletLoading, setWalletLoading] = useState(false);
  const [payingFromWallet, setPayingFromWallet] = useState(false);

  // Load milestones from contract if not provided via props
  useEffect(() => {
    if (!propMilestones || propMilestones.length === 0) {
      milestoneService.getMilestones(contractId).then((result) => {
        if (result.success && result.milestones.length > 0) {
          setMilestones(result.milestones);
          setStep('select_milestones');
        }
      });
    }
  }, [contractId, propMilestones]);

  // Load the client's wallet balance (to offer Pay-from-Wallet)
  const loadWalletBalance = () => {
    setWalletLoading(true);
    withdrawalService.getWalletBalance().then((result) => {
      if (result.success && result.balance) {
        setWalletBalance(Number(result.balance.balance) || 0);
      } else {
        setWalletBalance(0);
      }
    }).catch(() => setWalletBalance(0)).finally(() => setWalletLoading(false));
  };

  useEffect(() => { loadWalletBalance(); }, []);

  /** Fund the escrow directly from the client's wallet (atomic server RPC). */
  const handlePayFromWallet = async () => {
    setPayingFromWallet(true);
    setError(null);
    try {
      const { data, error: rpcError } = await (supabase.rpc as any)('fund_escrow_from_wallet', {
        p_contract_id: contractId,
        p_milestone_indices: selectedMilestones.size > 0 ? Array.from(selectedMilestones) : null,
      });
      if (rpcError) throw new Error(rpcError.message);
      if (data && data.success === false) throw new Error(data.error || 'Wallet payment failed');

      setWalletBalance(Number(data?.balance) || 0);
      setStep('success');
      onSuccess?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Wallet payment failed');
      setStep('error');
    } finally {
      setPayingFromWallet(false);
    }
  };

  // Calculate the total amount to fund based on selected milestones
  const calculateFundingAmount = (): number => {
    if (milestones.length === 0 || selectedMilestones.size === 0) {
      return safeAmount;
    }
    let total = 0;
    selectedMilestones.forEach((idx) => {
      total += Number(milestones[idx]?.amount || 0);
    });
    return total > 0 ? total : amount;
  };

  const fundingAmount = calculateFundingAmount();
  // The client pays the agreed amount only — the 5% commission is withheld
  // from the freelancer when the earnings are released.
  const platformFee = 0;
  const freelancerReceives = calculateFreelancerAmount(fundingAmount);
  const totalAmount = calculateTotalWithFee(fundingAmount);

  // Calculate already funded amount
  const fundedAmount = milestones
    .filter((m) => ['completed', 'approved', 'released', 'paid'].includes(String(m.status || '').toLowerCase()))
    .reduce((sum, m) => sum + (Number(m.amount) || 0), 0);

  const toggleMilestoneSelection = (index: number) => {
    setSelectedMilestones((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  const handleProceedToReview = () => {
    if (milestones.length > 0 && selectedMilestones.size === 0) {
      // If no milestones selected, fund the full contract amount
      setStep('review');
    } else {
      setStep('review');
    }
  };

  const handleProceedToPayment = async () => {
    setIsCreatingContract(true);

    try {
      // Check if contract exists
      const { data: contract, error: contractError } = await supabase
        .from('contracts')
        .select('*')
        .eq('id', contractId)
        .single();

      if (contractError || !contract) {
        throw new Error('Contract not found');
      }

      setIsCreatingContract(false);
      setStep('payment');
    } catch (err) {
      setIsCreatingContract(false);
      setError(err instanceof Error ? err.message : 'Failed to load contract');
      setStep('error');
    }
  };

  const handlePayPalSuccess = async (_orderId: string, _details: unknown) => {
    setStep('processing');
    loadWalletBalance(); // keep the Pay-from-Wallet balance fresh after a card payment

    try {
      // Verify payment with backend - check escrow was created
      const { data: escrow, error: escrowError } = await supabase
        .from('escrow')
        .select('*')
        .eq('contract_id', contractId)
        .single();

      if (escrowError || !escrow) {
        console.error('Payment completed but escrow not found. Order ID:', _orderId);
      }

      // Verify contract status was updated
      const { data: contract } = await (supabase
        .from('contracts') as any)
        .select('id, status, escrow_funded')
        .eq('id', contractId)
        .single();

      if ((contract as any)?.escrow_funded) {
        setStep('success');
        onSuccess?.();
      } else {
        console.warn('Payment captured but contract not fully updated');
        setStep('success');
        onSuccess?.();
      }
    } catch (err) {
      console.error('Payment verification error:', err);
      setStep('success');
      onSuccess?.();
    }
  };

  const handlePayPalError = (error: Error) => {
    setError(error.message);
    setStep('error');
  };

  const handlePayPalCancel = () => {
    setStep(milestones.length > 0 ? 'select_milestones' : 'review');
    onCancel?.();
  };

  // ──── SUCCESS STEP ────────────────────────────────────────────────────────
  if (step === 'success') {
    const releasedMilestones = milestones.filter((m) =>
      ['completed', 'approved', 'released', 'paid'].includes(String(m.status || '').toLowerCase())
    );
    const newFundedCount = selectedMilestones.size;
    const totalFundedCount = releasedMilestones.length + newFundedCount;

  return (
    <div className="p-3 sm:p-3 text-center">
        <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-2">
          <CheckCircle className="w-8 h-8 text-emerald-600" />
        </div>
        <h2 className="text-lg font-bold text-slate-900 mb-2">Payment Successful!</h2>
        <p className="text-slate-600 mb-2">
          Your escrow payment of <span className="font-semibold">{formatCurrency(totalAmount)}</span> has been received.
        </p>
        {milestones.length > 0 && (
          <p className="text-sm text-slate-500 mb-3">
            {newFundedCount > 0
              ? `${newFundedCount} milestone${newFundedCount > 1 ? 's' : ''} funded. ${totalFundedCount} of ${milestones.length} total.`
              : `${totalFundedCount} of ${milestones.length} milestones are now funded.`}
          </p>
        )}
        <p className="text-sm text-slate-500">
          The funds are now held securely in escrow. They will be released to {freelancerName} upon milestone completion and approval.
        </p>

        {milestones.length > 0 && totalFundedCount < milestones.length && (
          <button
            onClick={() => { setStep('select_milestones'); setSelectedMilestones(new Set()); }}
            className="mt-6 px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-medium rounded-lg transition-colors inline-flex items-center gap-3"
          >
            <Banknote className="w-4 h-4" />
            Fund Remaining Milestones
          </button>
        )}
      </div>
    );
  }

  // ──── ERROR STEP ──────────────────────────────────────────────────────────
  if (step === 'error') {
    return (
      <div className="p-3 sm:p-3">
        <div className="flex items-center gap-3 text-red-600 mb-2">
          <AlertCircle className="w-6 h-6" />
          <h2 className="text-xl font-bold">Payment Failed</h2>
        </div>
        <p className="text-slate-600 mb-3">{error || 'Something went wrong with the payment.'}</p>
        <button
          onClick={() => setStep(milestones.length > 0 ? 'select_milestones' : 'review')}
          className="w-full py-3 px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium rounded-lg transition-colors"
        >
          Try Again
        </button>
      </div>
    );
  }

  // ──── PAYMENT STEP ────────────────────────────────────────────────────────
  if (step === 'payment') {
    const milestoneDescription = selectedMilestones.size > 0
      ? `Funding ${selectedMilestones.size} milestone${selectedMilestones.size > 1 ? 's' : ''} for: ${projectTitle}`
      : `Escrow payment for: ${projectTitle}`;

    return (
      <div className="p-3 sm:p-3">
        <div className="flex items-center gap-3.5 mb-2">
          <Shield className="w-5 h-5 text-emerald-600" />
          <h2 className="text-lg font-bold text-slate-900">Secure Payment</h2>
        </div>

        {/* Milestone indicator in payment step */}
        {selectedMilestones.size > 0 && (
          <div className="mb-2 p-3 bg-blue-50 rounded-lg border border-blue-100">
            <p className="text-sm text-blue-800 font-medium">
              Funding {selectedMilestones.size} milestone{selectedMilestones.size > 1 ? 's' : ''}
            </p>
            <p className="text-xs text-blue-600 mt-1">
              {Array.from(selectedMilestones).map((idx) => milestones[idx]?.title || `Milestone ${idx + 1}`).join(', ')}
            </p>
          </div>
        )}

        {/* Wallet — pay escrow directly from the client's wallet balance */}
        <div className={`mb-2 p-4 rounded-xl border transition-colors ${
          walletBalance !== null && walletBalance >= totalAmount
            ? 'border-emerald-300 bg-emerald-50'
            : 'border-slate-200 bg-slate-50'
        }`}>
          <div className="flex items-center justify-between gap-3 mb-2">
            <div className="flex items-center gap-3">
              <Banknote className={`w-5 h-5 ${walletBalance !== null && walletBalance >= totalAmount ? 'text-emerald-600' : 'text-slate-400'}`} />
              <span className="font-semibold text-slate-800">Pay from Wallet</span>
            </div>
            <span className="text-sm font-medium text-slate-600">
              Balance:{' '}
              <span className={walletBalance !== null && walletBalance >= totalAmount ? 'text-emerald-700 font-bold' : 'text-slate-500'}>
                {walletLoading ? '…' : formatCurrency(walletBalance ?? 0)}
              </span>
            </span>
          </div>
          <p className="text-xs text-slate-500 mb-3">
            {walletBalance !== null && walletBalance >= totalAmount
              ? 'You have enough balance to fund this escrow instantly — no card needed.'
              : walletBalance !== null && walletBalance > 0
              ? `Add ${formatCurrency(totalAmount - walletBalance)} more to fund from wallet, or pay with a card below.`
              : 'Add funds to your wallet, or pay securely with a card below.'}
          </p>
          <button
            onClick={handlePayFromWallet}
            disabled={payingFromWallet || walletBalance === null || walletBalance < totalAmount}
            className="w-full py-3 px-4 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-3"
          >
            {payingFromWallet ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Processing wallet payment...
              </>
            ) : walletBalance !== null && walletBalance < totalAmount ? (
              <>
                <Banknote className="w-4 h-4" />
                Insufficient Balance
              </>
            ) : (
              <>
                <Banknote className="w-4 h-4" />
                Fund Escrow with Wallet — {formatCurrency(totalAmount)}
              </>
            )}
          </button>
        </div>

        <div className="flex items-center gap-3 mb-2">
          <div className="flex-1 h-px bg-slate-200" />
          <span className="text-xs text-slate-400 uppercase tracking-wider">or pay with card</span>
          <div className="flex-1 h-px bg-slate-200" />
        </div>

        {/* Primary: Razorpay — server recomputes the amount + platform fee */}
        <RazorpayCheckout
          orderData={{
            order_type: 'contract_escrow',
            amount: totalAmount,
            currency: 'INR',
            description: milestoneDescription,
            contract_id: contractId,
            metadata: {
              project_title: projectTitle,
              freelancer_name: freelancerName,
              escrow_amount: fundingAmount,
              platform_fee: platformFee,
              client_id: user?.id,
              milestone_indices: Array.from(selectedMilestones),
              milestone_count: selectedMilestones.size,
            },
          }}
          onSuccess={handlePayPalSuccess}
          onError={handlePayPalError}
          onCancel={handlePayPalCancel}
          buttonText={`Pay ${formatCurrency(totalAmount)} with Razorpay`}
          userInfo={{
            name: (user as any)?.user_metadata?.name,
            email: user?.email,
          }}
        />

        {/* Secondary: PayPal — feature-flagged, Coming Soon until live credentials */}
        {PAYMENTS_CONFIG.paypalEnabled ? (
          <>
            <div className="flex items-center gap-3">
              <div className="flex-1 h-px bg-slate-200" />
              <span className="text-xs text-slate-400 uppercase tracking-wider">or pay with</span>
              <div className="flex-1 h-px bg-slate-200" />
            </div>
            <PayPalCheckout
              orderData={{
                order_type: 'contract_escrow',
                amount: totalAmount,
                currency: 'INR',
                description: milestoneDescription,
                contract_id: contractId,
                metadata: {
                  project_title: projectTitle,
                  freelancer_name: freelancerName,
                  escrow_amount: fundingAmount,
                  platform_fee: platformFee,
                  client_id: user?.id,
                  milestone_indices: Array.from(selectedMilestones),
                  milestone_count: selectedMilestones.size,
                },
              }}
              onSuccess={handlePayPalSuccess}
              onError={handlePayPalError}
              onCancel={handlePayPalCancel}
              buttonText={`Pay ${formatCurrency(totalAmount)} with PayPal`}
            />
          </>
        ) : (
          <div className="flex items-center justify-between gap-3 p-4 bg-slate-50 border border-dashed border-slate-300 rounded-lg">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 bg-slate-200 rounded-lg flex items-center justify-center">
                <IndianRupee className="w-5 h-5 text-slate-500" />
              </div>
              <div>
                <p className="text-sm font-medium text-slate-600">PayPal</p>
                <p className="text-xs text-slate-400">Available soon — Razorpay is the current payment method</p>
              </div>
            </div>
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 bg-slate-200 px-2.5 py-1 rounded-full">
              Coming Soon
            </span>
          </div>
        )}

        <div className="mt-6 p-4 bg-slate-50 rounded-lg">
          <h3 className="font-semibold text-slate-900 mb-2">Payment Breakdown</h3>
          <div className="space-y-4 text-sm">
            {selectedMilestones.size > 0 ? (
              // Per-milestone breakdown
              Array.from(selectedMilestones).map((idx) => {
                const ms = milestones[idx];
                const msAmount = Number(ms?.amount || 0);
                return (
                  <div key={idx} className="flex justify-between text-slate-600">
                    <span>{ms?.title || `Milestone ${idx + 1}`}</span>
                    <span>{formatCurrency(msAmount)}</span>
                  </div>
                );
              })
            ) : (
              <div className="flex justify-between text-slate-600">
                <span>Project Amount</span>
                <span>{formatCurrency(fundingAmount)}</span>
              </div>
            )}
            <div className="flex justify-between text-slate-600">
              <span>Freelancer receives (after 5% commission)</span>
              <span>{formatCurrency(freelancerReceives)}</span>
            </div>
            <div className="flex justify-between font-semibold text-slate-900 pt-2 border-t border-slate-200">
              <span>Total</span>
              <span>{formatCurrency(totalAmount)}</span>
            </div>
          </div>
        </div>

        {/* Escrow Progress — shows the AFTER-payment projection: currently held
            + what this payment will add once completed. Never reads as
            "already funded" before the payment goes through. */}
        <div>
          <div className="text-xs text-slate-500 mb-1 px-1">After this payment (projected)</div>
          <EscrowProgressBar funded={fundedAmount + fundingAmount} total={safeAmount} />
        </div>
      </div>
    );
  }

  // ──── SELECT MILESTONES STEP ──────────────────────────────────────────────
  if (step === 'select_milestones' && milestones.length > 0) {
    return (
      <div className="p-3 sm:p-3">
        <div className="flex items-center gap-3 mb-3">
          <ListChecks className="w-6 h-6 text-emerald-600" />
          <h2 className="text-xl font-bold text-slate-900">Select Milestones to Fund</h2>
        </div>

        <div className="p-4 bg-emerald-50 rounded-lg border border-emerald-100 mb-3">
          <h3 className="font-semibold text-emerald-900 mb-1">Secure Escrow Protection</h3>
          <p className="text-sm text-emerald-700">
            Choose which milestones to fund. Payments are held securely in escrow and released to {freelancerName} upon your approval.
          </p>
        </div>

        <MilestoneStepIndicator
          milestones={milestones}
          selectedIndices={selectedMilestones}
          onToggle={toggleMilestoneSelection}
        />

        {/* Escrow progress */}
        <EscrowProgressBar funded={fundedAmount} total={safeAmount} />

        {/* Selected amount summary */}
        <div className="mt-6 p-4 bg-slate-50 rounded-lg">
          <div className="space-y-4 text-sm">
            <div className="flex justify-between text-slate-600">
              <span>Milestones Selected</span>
              <span className="font-medium">{selectedMilestones.size} of {milestones.length}</span>
            </div>
            <div className="flex justify-between text-slate-600">
              <span>Funding Amount</span>
              <span className="font-semibold text-slate-900">{formatCurrency(fundingAmount)}</span>
            </div>
            <div className="flex justify-between text-slate-600">
              <span>Freelancer receives (after 5% commission)</span>
              <span>{formatCurrency(freelancerReceives)}</span>
            </div>
            <div className="flex justify-between font-semibold text-slate-900 pt-2 border-t border-slate-200">
              <span>Total to Pay</span>
              <span>{formatCurrency(totalAmount)}</span>
            </div>
          </div>
          <p className="text-xs text-emerald-700 mt-2 leading-relaxed bg-emerald-50 border border-emerald-100 rounded-lg p-2.5">
            Growlanzo's 5% commission is deducted from the freelancer's payout — you pay only the project amount.
          </p>
        </div>

        <div className="flex gap-3 mt-6">
          <button
            onClick={onCancel}
            className="flex-1 py-3 px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleProceedToReview}
            className="flex-1 py-3 px-4 bg-emerald-600 hover:bg-emerald-700 text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-3"
          >
            Continue to Payment
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    );
  }

  // ──── REVIEW STEP (default) ──────────────────────────────────────────────
  return (
    <div className="p-3 sm:p-3">
      <div className="flex items-center gap-3 mb-3">
        <Shield className="w-6 h-6 text-emerald-600" />
        <h2 className="text-xl font-bold text-slate-900">
          {milestones.length > 0 ? 'Escrow Payment Summary' : 'Escrow Payment'}
        </h2>
      </div>

      <div className="space-y-4 mb-3">
        <div className="p-4 bg-emerald-50 rounded-lg border border-emerald-100">
          <h3 className="font-semibold text-emerald-900 mb-1">Secure Escrow Protection</h3>
          <p className="text-sm text-emerald-700">
            Your payment is held securely in escrow and will only be released to {freelancerName} when you approve the completed work.
          </p>
        </div>

        {/* Escrow progress bar on review step */}
        {milestones.length > 0 && (
          <EscrowProgressBar funded={fundedAmount} total={safeAmount} />
        )}

        <div className="space-y-3">
          <div className="flex justify-between text-slate-600">
            <span>Project</span>
            <span className="font-medium text-slate-900">{projectTitle}</span>
          </div>
          <div className="flex justify-between text-slate-600">
            <span>Freelancer</span>
            <span className="font-medium text-slate-900">{freelancerName}</span>
          </div>
          <div className="flex justify-between text-slate-600">
            <span>Project Amount</span>
            <span className="font-medium text-slate-900">{formatCurrency(safeAmount)}</span>
          </div>
          {selectedMilestones.size > 0 && (
            <div className="flex justify-between text-slate-600">
              <span>Funding Amount (Selected Milestones)</span>
              <span className="font-medium text-slate-900">{formatCurrency(fundingAmount)}</span>
            </div>
          )}
          <div className="flex justify-between text-slate-600">
            <span>Freelancer receives (after 5% commission)</span>
            <span className="font-medium text-slate-900">{formatCurrency(freelancerReceives)}</span>
          </div>
          <div className="flex justify-between font-semibold text-slate-900 pt-3 border-t border-slate-200 text-lg">
            <span>Total to Pay</span>
            <span>{formatCurrency(totalAmount)}</span>
          </div>
          <p className="text-xs text-emerald-700 leading-relaxed bg-emerald-50 border border-emerald-100 rounded-lg p-2.5 mt-3">
            Growlanzo's 5% commission is deducted from the freelancer's payout — you pay only the project amount.
          </p>
        </div>
      </div>

      <div className="flex gap-3">
        <button
          onClick={onCancel}
          className="flex-1 py-3 px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium rounded-lg transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={handleProceedToPayment}
          disabled={isCreatingContract}
          className="flex-1 py-3 px-4 bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-300 text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-3"
        >
          {isCreatingContract ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              Processing...
            </>
          ) : (
            <>
              <IndianRupee className="w-5 h-5" />
              Proceed to Payment
            </>
          )}
        </button>
      </div>
    </div>
  );
}