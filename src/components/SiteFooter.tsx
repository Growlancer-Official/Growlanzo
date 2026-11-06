import { Link } from 'react-router-dom';
import { ArrowRight, Mail, MapPin, ShieldCheck } from 'lucide-react';
import { isFeatureEnabled } from '../lib/featureFlags';
import { openConsentPreferences } from '../lib/consent';
import { BrandLogo } from './BrandLogo';

type SiteFooterProps = {
  onOpenSignup?: (role?: 'freelancer' | 'client') => void;
};

export function SiteFooter({ onOpenSignup }: SiteFooterProps) {
  return (
    <footer className="border-t border-slate-200 bg-white">
      {/* Main Footer Content */}
      <div className="mx-auto max-w-[100rem] px-4 sm:px-6 lg:px-8 2xl:px-12 py-8 sm:py-10">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-4 lg:gap-3">
          {/* Brand Column */}
          <div className="sm:col-span-2 lg:col-span-4">
            <Link to="/" className="inline-flex items-center gap-3 group">
              <BrandLogo variant="wordmark" className="h-10 sm:h-12 group-hover:scale-105 transition-transform duration-300 w-auto" />
              <div className="hidden sm:block">
                <div className="text-xs text-slate-500">AI-Powered Freelancing Marketplace</div>
              </div>
            </Link>
            <p className="mt-5 text-sm text-slate-600 leading-relaxed max-w-sm">
              Built to reduce hiring noise, protect payments with escrow, and keep collaboration structured — so you can focus on the work that matters.
            </p>
            
            {/* Trust Badges */}
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <div className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 rounded-lg ring-1 ring-emerald-200/50">
                <ShieldCheck className="w-4 h-4 text-emerald-600" />
                <span className="text-xs font-medium text-emerald-700">Escrow protected</span>
              </div>
              <div className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-50 rounded-lg ring-1 ring-slate-200">
                <MapPin className="w-4 h-4 text-slate-500" />
                <span className="text-xs font-medium text-slate-600">India-First</span>
              </div>
            </div>
          </div>

          {/* Product Links */}
          <div className="lg:col-span-2">
            <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Product</div>
            <ul className="space-y-3">
              <li><Link to="/how-it-works" className="text-sm text-slate-600 hover:text-emerald-600 transition-colors duration-200">How it works</Link></li>
              <li><Link to="/features" className="text-sm text-slate-600 hover:text-emerald-600 transition-colors duration-200">Features</Link></li>
              <li><Link to="/categories" className="text-sm text-slate-600 hover:text-emerald-600 transition-colors duration-200">Categories</Link></li>
              <li><Link to="/pricing" className="text-sm text-slate-600 hover:text-emerald-600 transition-colors duration-200">Pricing</Link></li>
              {/* Deferred for early access — not advertised in the footer. */}
              {isFeatureEnabled('internships') && <li><Link to="/internships" className="text-sm text-slate-600 hover:text-emerald-600 transition-colors duration-200">Internships</Link></li>}
            </ul>
          </div>

          {/* Company Links */}
          <div className="lg:col-span-2">
            <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Company</div>
            <ul className="space-y-3">
              <li><Link to="/about" className="text-sm text-slate-600 hover:text-emerald-600 transition-colors duration-200">About</Link></li>
              <li><Link to="/philosophy" className="text-sm text-slate-600 hover:text-emerald-600 transition-colors duration-200">Philosophy</Link></li>
              <li><Link to="/contact" className="text-sm text-slate-600 hover:text-emerald-600 transition-colors duration-200">Contact</Link></li>
              {isFeatureEnabled('internships') && <li><Link to="/careers" className="text-sm text-slate-600 hover:text-emerald-600 transition-colors duration-200">Careers</Link></li>}
              <li><Link to="/freelancers" className="text-sm text-slate-600 hover:text-emerald-600 transition-colors duration-200">Find Freelancers</Link></li>
            </ul>
          </div>

          {/* Support Links */}
          <div className="lg:col-span-2">
            <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Support</div>
            <ul className="space-y-3">
              <li><Link to="/safety" className="text-sm text-slate-600 hover:text-emerald-600 transition-colors duration-200">Safety & Trust</Link></li>
              <li><Link to="/guidelines" className="text-sm text-slate-600 hover:text-emerald-600 transition-colors duration-200">Guidelines</Link></li>
              <li><Link to="/status" className="text-sm text-slate-600 hover:text-emerald-600 transition-colors duration-200">Platform Status</Link></li>
              <li><Link to="/help-center" className="text-sm text-slate-600 hover:text-emerald-600 transition-colors duration-200">Help Center</Link></li>
              <li><Link to="/report" className="text-sm text-slate-600 hover:text-emerald-600 transition-colors duration-200">Report a Bug / Feedback</Link></li>
            </ul>
          </div>

          {/* Legal Links */}
          <div className="lg:col-span-2">
            <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Legal</div>
            <ul className="space-y-3">
              <li><Link to="/terms" className="text-sm text-slate-600 hover:text-emerald-600 transition-colors duration-200">Terms of Service</Link></li>
              <li><Link to="/privacy" className="text-sm text-slate-600 hover:text-emerald-600 transition-colors duration-200">Privacy Policy</Link></li>
              <li><Link to="/escrow-policy" className="text-sm text-slate-600 hover:text-emerald-600 transition-colors duration-200">Escrow Policy</Link></li>
              <li><Link to="/refund-policy" className="text-sm text-slate-600 hover:text-emerald-600 transition-colors duration-200">Refund Policy</Link></li>
              <li><Link to="/cookies" className="text-sm text-slate-600 hover:text-emerald-600 transition-colors duration-200">Cookie Policy</Link></li>
              {/* Reopens the consent panel on any page — the choice must never
                  be a one-way door. Same line weight as the links beside it. */}
              <li>
                <button
                  type="button"
                  onClick={openConsentPreferences}
                  className="text-sm text-slate-600 hover:text-emerald-600 transition-colors duration-200 underline-offset-2 hover:underline"
                >
                  Cookie preferences
                </button>
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom Bar */}
        <div className="mt-6 pt-6 border-t border-slate-200">
          <div className="flex flex-col lg:flex-row items-center justify-between gap-3">
            {/* Copyright + legal contact */}
            <div className="text-sm text-slate-500 text-center lg:text-left">
              <div>
                &copy; {new Date().getFullYear()} <span className="font-semibold text-slate-800">Growlanzo</span>. 
                Built for clarity, speed, and trust. All rights reserved.
              </div>
              <div className="mt-1 text-xs text-slate-400">
                Operated from India · Grievances:{' '}
                <a href="mailto:growlanzo.own@gmail.com" className="text-slate-500 hover:text-emerald-600 transition-colors">
                  growlanzo.own@gmail.com
                </a>
                {' '}— acknowledged within 24 hours, resolved within 15 days.
              </div>
              <div className="mt-3 flex items-center gap-3">
                {/* Follow Us on Social Media */}
                <div className="inline-flex items-center gap-2 mr-4">
                  <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Follow us</span>
                </div>
                <a
                  href="https://x.com/Growlanzo"
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Growlanzo on X (Twitter)"
                  className="inline-flex items-center justify-center h-9 w-9 rounded-full ring-1 ring-slate-200 text-slate-500 hover:text-sky-500 hover:ring-sky-300 hover:bg-sky-50 transition-all duration-200"
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
                  </svg>
                </a>
                <a
                  href="https://www.instagram.com/invites/contact/?utm_source=ig_contact_invite&utm_medium=copy_link&utm_content=6xoewwb"
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Growlanzo on Instagram"
                  className="inline-flex items-center justify-center h-9 w-9 rounded-full ring-1 ring-slate-200 text-slate-500 hover:text-pink-500 hover:ring-pink-300 hover:bg-pink-50 transition-all duration-200"
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                    <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.844 0 3.204-.012 3.584-.069 4.844-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.844-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.844 0-3.204.013-3.583.07-4.843.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.844-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/>
                  </svg>
                </a>
                <a
                  href="https://www.linkedin.com/company/growlancercom/"
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Growlanzo on LinkedIn"
                  className="inline-flex items-center justify-center h-9 w-9 rounded-full ring-1 ring-slate-200 text-slate-500 hover:text-blue-600 hover:ring-blue-300 hover:bg-blue-50 transition-all duration-200"
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                    <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 1 1 0-4.124 2.062 2.062 0 0 1 0 4.124zM7.119 20.452H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.225 0z"/>
                  </svg>
                </a>
                <a
                  href="mailto:growlanzo.own@gmail.com"
                  aria-label="Email Growlanzo"
                  className="inline-flex items-center justify-center h-9 w-9 rounded-full ring-1 ring-slate-200 text-slate-500 hover:text-emerald-600 hover:ring-emerald-300 hover:bg-emerald-50 transition-all duration-200"
                >
                  <Mail className="w-4 h-4" />
                </a>
              </div>
            </div>

            {/* Trust & Payment Badges */}
            <div className="flex flex-col sm:flex-row items-center gap-4">
              {/* Payment Methods */}
              <div className="flex flex-col items-center gap-3">
                <div className="flex items-center gap-3 px-4 py-2 bg-slate-50 rounded-xl ring-1 ring-slate-200 flex-wrap justify-center">
                  <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Payments</span>
                  {/* Razorpay (primary) */}
                  <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Razorpay" style={{ marginTop: 2 }}>
                    <defs>
                      <linearGradient id="rzp-grad2" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stopColor="#3395FF"/>
                        <stop offset="100%" stopColor="#1A5CFF"/>
                      </linearGradient>
                    </defs>
                    <path fill="url(#rzp-grad2)" fillRule="evenodd" d="M22.436 0l-11.91 7.773-1.174 4.276 6.625-4.297L11.65 24h4.391l6.395-24zM14.26 10.098L3.389 17.166 1.564 24h9.008l3.688-13.902Z"/>
                  </svg>
                  {/* PayPal — Coming Soon (badge beside icon so the icon stays fully visible) */}
                  <span className="inline-flex items-center gap-1.5 shrink-0" title="PayPal — Coming Soon">
                    <svg className="h-5 w-5" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="PayPal">
                      <path fill="#003087" d="M7.016 19.198h-4.2a.562.562 0 0 1-.555-.65L5.093.584A.692.692 0 0 1 5.776 0h7.222c3.417 0 5.904 2.488 5.846 5.5-.006.25-.027.5-.066.747A6.794 6.794 0 0 1 12.071 12H8.743a.69.69 0 0 0-.682.583l-.325 2.056-.013.083-.692 4.39-.015.087z"/>
                      <path fill="#009cde" d="M19.79 6.142c-.01.087-.01.175-.023.261a7.76 7.76 0 0 1-7.695 6.598H9.007l-.283 1.795-.013.083-.692 4.39-.134.843-.014.088H6.86l-.497 3.15a.562.562 0 0 0 .555.65h3.612c.34 0 .63-.249.683-.585l.952-6.031a.692.692 0 0 1 .683-.584h2.126a6.793 6.793 0 0 0 6.707-5.752c.306-1.95-.466-3.744-1.89-4.906z"/>
                    </svg>
                    <span className="text-[10px] font-bold uppercase tracking-wide text-amber-700 bg-amber-100 ring-1 ring-amber-200 rounded px-1 py-px">Coming</span>
                  </span>
                  {/* UPI */}
                  <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 ring-1 ring-emerald-200 rounded px-1.5 py-0.5">UPI</span>
                  {/* Visa */}
                  <span className="text-xs font-black italic text-blue-800">VISA</span>
                  {/* Mastercard */}
                  <svg className="h-4 w-7 shrink-0" viewBox="0 0 24 16" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Mastercard">
                    <rect width="24" height="16" rx="3" fill="#fff"/>
                    <circle cx="9" cy="8" r="5" fill="#EB001B"/>
                    <circle cx="15" cy="8" r="5" fill="#F79E1B"/>
                    <path d="M12 4.2a5 5 0 0 1 0 7.6 5 5 0 0 1 0-7.6z" fill="#FF5F00"/>
                  </svg>
                  {/* Net Banking */}
                  <span className="text-xs font-medium text-slate-600">Net Banking</span>
                  <span className="text-slate-300 text-xs">|</span>
                  <span className="inline-flex items-center gap-1 text-xs text-slate-500"><ShieldCheck className="w-3.5 h-3.5 text-emerald-600" /> SSL Secured</span>
                </div>
                <span className="text-xs text-slate-400">Payments processed by Razorpay · contract funds held in Growlanzo escrow</span>
              </div>

              {/* CTA Buttons */}
              <div className="flex items-center gap-3">
                <button 
                  onClick={() => onOpenSignup?.('client')} 
                  className="inline-flex items-center justify-center h-11 px-4 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 active:bg-emerald-800 transition-all duration-200 shadow-sm hover:shadow-md"
                >
                  Get Started
                  <ArrowRight className="ml-1.5 w-4 h-4" />
                </button>
                <button 
                  onClick={() => onOpenSignup?.('freelancer')} 
                  className="inline-flex items-center justify-center h-11 px-4 rounded-lg bg-white text-slate-700 text-sm font-semibold ring-1 ring-slate-200 hover:bg-slate-50 hover:ring-slate-300 active:bg-slate-100 transition-all duration-200"
                >
                  Join as Freelancer
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
