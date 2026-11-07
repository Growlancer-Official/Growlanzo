import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lock, Eye, EyeOff, Shield, Loader2, AlertCircle } from 'lucide-react';
import { supabase, clearSupabaseAuthStorage } from '../../lib/supabase';
import { BrandLogo } from '../../components/BrandLogo';

/**
 * AdminLoginPage — Real-time login via Supabase Auth.
 * Uses supabase.auth.signInWithPassword() for proper authentication.
 * Real-time redirect via onAuthStateChange in AdminAuthGuard.
 */
export function AdminLoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Auto-redirect if already logged in (real-time via auth state)
  useEffect(() => {
    let cancelled = false;
    const checkSession = async () => {
      try {
        const result = await supabase.auth.getSession();
        if (cancelled) return;
        const session = result.data?.session ?? null;
        if (session?.user) {
          // Check if admin — use is_user_admin() RPC + profiles.role
          const { data: privData } = await supabase
            .from('profiles_private')
            .select('is_admin')
            .eq('id', session.user.id)
            .maybeSingle();
          const { data: pubData } = await supabase
            .from('profiles')
            .select('role')
            .eq('id', session.user.id)
            .maybeSingle();
          
          if (cancelled) return;
          const isAdmin = privData?.is_admin === true || pubData?.role === 'admin';
          
          if (isAdmin) {
            navigate('/admin', { replace: true });
          }
        }
      } catch {
        // Session check failed — silently ignore, user can try logging in
      }
    };
    checkSession();
    return () => { cancelled = true; };
  }, [navigate]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!email.trim() || !password.trim()) {
      setError('Please enter email and password');
      return;
    }

    setLoading(true);
    try {
      const { data, error: authError } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password: password.trim(),
      });

      if (authError) {
        if (authError.message.includes('Invalid login credentials')) {
          setError('Invalid email or password. Please try again.');
        } else if (authError.message.includes('Email not confirmed')) {
          setError('Please verify your email first. Check your inbox.');
        } else {
          setError(authError.message);
        }
        return;
      }

      if (!data.user) {
        setError('Login failed. Please try again.');
        return;
      }

      // Check admin status — profiles_private for is_admin, profiles for role
      const { data: privData } = await supabase
        .from('profiles_private')
        .select('is_admin')
        .eq('id', data.user.id)
        .maybeSingle();
      const { data: pubData } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', data.user.id)
        .maybeSingle();

      const isAdmin = privData?.is_admin === true || pubData?.role === 'admin';

      if (!isAdmin) {
        // Not an admin — sign out and show error
        await supabase.auth.signOut().catch(() => {});
        clearSupabaseAuthStorage();
        setError('Access denied. This account does not have admin privileges.');
        return;
      }

      // Real-time redirect happens via onAuthStateChange in AdminAuthGuard (< 1 sec)
      navigate('/admin', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0F172A] flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-3 mb-4">
            <BrandLogo variant="full" theme="inverse" className="h-12 w-auto" />
            <div className="text-left">
              <span className="text-[10px] uppercase tracking-widest text-emerald-400 font-bold">Admin Panel</span>
            </div>
          </div>
          <p className="text-slate-400 text-sm">Restricted Access — Authorized Personnel Only</p>
        </div>

        {/* Login Form */}
        <form 
          onSubmit={handleLogin}
          className="p-8 rounded-[2rem]"
          style={{ background: '#1E293B', border: '1px solid rgba(255,255,255,0.05)' }}
        >
          <div className="flex items-center gap-3 mb-6">
            <div className="h-10 w-10 rounded-xl bg-emerald-500/10 flex items-center justify-center">
              <Shield className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">Admin Login</h2>
              <p className="text-xs text-slate-500">Sign in with your admin account</p>
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
              <p className="text-xs text-red-400">{error}</p>
            </div>
          )}

          {/* Email */}
          <div className="mb-4">
            <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">
              Admin Email
            </label>
            <input                type="email"
                aria-label="Admin email"
                value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="your admin email"
              autoFocus
              className="w-full px-4 py-3 bg-slate-800/50 border border-white/5 rounded-xl text-sm text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all"
            />
          </div>

          {/* Password */}
          <div className="mb-6">
            <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">
              Password
            </label>
            <div className="relative">
              <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input
                type={showPassword ? 'text' : 'password'}
                aria-label="Admin password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Enter your admin password"
                className="w-full pl-11 pr-11 py-3 bg-slate-800/50 border border-white/5 rounded-xl text-sm text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold rounded-xl text-sm transition-all flex items-center justify-center gap-2"
          >
            {loading ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Signing in...</>
            ) : (
              <><Lock className="w-4 h-4" /> Access Admin Panel</>
            )}
          </button>

        </form>

        {/* Footer */}
        <p className="text-center mt-6 text-[10px] text-slate-600">
          Unauthorized access is prohibited and may result in legal action.
        </p>
      </div>
    </div>
  );
}
