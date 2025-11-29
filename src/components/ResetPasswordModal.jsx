import React, { useState } from 'react';
import { X, Lock, Loader2, Eye, EyeOff } from 'lucide-react';
import { PasswordRequirements } from './PasswordInput';

export const ResetPasswordModal = ({ isOpen, onClose, session, onSuccess }) => {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();

    // Validate passwords
    if (!newPassword || newPassword.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }

    // Check password requirements
    const hasUpperCase = /[A-Z]/.test(newPassword);
    const hasLowerCase = /[a-z]/.test(newPassword);
    const hasNumber = /[0-9]/.test(newPassword);
    const hasSpecialChar = /[^A-Za-z0-9]/.test(newPassword);

    if (!hasUpperCase || !hasLowerCase || !hasNumber || !hasSpecialChar) {
      setError('Password must contain uppercase, lowercase, number, and special character');
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    // Validate session - tokens may be in session.session (from exchangeData) or directly on session
    const accessToken = session?.session?.access_token || session?.access_token;
    const refreshToken = session?.session?.refresh_token || session?.refresh_token;

    if (!session || !accessToken) {
      console.error('[Password Reset] Invalid session structure:', {
        hasSession: !!session,
        hasNestedSession: !!session?.session,
        hasDirectAccessToken: !!session?.access_token,
        hasNestedAccessToken: !!session?.session?.access_token
      });
      setError('Auth session missing! Please click the reset link again.');
      return;
    }

    // Debug logging to confirm we have both tokens
    console.warn('[Password Reset] Tokens found:', {
      hasAccessToken: !!accessToken,
      hasRefreshToken: !!refreshToken,
      accessTokenLength: accessToken?.length,
      refreshTokenLength: refreshToken?.length
    });

    setLoading(true);
    setError('');
    setMessage('');

    try {
      const response = await fetch('/.netlify/functions/auth-reset-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify({
          newPassword,
          // Use pre-validated tokens from above
          accessToken,
          refreshToken
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to reset password');
      }

      // ✅ CRITICAL FIX: Backend returned fresh user data and set HttpOnly cookies
      // NO reload needed - immediately update app context and log user in

      // SF-AUTH-001 FIX: Handle both autoLogin=true and autoLogin=false cases
      if (data.autoLogin === false) {
        // Backend couldn't verify new password - warn user and redirect to login
        setMessage('Password updated! Please log in with your new password.');
        console.warn('[Password Reset] autoLogin=false - user must log in manually');
        setTimeout(() => {
          onClose();
          // Clear any stale auth state and redirect to login
          window.location.href = '/?message=password_reset_success';
        }, 2000);
        return;
      }

      // SUCCESS with autoLogin: Cookies are set, log user in immediately
      setMessage('Password updated successfully! Loading your workspace...');

      // INSTANT LOGIN: Call onSuccess with fresh user data from backend
      // This updates App context immediately - NO page reload!
      if (onSuccess && data.user) {
        // Give user brief moment to see success message
        setTimeout(() => {
          onSuccess(data.user);
          onClose();
        }, 800);
      } else {
        // Fallback: if onSuccess not provided or no user data, reload
        // Backend set cookies, so reload should pick up the session
        console.warn('[Password Reset] No onSuccess handler or user data, reloading page');
        setTimeout(() => {
          onClose();
          window.location.reload();
        }, 1500);
      }
    } catch (error) {
      setError(error.message || 'Failed to reset password');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/95 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fadeIn">
      <div
        className="bg-gradient-to-br from-gray-900 to-black border border-teal-500/30 rounded-2xl p-4 sm:p-8 max-w-md w-full shadow-2xl overflow-y-auto animate-slideUp"
        onClick={(e) => e.stopPropagation()}
        style={{
          maxHeight: '90vh',
          paddingBottom: 'max(env(safe-area-inset-bottom, 16px), 16px)'
        }}
      >
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold text-white">Set New Password</h2>
          <button
            onClick={onClose}
            className="min-w-touch min-h-touch flex items-center justify-center text-gray-300 hover:text-white rounded-lg transition"
            aria-label="Close modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <p className="text-gray-300 mb-6">
          Enter your new password below. Make sure it's strong and secure.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* New Password */}
          <div>
            <label htmlFor="new-password" className="block text-sm font-medium text-white mb-2">
              New Password
            </label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-300" />
              <input
                id="new-password"
                type={showPassword ? "text" : "password"}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Enter new password"
                className="w-full pl-10 pr-12 py-3 bg-gray-800/50 border border-gray-700 rounded-xl text-white placeholder-gray-400 focus:ring-2 focus:ring-teal-500 focus:border-transparent transition"
                disabled={loading}
                autoComplete="new-password"
                aria-invalid={error ? 'true' : 'false'}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-300 hover:text-white transition w-11 h-11 flex items-center justify-center rounded-lg"
                aria-label={showPassword ? "Hide password" : "Show password"}
                tabIndex={-1}
              >
                {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
          </div>

          {/* Confirm Password */}
          <div>
            <label htmlFor="confirm-password" className="block text-sm font-medium text-white mb-2">
              Confirm Password
            </label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-300" />
              <input
                id="confirm-password"
                type={showConfirmPassword ? "text" : "password"}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm new password"
                className="w-full pl-10 pr-12 py-3 bg-gray-800/50 border border-gray-700 rounded-xl text-white placeholder-gray-400 focus:ring-2 focus:ring-teal-500 focus:border-transparent transition"
                disabled={loading}
                autoComplete="new-password"
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-300 hover:text-white transition w-11 h-11 flex items-center justify-center rounded-lg"
                aria-label={showConfirmPassword ? "Hide password" : "Show password"}
                tabIndex={-1}
              >
                {showConfirmPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
          </div>

          {/* Password Requirements */}
          {newPassword && (
            <div className="mt-3">
              <PasswordRequirements password={newPassword} />
            </div>
          )}

          {error && (
            <div
              role="alert"
              className="bg-red-500/10 border border-red-500/30 text-red-400 rounded-xl p-3 text-sm"
            >
              {error}
            </div>
          )}

          {message && (
            <div
              role="status"
              aria-live="polite"
              className="bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 rounded-xl p-3 text-sm"
            >
              {message}
            </div>
          )}

          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-3 border border-gray-700 text-gray-300 hover:text-white rounded-xl hover:bg-gray-800/50 transition min-h-touch"
              disabled={loading}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !newPassword || !confirmPassword}
              title={loading ? "Updating your password..." : !newPassword || !confirmPassword ? "Enter and confirm your new password" : "Update your password"}
              className="flex-1 bg-teal-500 hover:bg-teal-600 text-white px-4 py-3 rounded-xl font-semibold transition disabled:opacity-50 flex items-center justify-center gap-2 min-h-touch shadow-lg shadow-teal-500/20 hover:shadow-teal-500/40 hover:scale-[1.02] active:scale-[0.98]"
            >
              {loading ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Updating...
                </>
              ) : (
                'Update Password'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
