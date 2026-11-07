// Central Routes Configuration for Growlanzo
// All route paths are defined here to ensure consistency across the app

export const ROUTES = {
  // Public Routes
  HOME: '/',
  LOGIN: '/login',
  SIGNUP: '/signup',
  INTERNSHIPS: '/internships',
  CAREERS: '/careers',
  
  // Marketplace Browse (public)
  FREELANCERS: '/freelancers',
  SERVICES: '/services',
  CONTESTS: '/contests',
  
  // Public Info Pages
  HOW_IT_WORKS: '/how-it-works',
  FEATURES: '/features',
  CATEGORIES: '/categories',
  PRICING: '/pricing',
  ABOUT: '/about',
  PHILOSOPHY: '/philosophy',
  CONTACT: '/contact',
  HELP_CENTER: '/help-center',
  SAFETY: '/safety',
  GUIDELINES: '/guidelines',
  STATUS: '/status',
  TERMS: '/terms',
  PRIVACY: '/privacy',
  ESCROW_POLICY: '/escrow-policy',
  COOKIES: '/cookies',
  PAYMENT_SUCCESS: '/payment/success',
  PAYMENT_CANCEL: '/payment/cancel',
  
  // Freelancer Dashboard Routes
  FREELANCER: {
    ROOT: '/dashboard',
    DASHBOARD: '/dashboard',
    FEED: '/dashboard/feed',
    INVITES: '/dashboard/invites',
    PROPOSALS: '/dashboard/proposals',
    CONTRACTS: '/dashboard/contracts',
    WORKSPACE: '/dashboard/workspace',
    WALLET: '/dashboard/wallet',
    PROFILE: '/dashboard/profile',
    SETTINGS: '/dashboard/settings',
    REFERRALS: '/dashboard/referrals',
    PRO: '/dashboard/pro',
    PORTFOLIO: '/dashboard/portfolio',
    ANALYTICS: '/dashboard/analytics',
    INBOX: '/dashboard/inbox',
    NOTIFICATIONS: '/dashboard/notifications',
    DISPUTES: '/dashboard/disputes',
    IDENTITY_VERIFICATION: '/dashboard/identity-verification',
    SERVICES: '/dashboard/services',
    SERVICES_CREATE: '/dashboard/services/create',
    SERVICES_EDIT: '/dashboard/services/edit/:serviceId',
    AI_SUBSCRIPTION: '/dashboard/ai-subscription',
    AI_ASSISTANT: '/dashboard/ai-assistant',
    TICKETS: '/dashboard/tickets',
    CERTIFICATIONS: '/dashboard/certifications',
    TIME_TRACKING: '/dashboard/time-tracking',
  },
  
  // Client Dashboard Routes
  CLIENT: {
    ROOT: '/client',
    DASHBOARD: '/client',
    POST: '/client/post',
    PROJECTS: '/client/projects',
    MATCHES: '/client/matches',
    FIND_TALENT: '/client/find-talent',
    INVITES: '/client/invites',
    PROPOSALS: '/client/proposals',
    CONTRACTS: '/client/contracts',
    WORKSPACE: '/client/workspace',
    INBOX: '/client/inbox',
    NOTIFICATIONS: '/client/notifications',
    PAYMENTS: '/client/payments',
    SETTINGS: '/client/settings',
    VERIFICATION: '/client/verification',
    REFERRALS: '/client/referrals',
    // Clients are 100% free — AI_SUBSCRIPTION removed (redirects to AI assistant)
    AI_ASSISTANT: '/client/ai-assistant',
    TICKETS: '/client/tickets',
    REVIEWS: '/client/reviews',
    CONTESTS: '/client/contests',
    CONTESTS_CREATE: '/client/contests/create',
    TEAM_PROJECTS: '/client/team-projects',
    TEAM_PROJECTS_CREATE: '/client/team-projects/create',
    TEAM_PROJECT_DETAIL: '/client/team-projects/:teamProjectId',
  },
  
  // Admin Dashboard Routes
  ADMIN: {
    ROOT: '/admin',
    DASHBOARD: '/admin',
    USERS: '/admin/users',
    EMAILS: '/admin/emails',
    PROJECTS: '/admin/projects',
    CONTRACTS: '/admin/contracts',
    PAYMENTS: '/admin/payments',
    FINANCE: '/admin/finance',
    DISPUTES: '/admin/disputes',
    SUBSCRIPTIONS: '/admin/subscriptions',
    REPORTS: '/admin/reports',
    CERTIFICATES: '/admin/certificates',
    SUPPORT_TICKETS: '/admin/support-tickets',
    IDENTITY_VERIFICATION: '/admin/identity-verification',
  },
  
  // Certificate Verification — Unified /certificate or /verify-certificate both work
  CERTIFICATE: '/certificate',
  CERTIFICATE_CODE: '/certificate/:code',
  VERIFY_CERTIFICATE: '/verify-certificate',
  VERIFY_CERTIFICATE_CODE: '/verify-certificate/:code',
  
  // Onboarding
  ONBOARDING: {
    FREELANCER: '/onboarding/freelancer',
    CLIENT: '/onboarding/client',
  },
  
  // Auth Email Action Routes
  // (The password-era routes — forgot/reset password, magic link, OTP login —
  // were removed with the email/password flow; sign-in is GitHub/LinkedIn only.
  // Only the two that are actually routed stay here.)
  EMAIL_CONFIRM: '/auth/email-confirm',
  AUTH_CALLBACK: '/auth/callback',

  // Public routes
  PUBLIC: {
    FREELANCER_PROFILE: '/freelancer/:freelancerId',
    SERVICE_DETAIL: '/services/:serviceId',
  },

  // Fallback
  NOT_FOUND: '*',
} as const;

