import { Suspense, lazy, useEffect } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { buildSignupRedirectTarget } from '../lib/referralCode';
import { AuthProvider } from '../context/AuthContext';
import { CurrencyProvider } from '../context/CurrencyContext';
import { ThemeProvider } from '../context/ThemeContext';
import { ScrollToTop } from '../components/ScrollToTop';
import { RouteHead } from '../components/RouteHead';
import { ProtectedRoute } from '../components/ProtectedRoute';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { I18nProvider } from '../lib/i18n';
import { ToastProvider } from '../components/Toast';
import { RouteFallback } from '../components/LoadingSkeleton';
import { CookieConsent } from '../components/CookieConsent';
import { OAuthReturnNotice } from '../components/OAuthReturnNotice';
import { FeatureUnavailablePage } from '../components/FeatureUnavailablePage';
import { isFeatureEnabled } from '../lib/featureFlags';

// ═══════════════════════════════════════════════════════════════
// EAGER IMPORTS — only what the entry itself renders
// ═══════════════════════════════════════════════════════════════
// Left eager: the public layout shell and the landing page, so the
// highest-traffic route never waits on a second chunk request.
import { MainLayout } from '@layouts/MainLayout';
import { HomePage } from '@pages/HomePage';

// Code-split public pages.
//
// These used to be eager "for SSR", but that reasoning is obsolete here:
// pages/+config.ts runs Vike's Suspense-capable streaming renderer
// (`stream: { require: true, enable: false }`) exactly so lazy routes still
// produce real prerendered HTML — which is how the ~85 already-lazy routes
// (about, help-center, terms, privacy, contests, …) are crawled today. Being
// eager only meant every visitor downloaded these module graphs too, including
// the protected admin console below.
const FreelancersSearchPage = lazy(() => import('@pages/FreelancersSearchPage').then(m => ({ default: m.FreelancersSearchPage })));
const ServicesCatalogPage = lazy(() => import('@pages/ServicesCatalogPage').then(m => ({ default: m.ServicesCatalogPage })));
const HowItWorksPage = lazy(() => import('@pages/HowItWorksPage').then(m => ({ default: m.HowItWorksPage })));
const FeaturesPage = lazy(() => import('@pages/FeaturesPage').then(m => ({ default: m.FeaturesPage })));
const CategoriesPage = lazy(() => import('@pages/CategoriesPage').then(m => ({ default: m.CategoriesPage })));
const PricingPage = lazy(() => import('@pages/PricingPage').then(m => ({ default: m.PricingPage })));

// Lazy-loaded public pages (lower traffic, code-split for smaller main bundle)
const AboutPage = lazy(() => import('@pages/AboutPage').then(m => ({ default: m.AboutPage })));
const PhilosophyPage = lazy(() => import('@pages/PhilosophyPage').then(m => ({ default: m.PhilosophyPage })));
const ContactPage = lazy(() => import('@pages/ContactPage').then(m => ({ default: m.ContactPage })));
const ReportFeedbackPage = lazy(() => import('@pages/ReportFeedbackPage').then(m => ({ default: m.ReportFeedbackPage })));
const InternshipsPage = lazy(() => import('@pages/InternshipsPage').then(m => ({ default: m.InternshipsPage })));
const HelpCenterPage = lazy(() => import('@pages/HelpCenterPage').then(m => ({ default: m.HelpCenterPage })));
const SafetyPage = lazy(() => import('@pages/SafetyPage').then(m => ({ default: m.SafetyPage })));
const GuidelinesPage = lazy(() => import('@pages/GuidelinesPage').then(m => ({ default: m.GuidelinesPage })));
const StatusPage = lazy(() => import('@pages/StatusPage').then(m => ({ default: m.StatusPage })));
const TermsPage = lazy(() => import('@pages/TermsPage').then(m => ({ default: m.TermsPage })));
const PrivacyPage = lazy(() => import('@pages/PrivacyPage').then(m => ({ default: m.PrivacyPage })));
const EscrowPolicyPage = lazy(() => import('@pages/EscrowPolicyPage').then(m => ({ default: m.EscrowPolicyPage })));
const RefundPolicyPage = lazy(() => import('@pages/RefundPolicyPage').then(m => ({ default: m.RefundPolicyPage })));
const CookiesPage = lazy(() => import('@pages/CookiesPage').then(m => ({ default: m.CookiesPage })));

