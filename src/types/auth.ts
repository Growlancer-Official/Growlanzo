/**
 * Canonical auth types used by both the service layer and AuthContext.
 * These resolve field discrepancies between previous duplicate interfaces.
 */

export type UserRole = 'freelancer' | 'client' | 'admin';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  avatar?: string;
  isPro: boolean;
  referralCode?: string;
  createdAt?: string;
  onboardingCompleted?: boolean;
  country?: string;
  phone?: string;
  /** 'verified' once ACCOUNT verification (name + email + phone) passed — drives the
   *  verified badge everywhere. This is not KYC: full KYC is deferred for the Beta. */
  verificationStatus?: string | null;
}

export interface AuthResponse {
  success: boolean;
  user?: AuthUser;
  error?: string;
  message?: string;
}