import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Calendar, CheckCircle, ChevronRight, Clock, Loader2, MessageSquare, Shield, ShoppingCart, Star, Tag } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { formatCurrency as libFormatCurrency } from '../lib/currency';
import { requireKycForAction } from '../lib/kycGate';
import { reviewService } from '../lib/reviews';
import { useToast } from '../components/Toast';
import { VerifiedBadge } from '../components/VerifiedBadge';
import { ProBadge } from '../components/ProBadge';
import { razorpayService } from '../lib/razorpay';
import { useAuth } from '../context/AuthContext';
import { isValidUuid } from '../utils/validation';
import { GrowCoinIcon } from '../components/GrowCoinIcon';
import { useGrowCoinBalance } from '../hooks/useGrowCoinBalance';
import { GROW_COIN, formatCoinAmount, previewCoinDiscount } from '../lib/growCoins';

interface ServicePackage {
  tier: 'basic' | 'standard' | 'premium';
  title: string;
  price: number;
  delivery_days: number;
  revisions: number;
  deliverables: string[];
}

interface ServiceAddon {
  id: string;
  title: string;
  price: number;
  type: 'extra_revision' | 'fast_delivery' | 'extra';
}

interface ServiceData {
  id: string;
  freelancer_id: string;
  title: string;
  description: string;
  category: string;
  subcategory: string | null;
  price_type: 'fixed' | 'hourly' | 'package';
  price: number;
  extra_revision_price?: number;
  revisions?: number;
  price_package?: { name: string; price: number; description: string }[];
  packages?: ServicePackage[] | null;
  addons?: ServiceAddon[] | null;
  milestone_mode?: 'single' | 'multi' | null;
  delivery_time: string;
  tags: string[];
  status: string;
  created_at: string;
  updated_at: string;
  image_url?: string | null;
  freelancer?: {
    id: string;
    name: string | null;
    avatar: string | null;
    is_pro?: boolean | null;
    verification_status?: string | null;
    professional?: {
      title: string | null;
      hourly_rate: number | null;
      location: string | null;
      skills: string[];
    } | null;
    average_rating?: number;
    total_reviews?: number;
  };
}