// Auth-adjacent (stay lazy — only visited via email/auth links, not crawlable)
const AuthCallbackPage = lazy(() => import('@pages/AuthCallbackPage').then(m => ({ default: m.AuthCallbackPage })));
const EmailConfirmPage = lazy(() => import('@pages/auth/EmailConfirmPage').then(m => ({ default: m.EmailConfirmPage })));
const VerifyEmailPage = lazy(() => import('@pages/auth/VerifyEmailPage').then(m => ({ default: m.VerifyEmailPage })));

// Dynamic routes (can't be prerendered — no fixed URL list at build time)
const PublicFreelancerProfilePage = lazy(() => import('@pages/PublicFreelancerProfilePage').then(m => ({ default: m.PublicFreelancerProfilePage })));
const ServiceDetailPage = lazy(() => import('@pages/ServiceDetailPage').then(m => ({ default: m.ServiceDetailPage })));
const ProjectDetailsPage = lazy(() => import('@pages/ProjectDetailsPage').then(m => ({ default: m.ProjectDetailsPage })));
const PaymentCallbackPage = lazy(() => import('@pages/PaymentCallbackPage').then(m => ({ default: m.PaymentCallbackPage })));
const ContestsPage = lazy(() => import('@pages/ContestsPage').then(m => ({ default: m.ContestsPage })));
const ContestDetailPage = lazy(() => import('@pages/ContestDetailPage').then(m => ({ default: m.ContestDetailPage })));
const CertificateVerifyPage = lazy(() => import('@pages/CertificateVerifyPage').then(m => ({ default: m.CertificateVerifyPage })));

const NotFoundPage = lazy(() => import('@pages/NotFoundPage').then(m => ({ default: m.NotFoundPage })));
const WaitlistPage = lazy(() => import('@pages/WaitlistPage').then(m => ({ default: m.WaitlistPage })));
const UnsubscribePage = lazy(() => import('@pages/UnsubscribePage').then(m => ({ default: m.UnsubscribePage })));

// ═══════════════════════════════════════════════════════════════
// LAZY IMPORTS — auth-protected routes (no SSR needed)
// ═══════════════════════════════════════════════════════════════
const DashboardLayout = lazy(() =>
  import('@layouts/DashboardLayout').then(m => ({ default: m.DashboardLayout }))
);
const ClientDashboardLayout = lazy(() =>
  import('@layouts/ClientDashboardLayout').then(m => ({ default: m.ClientDashboardLayout }))
);
// The admin console is behind AdminAuthGuard and is never crawled, so its
// layout + guard must never sit in the public critical path.
const AdminAuthGuard = lazy(() => import('@components/AdminAuthGuard').then(m => ({ default: m.AdminAuthGuard })));
const AdminDashboardLayout = lazy(() => import('@layouts/AdminDashboardLayout').then(m => ({ default: m.AdminDashboardLayout })));

