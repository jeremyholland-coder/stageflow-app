import React, { useState } from 'react';
import { X, Mail, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';

export const ForgotPasswordModal = ({ isOpen, onClose }) => {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email) {
      setError('Please enter your email address');
      return;
    }

    setLoading(true);
    setError('');
    setMessage('');

    try {
      // SECURITY FIX (2025-11-19): Use backend endpoint instead of client-side Supabase
      // This provides rate limiting, validation, and audit logging
      const response = await fetch('/.netlify/functions/auth-request-password-reset', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include', // Include cookies for CSRF protection
        body: JSON.stringify({ email })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to send reset email');
      }

      // APPLE-LEVEL FIX #10: Don't auto-close, let user dismiss manually
      setMessage('Check your email for the password reset link!');
    } catch (error) {
      setError(error.message || 'Failed to send reset email');
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
          <h2 className="text-2xl font-bold text-white">Reset Password</h2>
          <button
            onClick={onClose}
            className="min-w-touch min-h-touch flex items-center justify-center text-gray-300 hover:text-white rounded-lg transition"
            aria-label="Close modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <p className="text-gray-300 mb-6">
          Enter your email address and we'll send you a link to reset your password.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="reset-email" className="block text-sm font-medium text-white mb-2">
              Email Address
            </label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-300" />
              <input
                id="reset-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="your@email.com"
                className="w-full pl-10 pr-4 py-3 bg-gray-800/50 border border-gray-700 rounded-xl text-white placeholder-gray-400 focus:ring-2 focus:ring-teal-500 focus:border-transparent transition"
                disabled={loading}
                aria-invalid={error ? 'true' : 'false'}
                aria-describedby={error ? 'reset-email-error' : (message ? 'reset-email-success' : undefined)}
              />
            </div>
          </div>

          {error && (
            <div
              id="reset-email-error"
              role="alert"
              className="bg-red-500/10 border border-red-500/30 text-red-400 rounded-xl p-3 text-sm"
            >
              {error}
            </div>
          )}

          {message && (
            <div
              id="reset-email-success"
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
              disabled={loading}
              className="flex-1 bg-teal-500 hover:bg-teal-600 text-white px-4 py-3 rounded-xl font-semibold transition disabled:opacity-50 flex items-center justify-center gap-2 min-h-touch shadow-lg shadow-teal-500/20 hover:shadow-teal-500/40 hover:scale-[1.02] active:scale-[0.98]"
            >
              {loading ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Sending...
                </>
              ) : (
                'Send Reset Link'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