// Type for route values
type RouteValue = string | { [key: string]: RouteValue };

// Helper to get nested route values
export function getRoute(path: string): string {
  const parts = path.split('.');
  let current: RouteValue = ROUTES;
  
  for (const part of parts) {
    if (typeof current === 'object' && current !== null && part in current) {
      current = current[part as keyof typeof current];
    } else {
      return '/';
    }
  }
  
  return typeof current === 'string' ? current : '/';
}

// Navigation items for Header/Footer
export const NAVIGATION = {
  product: [
    { label: 'How it works', path: ROUTES.HOW_IT_WORKS },
    { label: 'Features', path: ROUTES.FEATURES },
    { label: 'Categories', path: ROUTES.CATEGORIES },
    { label: 'Pricing', path: ROUTES.PRICING },
  ],
  company: [
    { label: 'About', path: ROUTES.ABOUT },
    { label: 'Philosophy', path: ROUTES.PHILOSOPHY },
    { label: 'Contact', path: ROUTES.CONTACT },
    { label: 'Careers', path: ROUTES.CAREERS },
  ],
  support: [
    { label: 'Help center', path: ROUTES.HELP_CENTER },
    { label: 'Safety & trust', path: ROUTES.SAFETY },
    { label: 'Guidelines', path: ROUTES.GUIDELINES },
    { label: 'Status', path: ROUTES.STATUS },
  ],
  legal: [
    { label: 'Terms', path: ROUTES.TERMS },
    { label: 'Privacy', path: ROUTES.PRIVACY },
    { label: 'Escrow policy', path: ROUTES.ESCROW_POLICY },
    { label: 'Cookies', path: ROUTES.COOKIES },
  ],
} as const;

// Platform configuration (India-first — all pricing in INR)
export const PLATFORM_CONFIG = {
  FEE_PERCENTAGE: 5,
  // Single flat Freelancer Premium plan (₹199/month) — optional, AI + tools only.
  // ONE price for everything: there is no second, costlier tier.
  PRO_PRICE: 199,
  CURRENCY: 'INR',
} as const;

// Disposable / temporary email domains to block (mirrors the server-side
// trigger in supabase/migrations/20261204010000_email_security_and_verification.sql)
// Full curated list lives in src/lib/disposableEmails.ts
import { DISPOSABLE_EMAILS } from './lib/disposableEmails';

export { DISPOSABLE_EMAILS };

// ⚠️ Keep validation fast — validation.ts builds a Set once from DISPOSABLE_EMAILS