// Dashboard Pages - Freelancer
const OverviewPage = lazy(() => import('@pages/dashboard/OverviewPage').then(m => ({ default: m.OverviewPage })));
const ProjectFeedPage = lazy(() => import('@pages/dashboard/ProjectFeedPage').then(m => ({ default: m.ProjectFeedPage })));
const InvitesPage = lazy(() => import('@pages/dashboard/InvitesPage').then(m => ({ default: m.InvitesPage })));
const ProposalsPage = lazy(() => import('@pages/dashboard/ProposalsPage').then(m => ({ default: m.ProposalsPage })));
const ContractsPage = lazy(() => import('@pages/dashboard/ContractsPage').then(m => ({ default: m.ContractsPage })));
const WorkspacePage = lazy(() => import('@pages/dashboard/WorkspacePage').then(m => ({ default: m.WorkspacePage })));
const WalletPage = lazy(() => import('@pages/dashboard/WalletPage').then(m => ({ default: m.WalletPage })));
const ProfessionalProfilePage = lazy(() => import('@pages/dashboard/ProfessionalProfilePage').then(m => ({ default: m.ProfessionalProfilePage })));
const ReferralsPage = lazy(() => import('@pages/ReferralsPage').then(m => ({ default: m.ReferralsPage })));
const ProSubscriptionPage = lazy(() => import('@pages/ProSubscriptionPage').then(m => ({ default: m.ProSubscriptionPage })));
const ServicesPage = lazy(() => import('@pages/dashboard/ServicesPage').then(m => ({ default: m.ServicesPage })));
const CreateServicePage = lazy(() => import('@pages/dashboard/CreateServicePage').then(m => ({ default: m.CreateServicePage })));
const AIAssistantPage = lazy(() => import('@pages/dashboard/AIAssistantPage').then(m => ({ default: m.AIAssistantPage })));
const PortfolioPage = lazy(() => import('@pages/dashboard/PortfolioPage').then(m => ({ default: m.PortfolioPage })));
const AnalyticsPage = lazy(() => import('@pages/dashboard/AnalyticsPage').then(m => ({ default: m.AnalyticsPage })));
const NotificationsCenterPage = lazy(() => import('@pages/dashboard/NotificationsCenterPage').then(m => ({ default: m.NotificationsCenterPage })));
const SupportTicketsPage = lazy(() => import('@pages/dashboard/SupportTicketsPage'));
const DisputeResolutionPage = lazy(() => import('@pages/dashboard/DisputeResolutionPage').then(m => ({ default: m.DisputeResolutionPage })));
const SkillCertificationsPage = lazy(() => import('@pages/dashboard/SkillCertificationsPage').then(m => ({ default: m.SkillCertificationsPage })));
const SkillTestPage = lazy(() => import('@pages/dashboard/SkillTestPage').then(m => ({ default: m.SkillTestPage })));
const TimeTrackingPage = lazy(() => import('@pages/dashboard/TimeTrackingPage').then(m => ({ default: m.TimeTrackingPage })));
const ContestsDashboardPage = lazy(() => import('@pages/dashboard/ContestsDashboardPage').then(m => ({ default: m.ContestsDashboardPage })));


// Dashboard Pages - Client
const ClientDashboardPage = lazy(() => import('../pages/ClientDashboard').then(module => ({ default: module.default })));
const ClientProjectsPage = lazy(() => import('@pages/ClientProjectsPage').then(m => ({ default: m.ClientProjectsPage })));
const ClientMatchesPage = lazy(() => import('@pages/ClientMatchesPage').then(m => ({ default: m.ClientMatchesPage })));
const ClientInvitesPage = lazy(() => import('@pages/ClientInvitesPage').then(m => ({ default: m.ClientInvitesPage })));
const ClientProposalsPage = lazy(() => import('@pages/ClientProposalsPage').then(m => ({ default: m.ClientProposalsPage })));
const ClientContractsPage = lazy(() => import('@pages/ClientContractsPage').then(m => ({ default: m.ClientContractsPage })));
const ClientWorkspacePage = lazy(() => import('@pages/ClientWorkspacePage').then(m => ({ default: m.ClientWorkspacePage })));
const ClientPostProjectPage = lazy(() => import('@pages/ClientPostProjectPage').then(m => ({ default: m.ClientPostProjectPage })));
const ClientAIAssistantPage = lazy(() => import('@pages/ClientAIAssistantPage').then(m => ({ default: m.ClientAIAssistantPage })));
const ClientPaymentsPage = lazy(() => import('@pages/ClientPaymentsPage').then(m => ({ default: m.ClientPaymentsPage })));
const ClientSettingsPage = lazy(() => import('@pages/ClientSettingsPage').then(m => ({ default: m.ClientSettingsPage })));
const ClientFreelancerSearchPage = lazy(() => import('@pages/ClientFreelancerSearchPage').then(m => ({ default: m.ClientFreelancerSearchPage })));
const ClientReviewsPage = lazy(() => import('@pages/ClientReviewsPage').then(m => ({ default: m.ClientReviewsPage })));
const ClientContestsPage = lazy(() => import('@pages/ClientContestsPage').then(m => ({ default: m.ClientContestsPage })));
const ClientContestCreatePage = lazy(() => import('@pages/ClientContestCreatePage').then(m => ({ default: m.ClientContestCreatePage })));
const ClientReferralsPage = lazy(() => import('@pages/ClientReferralsPage').then(m => ({ default: m.ClientReferralsPage })));
const ClientTeamProjectsPage = lazy(() => import('@pages/ClientTeamProjectsPage').then(m => ({ default: m.ClientTeamProjectsPage })));
const ClientPostTeamProjectPage = lazy(() => import('@pages/ClientPostTeamProjectPage').then(m => ({ default: m.ClientPostTeamProjectPage })));
const ClientTeamProjectDetailPage = lazy(() => import('@pages/ClientTeamProjectDetailPage').then(m => ({ default: m.ClientTeamProjectDetailPage })));


