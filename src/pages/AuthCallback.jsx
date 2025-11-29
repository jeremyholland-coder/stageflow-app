import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, AlertCircle, CheckCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';

/**
 * OAuth Callback Handler
 *
 * Handles the redirect back from OAuth providers (Google, etc.)
 * CRITICAL FIX: Now exchanges tokens for HttpOnly cookies via backend
 * This ensures backend functions can authenticate the user
 */
export const AuthCallback = () => {
  const navigate = useNavigate();
  const [status, setStatus] = useState('processing'); // processing | success | error
  const [message, setMessage] = useState('Completing sign in...');
  const [error, setError] = useState(null);

  useEffect(() => {
    const handleOAuthCallback = async () => {
      try {
        // Get the auth code from URL hash (Supabase OAuth uses hash, not query params)
        const hashParams = new URLSearchParams(window.location.hash.substring(1));
        const accessToken = hashParams.get('access_token');
        const refreshToken = hashParams.get('refresh_token');
        const errorParam = hashParams.get('error');
        const errorDescription = hashParams.get('error_description');

        if (errorParam) {
          throw new Error(errorDescription || `OAuth error: ${errorParam}`);
        }

        if (!accessToken || !refreshToken) {
          throw new Error('No access token received from OAuth provider');
        }

        // CRITICAL FIX: Clear tokens from URL IMMEDIATELY for security
        // Prevents tokens from being captured in browser history
        window.history.replaceState(null, '', window.location.pathname);

        // CRITICAL FIX: Exchange tokens for HttpOnly cookies via backend
        // This is REQUIRED for backend functions (checkout, AI, etc.) to work
        // Without this, Google OAuth users can't make any authenticated backend calls
        const exchangeResponse = await fetch('/.netlify/functions/auth-exchange-token', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          credentials: 'include', // Critical: allows setting cookies
          body: JSON.stringify({
            access_token: accessToken,
            refresh_token: refreshToken
          })
        });

        const exchangeData = await exchangeResponse.json();

        if (!exchangeResponse.ok) {
          throw new Error(exchangeData.error || 'Token exchange failed');
        }

        if (!exchangeData.session || !exchangeData.session.access_token) {
          throw new Error('Token exchange returned invalid session data');
        }

        // CRITICAL FIX: Also set session in Supabase client for direct DB calls
        // The HttpOnly cookies handle backend calls, but direct Supabase calls
        // (like real-time subscriptions) need the client session too
        await supabase.auth.setSession({
          access_token: exchangeData.session.access_token,
          refresh_token: exchangeData.session.refresh_token,
        });

        // Wait briefly for session to propagate through client internals
        await new Promise(resolve => setTimeout(resolve, 50));

        setStatus('success');
        setMessage('Sign in successful! Redirecting...');

        // Wait a moment for user to see success message
        setTimeout(() => {
          // Redirect to main app
          window.location.href = '/';
        }, 1500);

      } catch (err) {
        console.error('[OAuth Callback] Error:', err);
        setStatus('error');
        setError(err.message || 'Authentication failed');
        setMessage('Authentication failed');

        // Redirect to login page after error
        setTimeout(() => {
          window.location.href = '/';
        }, 3000);
      }
    };

    handleOAuthCallback();
  }, [navigate]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 to-black flex items-center justify-center p-4">
      <div className="bg-gray-800/50 border border-teal-500/30 rounded-2xl p-8 max-w-md w-full text-center">
        {status === 'processing' && (
          <>
            <Loader2 className="w-12 h-12 text-teal-500 animate-spin mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-white mb-2">
              Completing Sign In
            </h2>
            <p className="text-gray-400">{message}</p>
          </>
        )}

        {status === 'success' && (
          <>
            <CheckCircle className="w-12 h-12 text-emerald-500 mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-white mb-2">
              Success!
            </h2>
            <p className="text-gray-400">{message}</p>
          </>
        )}

        {status === 'error' && (
          <>
            <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-white mb-2">
              Authentication Failed
            </h2>
            <p className="text-red-400 mb-4">{error}</p>
            <p className="text-gray-400 text-sm">Redirecting to login...</p>
          </>
        )}
      </div>
    </div>
  );
};

export default AuthCallback;