export function ServiceDetailPage() {
  const { serviceId } = useParams<{ serviceId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [service, setService] = useState<ServiceData | null>(null);
  const [loading, setLoading] = useState(true);
  const toast = useToast();
  const [addingToCart, setAddingToCart] = useState(false);
  // 💜 Tip (optional, goes 100% to the freelancer)
  const [tipPercent, setTipPercent] = useState<number | null>(null);
  // ── Package tier + add-ons (FINAL MODEL: 3 tiers, client picks, server prices) ──
  const [selectedTier, setSelectedTier] = useState<ServicePackage['tier'] | null>(null);
  const [selectedAddonIds, setSelectedAddonIds] = useState<string[]>([]);
  // Grow Coins: hook + state must live ABOVE the loading/not-found early
  // returns so hook order never changes between renders.
  const { state: coinState } = useGrowCoinBalance(user?.id);
  const [useCoins, setUseCoins] = useState(false);
  const [coinsRequested, setCoinsRequested] = useState(0);

  useEffect(() => {
    if (!serviceId) return;

    // 🛡️ Reject malformed ids before querying — `services.id` is a uuid column,
    // so a non-UUID id makes Postgres answer HTTP 400 and the browser logs a red
    // "Failed to load resource: 400" for a visit that is really just a 404.
    if (!isValidUuid(serviceId)) {
      setService(null);
      setLoading(false);
      return;
    }

    const fetchService = async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase
          .from('services')
          .select(`
            *,
            freelancer:profiles!services_freelancer_id_fkey(
              id, name, avatar, is_pro
            )
          `)
          .eq('id', serviceId)
          .eq('status', 'active')
          .maybeSingle();

        // Graceful not-found: a missing/inactive/deleted service must show the
        // friendly "Service Not Found" state — never a scary error toast.
        // (.single() used to raise PGRST116 here which surfaced as
        // "Failed to load service." even though nothing was actually broken.)
        if (error) throw error;
        if (!data) {
          setService(null);
          setLoading(false);
          return;
        }

        const svc = data as unknown as ServiceData;

        // Use the public service-owner relation for profile data. Direct
        // anonymous reads from profiles are blocked by RLS in production.
        const { data: professional } = await supabase
          .from('freelancer_profiles')
          .select('title, hourly_rate, location, skills, verification_status')
          .eq('user_id', svc.freelancer_id)
          .maybeSingle();
        const owner = (data as unknown as { freelancer?: ServiceData['freelancer'] | null }).freelancer;
        svc.freelancer = owner
          ? { ...owner, verification_status: professional?.verification_status ?? owner.verification_status, professional }
          : undefined;

        // Fetch freelancer reviews for rating
        if (svc.freelancer) {
          const reviewsResult = await reviewService.getUserReviews(svc.freelancer_id);
          svc.freelancer.average_rating = reviewsResult.average_rating;
          svc.freelancer.total_reviews = reviewsResult.total_reviews;
        }

        setService(svc);
      } catch (err) {
        toast.error('Error', 'Failed to load service.');
      } finally {
        setLoading(false);
      }
    };

    fetchService();
  }, [serviceId, toast]);



  // Record a service view (once per session, never for the owner) so the
  // freelancer's dashboard shows a real-time view count.
  useEffect(() => {
    if (!serviceId || !service) return;
    // Skip counting the owner's own visits
    if (user?.id && service.freelancer_id === user.id) return;

    const sessionKey = `gw_service_view:${serviceId}`;
    if (sessionStorage.getItem(sessionKey)) return;

    const record = async () => {
      try {
        await (supabase.rpc as any)('record_service_view', {
          p_service_id: serviceId,
        });
        sessionStorage.setItem(sessionKey, '1');
      } catch (error) {
        console.error('Error recording service view:', error);
      }
    };
    void record();
  }, [serviceId, service, user?.id]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-cream">
        <Loader2 className="w-8 h-8 animate-spin text-emerald-600" />
      </div>
    );
  }

  if (!service) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-cream">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-slate-900 mb-2">Service Not Found</h2>
          <p className="text-slate-500 mb-3">This service doesn't exist or is no longer available.</p>
          <Link to="/" className="inline-flex items-center min-h-[44px] px-2 text-emerald-600 hover:underline font-medium">Go Home</Link>
        </div>
      </div>
    );
  }

  const formatCurrency = (amount: number) => libFormatCurrency(amount);

  // ── PACKAGE MODEL (FINAL): 3 published tiers; legacy single-price services
  // render as one Basic package so nothing breaks.
  const publishedPackages: ServicePackage[] = Array.isArray(service.packages) && service.packages.length > 0
    ? service.packages
    : [{
        tier: 'basic',
        title: 'Standard',
        price: service.price || 0,
        delivery_days: Number(service.delivery_time) || 7,
        revisions: service.revisions ?? 5,
        deliverables: [],
      }];
  const selectedPackage =
    publishedPackages.find((p) => p.tier === selectedTier) ?? publishedPackages[0] ?? publishedPackages[0];
  const addonsList: ServiceAddon[] = Array.isArray(service.addons) ? service.addons : [];
  const selectedAddons = addonsList.filter((a) => selectedAddonIds.includes(a.id));
  const addonTotal = selectedAddons.reduce((sum, a) => sum + (Number(a.price) || 0), 0);

  // Real checkout — creates a Razorpay service_purchase order (server-side
  // amount recomputed from the services table, never trusts the client) and
  // opens the Razorpay checkout modal. On success the payment is verified
  // via signature and the user is confirmed.
  // The client always pays the LISTED package price (+ add-ons + tip) — no
  // price offers exist anymore.
  const displayPrice = Number(selectedPackage?.price || 0);
  const tipAmount = tipPercent
    ? Math.round((displayPrice * tipPercent) / 100 * 100) / 100
    : 0;
  // Client pays the listed price (+ add-ons + tip) only. The 5% commission is
  // withheld from the freelancer's payout at release, never added at checkout.
  const totalPayable = displayPrice + addonTotal + tipAmount;

  // ── Grow Coins at checkout ──────────────────────────────────────────────
  // The client picks a COIN COUNT only. The edge function recomputes the
  // discount from the authoritative balance and never accepts this number as
  // a discount. The preview below uses the exact same rules as the server.
  const maxCoinsForOrder = Math.max(Math.min(coinState.available, Math.floor(totalPayable) - 1), 0);
  const coinPreview = previewCoinDiscount(
    useCoins ? (coinsRequested || coinState.available) : 0,
    coinState.available,
    totalPayable
  );
  const amountAfterCoins = coinPreview.payableInr;

  const toggleCoins = () => {
    const next = !useCoins;
    setUseCoins(next);
    if (next) {
      // Default to the largest usable amount; the input lets them use fewer.
      setCoinsRequested(maxCoinsForOrder);
    }
  };

  const handleContinueToOrder = async () => {
    if (!user) {
      toast.info('Login required', 'Please log in to place an order.');
      navigate('/login');
      return;
    }
    if (!service) return;

    // 🔒 Critical money action — identity must be verified to place an order.
    const kyc = await requireKycForAction(user);
    if (!kyc.verified) {
      toast.info(
        'Verification required',
        'Please verify your identity to place an order — it takes under a minute and unlocks escrow-protected payments.'
      );
      navigate(`${kyc.kycPath}?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`);
      return;
    }

    setAddingToCart(true);
    try {
      // Client sends ONLY the tier name + addon IDs — the edge function reads
      // prices from the services row (server-side authority, never trusts a
      // client-sent price).
      const { order, razorpay_key_id, amount, currency } = await razorpayService.createOrder({
        order_type: 'service_purchase',
        amount: totalPayable,
        currency: 'INR',
        description: `Service: ${service.title} — ${selectedPackage?.title || 'Package'}${addonTotal > 0 ? ' + add-ons' : ''}${tipAmount > 0 ? ' + tip' : ''}${coinPreview.coinsUsed > 0 ? ` (${coinPreview.coinsUsed} Grow Coins applied)` : ''}`,
        metadata: {
          service_id: service.id,
          service_title: service.title,
          tier: selectedPackage?.tier ?? 'basic',
          addon_ids: selectedAddonIds,
          // Server-side validated: 0 <= tip <= service price
          tip_amount: tipAmount > 0 ? tipAmount : 0,
          // Coin COUNT only — the server derives the ₹ discount itself.
          ...(coinPreview.coinsUsed > 0 ? { coins_to_use: coinPreview.coinsUsed } : {}),
        },
      });

      await razorpayService.openCheckout({
        key: razorpay_key_id,
        amount: Math.round(amount * 100), // paise
        currency,
        name: 'Growlanzo',
        description: `Service: ${service.title}`,
        order_id: order.razorpay_order_id,
        config_id: import.meta.env.VITE_RAZORPAY_CONFIG_ID || undefined,
        prefill: {
          name: user.name || '',
          email: user.email || '',
        },
        theme: { color: '#14861f' },
        method: {
          card: true,
          upi: true,
          netbanking: true,
          wallet: true,
          emi: true,
        },
        handler: async (response) => {
          await razorpayService.verifyPayment(response);
          toast.success(
            'Order Placed!',
            `Payment for "${service.title}" received. The freelancer will start your order.`
          );
          setAddingToCart(false);
        },
        modal: {
          ondismiss: () => setAddingToCart(false),
        },
      });
    } catch (err) {
      console.error('Order failed:', err);
      toast.error('Order Failed', err instanceof Error ? err.message : 'Could not start payment.');
      setAddingToCart(false);
    }
  };

  return (
    <div className="min-h-screen bg-cream">
      {/* Back Navigation */}
      <div className="bg-white border-b border-slate-100">
        <div className="max-w-[100rem] mx-auto px-4 sm:px-6 lg:px-8 2xl:px-12 py-4">
          <Link to="/services" className="inline-flex items-center gap-3 min-h-[44px] text-sm text-slate-500 hover:text-emerald-600 transition-colors">
            <ArrowLeft className="w-4 h-4" />
            Back to Services
          </Link>
        </div>
      </div>

      {/* Cover Image Hero */}
      {service.image_url && (
        <div className="w-full max-h-80 overflow-hidden bg-slate-100">
          <div className="max-w-[100rem] mx-auto px-4 sm:px-6 lg:px-8 2xl:px-12">
            <img
              src={service.image_url}
              alt={service.title}
              className="w-full h-64 sm:h-72 md:h-80 object-contain p-2 bg-slate-50 rounded-b-3xl shadow-md"
            />
          </div>
        </div>
      )}

      <div className="max-w-[100rem] mx-auto px-4 sm:px-6 lg:px-8 2xl:px-12 py-4">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          {/* Main Content */}
          <div className="lg:col-span-2 space-y-4">
            {/* Service Header */}
            <div>
              <div className="flex items-center gap-3 text-sm text-slate-500 mb-3">
                <Link to="/categories" className="hover:text-emerald-600">{service.category}</Link>
                {service.subcategory && (
                  <>
                    <ChevronRight className="w-3.5 h-3.5" />
                    <span>{service.subcategory}</span>
                  </>
                )}
              </div>
              <h1 className="font-display text-3xl font-bold text-slate-900">{service.title}</h1>
              <div className="flex flex-wrap items-center gap-3 mt-3 text-sm text-slate-500">
                <span className="flex items-center gap-1">
                  <Clock className="w-4 h-4" />
                  {service.delivery_time} delivery
                </span>
                <span className="flex items-center gap-1">
                  <Tag className="w-4 h-4" />
                  {publishedPackages.length > 1 ? '3 Package Tiers' : 'Fixed Price'}
                </span>
                <span className="flex items-center gap-1">
                  <Calendar className="w-4 h-4" />
                  Updated {new Date(service.updated_at).toLocaleDateString()}
                </span>
                {typeof service.revisions === 'number' && service.revisions > 0 && (
                  <span className="flex items-center gap-1">
                    <CheckCircle className="w-4 h-4" />
                    {service.revisions} free revisions
                  </span>
                )}
              </div>
            </div>

            {/* Description */}
            <div className="bg-white rounded-xl border border-slate-100 p-3 shadow-sm">
              <h2 className="text-lg font-semibold text-slate-900 mb-3">Description</h2>
              <div className="text-slate-600 whitespace-pre-wrap leading-relaxed">{service.description}</div>
            </div>

            {/* Skills */}
            {Array.isArray((service as any).skills) && (service as any).skills.length > 0 && (
              <div className="bg-white rounded-xl border border-slate-100 p-3 shadow-sm">
                <h2 className="text-lg font-semibold text-slate-900 mb-3">Skills</h2>
                <div className="flex flex-wrap gap-3">
                  {(service as any).skills.map((skill: string) => (
                    <span
                      key={skill}
                      className="px-3 py-1.5 bg-violet-50 text-violet-700 text-sm rounded-lg border border-violet-100"
                    >
                      {skill}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Tags */}
            {service.tags && service.tags.length > 0 && (
              <div className="bg-white rounded-xl border border-slate-100 p-3 shadow-sm">
                <h2 className="text-lg font-semibold text-slate-900 mb-3">Tags</h2>
                <div className="flex flex-wrap gap-3">
                  {service.tags.map((tag) => (
                    <span
                      key={tag}
                      className="px-3 py-1.5 bg-slate-50 text-slate-600 text-sm rounded-lg border border-slate-100"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Revision Policy — transparent to the client */}
            {(typeof service.revisions === 'number' && service.revisions > 0) || Number(service.extra_revision_price) > 0 ? (
              <div className="bg-white rounded-xl border border-slate-100 p-3 shadow-sm">
                <h2 className="text-lg font-semibold text-slate-900 mb-3 flex items-center gap-3">
                  <CheckCircle className="w-5 h-5 text-emerald-600" />
                  Revision Policy
                </h2>
                <div className="space-y-3">
                  <div className="flex items-start gap-3 p-4 bg-emerald-50/50 border border-emerald-100 rounded-xl">
                    <CheckCircle className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-semibold text-emerald-900">
                        {service.revisions || 0} free revisions included
                      </p>
                      <p className="text-xs text-emerald-700 mt-1 leading-relaxed">
                        You can request up to {service.revisions || 0} revision(s) of the delivered work at no extra
                        cost. Revisions cover reasonable fixes to the agreed scope of the service.
                      </p>
                    </div>
                  </div>
                  {Number(service.extra_revision_price) > 0 ? (
                    <div className="flex items-start gap-3 p-4 bg-amber-50/50 border border-amber-100 rounded-xl">
                      <Shield className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="text-sm font-semibold text-amber-900">
                          Extra revisions: {formatCurrency(Number(service.extra_revision_price))} each
                        </p>
                        <p className="text-xs text-amber-700 mt-1 leading-relaxed">
                          Beyond the included free revisions, the freelancer may charge {formatCurrency(Number(service.extra_revision_price))}
                          per revision. The freelancer sets this rate — you can agree on the price before any extra work begins.
                          No charge applies unless you both agree.
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start gap-3 p-4 bg-slate-50 border border-slate-100 rounded-xl">
                      <Shield className="w-5 h-5 text-slate-500 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="text-sm font-semibold text-slate-800">Extra revisions</p>
                        <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                          Beyond the free revisions, any additional revision is subject to a mutually agreed price
                          between you and the freelancer. All payments stay protected by Growlanzo Escrow.
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ) : null}

          </div>

          {/* Sidebar */}
          <div className="space-y-3">
            {/* Package Selector Card — FINAL MODEL: 3 tiers + add-ons */}
            <div className="bg-white rounded-xl border border-slate-100 p-3 shadow-sm">
              <p className="text-sm font-bold text-slate-900 mb-3">Choose a package</p>

              {/* Tier comparison — Fiverr-style cards */}
              <div className="space-y-4.5">
                {publishedPackages.map((pkg) => {
                  const selected = selectedPackage?.tier === pkg.tier;
                  const isStd = pkg.tier === 'standard';
                  return (
                    <button
                      key={pkg.tier}
                      type="button"
                      onClick={() => {
                        setSelectedTier(pkg.tier);
                        setSelectedAddonIds([]);
                      }}
                      className={`w-full text-left rounded-xl border-2 p-4 transition-all ${
                        selected
                          ? 'border-emerald-500 bg-emerald-50/50 shadow-sm'
                          : 'border-slate-200 bg-white hover:border-emerald-300'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <p className="font-bold text-slate-900">
                          {pkg.title || pkg.tier}
                          {isStd && (
                            <span className="ml-1.5 align-middle text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700">POPULAR</span>
                          )}
                        </p>
                        <p className="text-lg font-bold text-emerald-600">{formatCurrency(Number(pkg.price) || 0)}</p>
                      </div>
                      <p className="text-xs text-slate-500 mt-1">
                        {pkg.delivery_days ? `${pkg.delivery_days} day delivery` : 'Delivery in days'} · {pkg.revisions ?? 0} revisions
                      </p>
                      {(pkg.deliverables || []).length > 0 && (
                        <ul className="mt-2 space-y-1">
                          {pkg.deliverables.slice(0, 4).map((d, i) => (
                            <li key={i} className="flex items-start gap-1.5 text-xs text-slate-600">
                              <CheckCircle className="w-4 h-4 text-emerald-500 mt-0.5 flex-shrink-0" />
                              {d}
                            </li>
                          ))}
                        </ul>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Add-ons */}
              {addonsList.length > 0 && (
                <div className="mt-4 pt-4 border-t border-slate-100">
                  <p className="text-xs font-bold text-slate-700 mb-2">Add-ons (optional)</p>
                  <div className="space-y-4">
                    {addonsList.map((addon) => {
                      const checked = selectedAddonIds.includes(addon.id);
                      return (
                        <label
                          key={addon.id}
                          className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2 cursor-pointer transition-all ${
                            checked ? 'border-violet-300 bg-violet-50/50' : 'border-slate-200 bg-white hover:border-violet-200'
                          }`}
                        >
                          <span className="flex items-center gap-3 text-sm text-slate-700">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) =>
                                setSelectedAddonIds((prev) =>
                                  e.target.checked ? [...prev, addon.id] : prev.filter((id) => id !== addon.id)
                                )
                              }
                              className="rounded border-slate-300 text-violet-600 focus:ring-violet-500"
                            />
                            {addon.title}
                          </span>
                          <span className="text-sm font-semibold text-slate-800">+{formatCurrency(Number(addon.price) || 0)}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Price breakdown — transparent, informational (server re-verifies) */}
              <div className="mt-4 pt-4 border-t border-slate-100 space-y-1.5 text-sm">
                <div className="flex justify-between text-slate-600">
                  <span>{selectedPackage?.title || 'Package'}</span>
                  <span className="font-medium">{formatCurrency(displayPrice)}</span>
                </div>
                {addonTotal > 0 && (
                  <div className="flex justify-between text-slate-600">
                    <span>Add-ons</span>
                    <span className="font-medium">{formatCurrency(addonTotal)}</span>
                  </div>
                )}
                {tipAmount > 0 && (
                  <div className="flex justify-between text-slate-600">
                    <span>Tip</span>
                    <span className="font-medium">{formatCurrency(tipAmount)}</span>
                  </div>
                )}
                {coinPreview.discountInr > 0 && (
                  <div className="flex justify-between text-amber-700">
                    <span className="inline-flex items-center gap-1.5">
                      <GrowCoinIcon size={16} /> Grow Coins ({coinPreview.coinsUsed})
                    </span>
                    <span className="font-semibold">−{formatCurrency(coinPreview.discountInr)}</span>
                  </div>
                )}
                <div className="flex justify-between font-bold text-slate-900 pt-1.5 border-t border-slate-100">
                  <span>Total</span>
                  <span>{formatCurrency(amountAfterCoins)}</span>
                </div>
              </div>

              {/* Optional Grow Coin discount — client sends a coin count only */}
              {coinState.available >= GROW_COIN.minRedemption && maxCoinsForOrder >= GROW_COIN.minRedemption && (
                <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50/60 p-3">
                  <label className="flex cursor-pointer items-center justify-between gap-3">
                    <span className="flex items-center gap-2 text-sm font-semibold text-amber-950">
                      <GrowCoinIcon size={20} /> Use Grow Coins
                    </span>
                    <input
                      type="checkbox"
                      checked={useCoins}
                      onChange={toggleCoins}
                      className="h-4 w-4 rounded border-amber-400 text-amber-600 focus:ring-amber-500"
                    />
                  </label>
                  {useCoins && (
                    <div className="mt-2.5 space-y-1.5">
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          min={GROW_COIN.minRedemption}
                          max={maxCoinsForOrder}
                          step={10}
                          value={coinsRequested}
                          onChange={(e) => setCoinsRequested(Number(e.target.value) || 0)}
                          aria-label="Grow Coins to use on this order"
                          className="w-28 rounded-lg border border-amber-300 bg-white px-2 py-1.5 text-sm font-semibold tabular-nums text-amber-950 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/20"
                        />
                        <span className="text-xs text-amber-900/70">
                          of {formatCoinAmount(coinState.available)} available
                        </span>
                      </div>
                      <p className="text-[11px] leading-relaxed text-amber-900/70">
                        {coinPreview.reason
                          ? coinPreview.reason
                          : `You pay ₹${coinPreview.payableInr.toLocaleString('en-IN')} after the discount. Coins are deducted only when the payment succeeds.`}
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* 💜 Tip selector — only when the freelancer enables tips */}
              {(service as any).accepts_tips && (
                <div className="mt-4">
                  <p className="text-xs font-semibold text-slate-600 mb-2">Add a tip (goes 100% to the freelancer):</p>
                  <div className="flex flex-wrap gap-1.5">
                    {[0, 5, 10, 15].map(pct => (
                      <button
                        key={pct}
                        type="button"
                        onClick={() => setTipPercent(tipPercent === pct ? null : (pct || null))}
                        className={`px-3 py-1.5 text-xs font-bold rounded-lg border transition-all ${
                          tipPercent === pct
                            ? 'bg-fuchsia-600 border-fuchsia-600 text-white'
                            : 'bg-white border-slate-200 text-slate-600 hover:border-fuchsia-300'
                        }`}
                      >
                        {pct === 0 ? 'No tip' : `${pct}%`}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <button
                onClick={handleContinueToOrder}
                disabled={addingToCart}
                className="w-full mt-5 flex items-center justify-center gap-3 px-5 py-3 bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed transition-all font-semibold shadow-lg shadow-emerald-600/25"
              >
                {addingToCart ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <ShoppingCart className="w-4 h-4" />
                )}
                {addingToCart ? 'Processing...' : 'Continue to Order'}
              </button>

              <div className="mt-4 space-y-4 text-sm text-slate-500">
                <div className="flex items-center gap-3">
                  <Shield className="w-4 h-4 text-emerald-500" />
                  Payment protected by escrow
                </div>
                <div className="flex items-center gap-3">
                  <CheckCircle className="w-4 h-4 text-emerald-500" />
                  You approve the work before funds release
                </div>
              </div>
            </div>

            {/* Freelancer Card */}
            {service.freelancer && (
              <Link
                to={`/freelancer/${service.freelancer_id}`}
                className="block bg-white rounded-xl border border-slate-100 p-3 shadow-sm hover:shadow-md transition-all"
              >
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center text-lg font-medium text-slate-600 flex-shrink-0">
                    {service.freelancer.avatar ? (
                      <img src={service.freelancer.avatar} alt="" className="w-full h-full rounded-full object-cover" />
                    ) : (
                      (service.freelancer.name || 'U')[0]
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-900 flex items-center gap-1.5 flex-wrap">
                      {service.freelancer.name || 'Freelancer'}
                      {service.freelancer.verification_status === 'verified' && <VerifiedBadge size="xs" />}
                      {service.freelancer.is_pro && <ProBadge size="xs" />}
                    </p>
                    {service.freelancer.professional?.title && (
                      <p className="text-xs text-slate-500">{service.freelancer.professional.title}</p>
                    )}
                  </div>
                </div>

                {service.freelancer.average_rating && service.freelancer.average_rating > 0 && (
                  <div className="flex items-center gap-1 text-sm">
                    <Star className="w-4 h-4 text-amber-400 fill-amber-400" />
                    <span className="font-medium text-slate-900">{service.freelancer.average_rating.toFixed(1)}</span>
                    <span className="text-slate-400">({service.freelancer.total_reviews})</span>
                  </div>
                )}

                <div className="mt-3 flex flex-wrap gap-1.5">
                  {(service.freelancer.professional?.skills || []).slice(0, 4).map((skill) => (
                    <span key={skill} className="px-2 py-0.5 bg-slate-50 text-slate-600 text-xs rounded-md">
                      {skill}
                    </span>
                  ))}
                </div>

                <div className="mt-4 flex items-center justify-center gap-3 px-4 py-2.5 bg-emerald-600 text-white text-sm font-semibold rounded-xl hover:bg-emerald-700 active:scale-[0.98] transition-all shadow-md shadow-emerald-600/20">
                  <MessageSquare className="w-4 h-4" />
                  Contact Me
                  <ChevronRight className="w-4 h-4" />
                </div>
              </Link>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}