// Dashboard Pages - Admin
const AdminDashboard = lazy(() => import('@pages/AdminDashboard').then(m => ({ default: m.AdminDashboard })));
const AdminUsersPage = lazy(() => import('@pages/admin/AdminUsersPage').then(m => ({ default: m.AdminUsersPage })));
const AdminProjectsPage = lazy(() => import('@pages/admin/AdminProjectsPage').then(m => ({ default: m.AdminProjectsPage })));
const AdminContractsPage = lazy(() => import('@pages/admin/AdminContractsPage').then(m => ({ default: m.AdminContractsPage })));
const AdminPaymentsPage = lazy(() => import('@pages/admin/AdminPaymentsPage').then(m => ({ default: m.AdminPaymentsPage })));
const AdminFinancePage = lazy(() => import('@pages/admin/AdminFinancePage').then(m => ({ default: m.AdminFinancePage })));
const AdminWithdrawalsPage = lazy(() => import('@pages/admin/AdminWithdrawalsPage').then(m => ({ default: m.AdminWithdrawalsPage })));
const AdminDisputesPage = lazy(() => import('@pages/admin/AdminDisputesPage').then(m => ({ default: m.AdminDisputesPage })));
const AdminSubscriptionsPage = lazy(() => import('@pages/admin/AdminSubscriptionsPage').then(m => ({ default: m.AdminSubscriptionsPage })));
const AdminReportsPage = lazy(() => import('@pages/admin/AdminReportsPage').then(m => ({ default: m.AdminReportsPage })));
const AdminInternshipsPage = lazy(() => import('@pages/admin/AdminInternshipsPage').then(m => ({ default: m.AdminInternshipsPage })));
const AdminCertificatesPage = lazy(() => import('@pages/admin/AdminCertificatesPage').then(m => ({ default: m.AdminCertificatesPage })));
const AdminIdentityVerificationPage = lazy(() => import('@pages/admin/AdminIdentityVerificationPage').then(m => ({ default: m.AdminIdentityVerificationPage })));
// One light-KYC screen (name + email + phone) shared by both roles.
const IdentityVerificationPage = lazy(() => import('@pages/dashboard/IdentityVerificationPage').then(m => ({ default: m.IdentityVerificationPage })));
const AdminSupportTicketsPage = lazy(() => import('@pages/admin/AdminSupportTicketsPage').then(m => ({ default: m.AdminSupportTicketsPage })));
const AdminUserReportsPage = lazy(() => import('@pages/admin/AdminUserReportsPage').then(m => ({ default: m.AdminUserReportsPage })));
const AdminWaitlistPage = lazy(() => import('@pages/admin/AdminWaitlistPage').then(m => ({ default: m.AdminWaitlistPage })));
const AdminDataIsolationPage = lazy(() => import('@pages/admin/AdminDataIsolationPage').then(m => ({ default: m.AdminDataIsolationPage })));

// Onboarding
const OnboardingPage = lazy(() => import('@pages/OnboardingPage').then(m => ({ default: m.OnboardingPage })));
const DevDebugPage = import.meta.env.DEV
  ? lazy(() => import('@pages/DebugPage').then(m => ({ default: m.DebugPage })))
  : null;

// RouteFallback now imported from LoadingSkeleton component

/**
 * `/signup?ref=…` is a redirect, not a page. It must carry the referral code
 * across to the homepage modal or every shared invite link loses attribution.
 */
function SignupRedirect() {
  const location = useLocation();
  return <Navigate to={buildSignupRedirectTarget(location.search)} replace />;
}

// Deferred-module switches, read once at module load (they are build-time
// VITE_* values, so they cannot change while the app is running).
const INTERNSHIPS_ENABLED = isFeatureEnabled('internships');
const CERTIFICATES_ENABLED = isFeatureEnabled('certificates');
const CONTESTS_ENABLED = isFeatureEnabled('contests');

function App() {
  const isDev = import.meta.env.DEV;

  // 🎯 Boot splash: once the router has rendered the correct page (first
  // painted frame), hide the pre-hydration overlay that covers non-prerendered
  // routes — otherwise the SPA-fallback homepage shell would flash before
  // hydration (e.g. "onboarding done → homepage flashes → dashboard appears").
  useEffect(() => {
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        (window as unknown as { __growlancerBootReady?: () => void }).__growlancerBootReady?.();
      });
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, []);

  return (
    <>
      <ErrorBoundary>
        <ThemeProvider>
        <AuthProvider>
          <CurrencyProvider>
          <I18nProvider>
          <ToastProvider>
          <ScrollToTop />
          {/* Per-route <title>/description/canonical/OG. Must stay INSIDE the router
              (it reads useLocation) and must be mounted at all — it was written but
              never rendered, so every page shipped the homepage title. */}
          <RouteHead />
          <Suspense fallback={<RouteFallback />}>
            <Routes>
              {/* Public Routes */}
              <Route path="/" element={<MainLayout />}>
                <Route index element={<HomePage />} />
                <Route path="login" element={<Navigate to="/?modal=login" replace />} />
                <Route path="signup" element={<SignupRedirect />} />
                <Route path="how-it-works" element={<HowItWorksPage />} />
                <Route path="features" element={<FeaturesPage />} />
                <Route path="categories" element={<CategoriesPage />} />
                <Route path="pricing" element={<PricingPage />} />
                <Route path="about" element={<AboutPage />} />
                <Route path="philosophy" element={<PhilosophyPage />} />
                {/* Deferred for early access (switch: src/lib/featureFlags.ts).
                    The route always exists so a shared link lands on an honest
                    explanation instead of a 404; the internship function answers
                    410 while the flag is off. */}
                <Route
                  path="internships"
                  element={INTERNSHIPS_ENABLED ? <InternshipsPage /> : <FeatureUnavailablePage />}
                />
                <Route
                  path="careers"
                  element={INTERNSHIPS_ENABLED ? <InternshipsPage /> : <FeatureUnavailablePage />}
                />
                <Route path="contact" element={<ContactPage />} />
                <Route path="report" element={<ReportFeedbackPage />} />
                <Route path="help-center" element={<HelpCenterPage />} />
                <Route path="safety" element={<SafetyPage />} />
                <Route path="guidelines" element={<GuidelinesPage />} />
                <Route path="status" element={<StatusPage />} />
                <Route path="terms" element={<TermsPage />} />
                <Route path="privacy" element={<PrivacyPage />} />
                <Route path="escrow-policy" element={<EscrowPolicyPage />} />
                <Route path="refund-policy" element={<RefundPolicyPage />} />
                <Route path="cookies" element={<CookiesPage />} />
                <Route path="projects/:projectId" element={<ProjectDetailsPage />} />
                <Route path="payment/:outcome" element={<PaymentCallbackPage />} />
                <Route path="freelancers" element={<FreelancersSearchPage />} />
                <Route path="services" element={<ServicesCatalogPage />} />
                <Route path="freelancer/:freelancerId" element={<PublicFreelancerProfilePage />} />
                <Route path="services/:serviceId" element={<ServiceDetailPage />} />
                <Route
                  path="contests"
                  element={CONTESTS_ENABLED ? <ContestsPage /> : <FeatureUnavailablePage />}
                />
                <Route
                  path="contests/:contestId"
                  element={CONTESTS_ENABLED ? <ContestDetailPage /> : <FeatureUnavailablePage />}
                />
              </Route>

              {/* Certificate verification is deferred for early access: the
                  public route it called returned applicant PII, and the product
                  no longer issues certificates in this release. */}
              <Route
                path="certificate/:code"
                element={CERTIFICATES_ENABLED ? <CertificateVerifyPage /> : <FeatureUnavailablePage />}
              />
              <Route
                path="certificate"
                element={CERTIFICATES_ENABLED ? <CertificateVerifyPage /> : <FeatureUnavailablePage />}
              />
              <Route
                path="verify-certificate/:code"
                element={CERTIFICATES_ENABLED ? <CertificateVerifyPage /> : <FeatureUnavailablePage />}
              />
              <Route
                path="verify-certificate"
                element={CERTIFICATES_ENABLED ? <CertificateVerifyPage /> : <FeatureUnavailablePage />}
              />

              {/* Auth Email Action Routes */}
              <Route path="auth/callback" element={<AuthCallbackPage />} />
              <Route path="auth/email-confirm" element={<EmailConfirmPage />} />
              <Route path="auth/verify-email" element={<VerifyEmailPage />} />

              {/* Debug route is only available in development */}
              {isDev && DevDebugPage && <Route path="/debug" element={<DevDebugPage />} />}

              {/* Onboarding Routes - Protected */}
              <Route
                path="/onboarding"
                element={
                  // 🎯 ONE onboarding for everyone — no role gate so brand-new
                  // OAuth users (role not finalised yet) can onboard and pick
                  // their account type on the welcome step. Role-specific paths
                  // below still exist as legacy deep links.
                  <ProtectedRoute>
                    <OnboardingPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/onboarding/freelancer"
                element={
                  <ProtectedRoute allowedRoles={['freelancer']}>
                    <OnboardingPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/onboarding/client"
                element={
                  <ProtectedRoute allowedRoles={['client']}>
                    <OnboardingPage />
                  </ProtectedRoute>
                }
              />

              {/* Freelancer Dashboard Routes - Protected */}
              <Route
                path="/dashboard"
                element={
                  <ProtectedRoute allowedRoles={['freelancer']}>
                    <DashboardLayout />
                  </ProtectedRoute>
                }
              >
                <Route index element={<OverviewPage />} />
                <Route path="overview" element={<Navigate to="/dashboard" replace />} />
                <Route path="feed" element={<ProjectFeedPage />} />
                {/* Old email links pointed at /dashboard/projects; send them to the feed. */}
                <Route path="projects" element={<Navigate to="/dashboard/feed" replace />} />
                {/* Billing emails used /dashboard/subscription before the page moved to /pro. */}
                <Route path="subscription" element={<Navigate to="/dashboard/pro" replace />} />
                <Route path="invites" element={<InvitesPage />} />
                <Route path="proposals" element={<ProposalsPage />} />
                <Route path="contracts" element={<ContractsPage />} />
                <Route path="workspace" element={<WorkspacePage />} />
                <Route path="wallet" element={<WalletPage />} />
                <Route path="profile" element={<ProfessionalProfilePage />} />
                <Route path="settings" element={<Navigate to="/dashboard/profile" replace />} />
                <Route path="referrals" element={<ReferralsPage />} />
                <Route path="pro" element={<ProSubscriptionPage />} />
                {/* Single Premium page — old separate AI-subscription flow merged */}
                <Route path="ai-subscription" element={<Navigate to="/dashboard/pro" replace />} />
                <Route path="ai-assistant" element={<AIAssistantPage />} />
                <Route path="services" element={<ServicesPage />} />
                <Route path="services/create" element={<CreateServicePage />} />
                <Route path="services/edit/:serviceId" element={<CreateServicePage />} />
                <Route path="portfolio" element={<PortfolioPage />} />
                <Route path="analytics" element={<AnalyticsPage />} />
                <Route path="notifications" element={<NotificationsCenterPage />} />
                {/* Old Inbox links redirect to the Notifications Center */}
                <Route path="inbox" element={<Navigate to="notifications" replace />} />
                <Route path="disputes" element={<DisputeResolutionPage />} />
                <Route path="dispute-resolution" element={<Navigate to="/dashboard/disputes" replace />} />
                <Route path="support-tickets" element={<SupportTicketsPage />} />
                {/* Light KYC (name + email + phone) for freelancers; the same
                    component serves /client/verification. */}
                <Route path="identity-verification" element={<IdentityVerificationPage />} />
                <Route
                  path="certifications"
                  element={CERTIFICATES_ENABLED ? <SkillCertificationsPage /> : <FeatureUnavailablePage />}
                />
                <Route
                  path="certifications/:testId"
                  element={CERTIFICATES_ENABLED ? <SkillTestPage /> : <FeatureUnavailablePage />}
                />
                <Route path="time-tracking" element={<TimeTrackingPage />} />
                <Route
                  path="contests"
                  element={CONTESTS_ENABLED ? <ContestsDashboardPage /> : <FeatureUnavailablePage />}
                />
                <Route path="help-center" element={<HelpCenterPage dashboard />} />
              </Route>


              {/* Client Dashboard Routes - Protected */}
              <Route
                path="/client"
                element={
                  <ProtectedRoute allowedRoles={['client']}>
                    <ClientDashboardLayout />
                  </ProtectedRoute>
                }
              >
                <Route index element={<ClientDashboardPage />} />
                <Route path="post" element={<ClientPostProjectPage />} />
                <Route path="projects" element={<ClientProjectsPage />} />
                <Route path="matches" element={<ClientMatchesPage />} />
                <Route path="invites" element={<ClientInvitesPage />} />
                <Route path="proposals" element={<ClientProposalsPage />} />
                <Route path="contracts" element={<ClientContractsPage />} />
                <Route path="workspace" element={<ClientWorkspacePage />} />
                {/* Direct contract workspace URLs (e.g. /client/workspace/:id) — must not 404 on refresh */}
                <Route path="workspace/:contractId" element={<ClientWorkspacePage />} />
                <Route path="notifications" element={<NotificationsCenterPage />} />
                {/* Old Inbox links redirect to the Notifications Center */}
                <Route path="inbox" element={<Navigate to="notifications" replace />} />
                <Route path="payments" element={<ClientPaymentsPage />} />
                <Route path="settings" element={<ClientSettingsPage />} />
                {/* Light KYC — the same three criteria as the freelancer screen. */}
                <Route path="verification" element={<IdentityVerificationPage />} />
                <Route path="support-tickets" element={<SupportTicketsPage />} />
                {/* ROUTES.CLIENT.TICKETS pointed at /client/tickets, which had no
                    route — shared links landed on the 404 page. */}
                <Route path="tickets" element={<Navigate to="/client/support-tickets" replace />} />
                <Route path="referrals" element={<ClientReferralsPage />} />
                <Route path="team-projects" element={<ClientTeamProjectsPage />} />
                <Route path="team-projects/create" element={<ClientPostTeamProjectPage />} />
                <Route path="team-projects/:teamProjectId" element={<ClientTeamProjectDetailPage />} />
                {/* Clients are 100% free — no subscription. Old links redirect to the free AI assistant. */}
                <Route path="ai-subscription" element={<Navigate to="/client/ai-assistant" replace />} />
                <Route path="ai-assistant" element={<ClientAIAssistantPage />} />
                <Route path="find-talent" element={<ClientFreelancerSearchPage />} />
                <Route path="reviews" element={<ClientReviewsPage />} />
                <Route
                  path="contests"
                  element={CONTESTS_ENABLED ? <ClientContestsPage /> : <FeatureUnavailablePage />}
                />
                <Route
                  path="contests/create"
                  element={CONTESTS_ENABLED ? <ClientContestCreatePage /> : <FeatureUnavailablePage />}
                />
                <Route path="help-center" element={<HelpCenterPage dashboard />} />
              </Route>

              {/* Admin Dashboard Routes - Protected by Supabase Auth */}
              <Route
                path="/admin"
                element={
                  <AdminAuthGuard>
                    <AdminDashboardLayout />
                  </AdminAuthGuard>
                }
              >
                <Route index element={<AdminDashboard />} />
                <Route path="users" element={<AdminUsersPage />} />
                <Route path="projects" element={<AdminProjectsPage />} />
                <Route path="contracts" element={<AdminContractsPage />} />
                <Route path="payments" element={<AdminPaymentsPage />} />
                <Route path="finance" element={<AdminFinancePage />} />
                <Route path="withdrawals" element={<AdminWithdrawalsPage />} />
                <Route path="disputes" element={<AdminDisputesPage />} />
                <Route path="subscriptions" element={<AdminSubscriptionsPage />} />
                <Route path="reports" element={<AdminReportsPage />} />
                <Route
                  path="internships"
                  element={INTERNSHIPS_ENABLED ? <AdminInternshipsPage /> : <FeatureUnavailablePage />}
                />
                <Route
                  path="certificates"
                  element={CERTIFICATES_ENABLED ? <AdminCertificatesPage /> : <FeatureUnavailablePage />}
                />
                <Route path="identity-verification" element={<AdminIdentityVerificationPage />} />
                <Route path="support-tickets" element={<AdminSupportTicketsPage />} />
                <Route path="user-reports" element={<AdminUserReportsPage />} />
                <Route path="waitlist" element={<AdminWaitlistPage />} />
                <Route path="data-isolation" element={<AdminDataIsolationPage />} />
              </Route>

              {/* Waitlist Route (public, no layout) */}
              <Route path="/waitlist" element={<WaitlistPage />} />

              {/* Newsletter unsubscribe link — must never 404 */}
              <Route path="/unsubscribe" element={<UnsubscribePage />} />

              {/* 404 Fallback */}
              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </Suspense>
          <CookieConsent />
          {/* Honest feedback when a provider round-trip never completes
              (rendered globally so it is reachable from every entry page). */}
          <OAuthReturnNotice />
          </ToastProvider>
          </I18nProvider>
          </CurrencyProvider>
        </AuthProvider>
        </ThemeProvider>
      </ErrorBoundary>
    </>
  );
}

export default App;
