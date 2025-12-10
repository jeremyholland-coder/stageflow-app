import { createClient } from '@supabase/supabase-js';
import { createRateLimitedClient } from './rate-limited-supabase';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

// H6-B HARDENING 2025-12-04: Multi-Tab Session Consistency via BroadcastChannel
// When a user logs out or session expires in one tab, all other tabs are notified
// This prevents stale auth state from causing confusing errors in background tabs
const AUTH_CHANNEL_NAME = 'stageflow-auth-channel';
let _authBroadcastChannel = null;

/**
 * Get or create the auth broadcast channel
 * Safe for SSR - returns null if BroadcastChannel is not available
 */
function getAuthChannel() {
  if (_authBroadcastChannel) return _authBroadcastChannel;

  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') {
    return null;
  }

  try {
    _authBroadcastChannel = new BroadcastChannel(AUTH_CHANNEL_NAME);

    // Listen for auth events from other tabs
    _authBroadcastChannel.onmessage = (event) => {
      const { type, timestamp } = event.data || {};
      console.log(`[Auth] Received cross-tab message: ${type}`);

      if (type === 'SIGNED_OUT') {
        // Another tab signed out - redirect this tab to login
        console.warn('[Auth] Another tab signed out - redirecting to login');
        // Use replace to prevent back button returning to a broken state
        // Small delay to allow any in-flight operations to complete
        setTimeout(() => {
          window.location.replace('/login');
        }, 100);
      } else if (type === 'SESSION_INVALID') {
        // Another tab detected invalid session - redirect this tab
        console.warn('[Auth] Another tab detected invalid session - redirecting');
        setTimeout(() => {
          window.location.replace('/login');
        }, 100);
      }
    };

    console.log('[Auth] BroadcastChannel initialized for multi-tab session sync');
  } catch (e) {
    console.warn('[Auth] BroadcastChannel not available:', e.message);
    return null;
  }

  return _authBroadcastChannel;
}

/**
 * Broadcast an auth event to all other tabs
 */
function broadcastAuthEvent(type) {
  const channel = getAuthChannel();
  if (channel) {
    try {
      channel.postMessage({ type, timestamp: Date.now() });
      console.log(`[Auth] Broadcasted ${type} to other tabs`);
    } catch (e) {
      console.warn('[Auth] Failed to broadcast:', e.message);
    }
  }
}

// Initialize channel on module load (lazy - only when accessed)
if (typeof window !== 'undefined') {
  // Defer initialization to avoid blocking initial load
  setTimeout(() => getAuthChannel(), 100);
}

// PHASE 3: Cookie-based authentication (localStorage removed)
// MIGRATION COMPLETE: All authentication now uses HttpOnly cookies
//
// Benefits:
// - XSS Protection: JavaScript cannot access tokens
// - CSRF Protection: SameSite=Strict prevents cross-site attacks
// - Auto-refresh: 55-minute refresh cycle prevents expiration
// - Server-side: Session management handled by backend
//
// No localStorage storage needed - cookies handled automatically by browser

// Lazy client initialization - deferred until first access
let _supabaseClient = null;
let _initializationAttempted = false;

function getSupabaseClient() {
  // Return cached client if already initialized
  if (_supabaseClient) return _supabaseClient;

  // Prevent multiple initialization attempts on failure
  if (_initializationAttempted) return null;
  _initializationAttempted = true;

  // Validate environment variables
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.error('[Supabase] Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY');
    return null;
  }

  // Ensure window exists (SSR safety)
  if (typeof window === 'undefined') {
    console.warn('[Supabase] Cannot initialize in SSR context');
    return null;
  }

  // P0 FIX 2025-12-10: Wrap client creation in try-catch
  // If createClient or createRateLimitedClient throws, the error was unhandled
  // and all subsequent Supabase calls would fail silently (returning undefined)
  try {
    // NOW it's safe to create the client (after all checks pass)
    console.error('[Supabase] Initializing client (lazy)'); // Using console.error for production diagnostics

    // PHASE 3: No localStorage storage - authentication via HttpOnly cookies
    // Auth handled by backend endpoints (/auth-login, /auth-logout, /auth-refresh)
    const rawClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        autoRefreshToken: false, // Handled by backend auto-refresh
        persistSession: false, // Cookies persist session automatically
        detectSessionInUrl: true, // Still detect OAuth redirects
        storageKey: 'stageflow-auth' // Kept for compatibility with OAuth flows
      }
    });

    // SECURITY FIX: Wrap client with rate limiter to prevent quota exhaustion
    // Limits: 10 requests/second, burst of 20 requests
    // This prevents frontend from exhausting Supabase Pro's 200 connection limit
    _supabaseClient = createRateLimitedClient(rawClient, {
      tokensPerSecond: 10,  // 10 requests/second (600/minute)
      burstSize: 20         // Allow burst traffic without queuing
    });

    return _supabaseClient;
  } catch (err) {
    console.error('[Supabase] Client initialization failed:', err);
    // P0 FIX: Allow retry on next access by resetting the flag
    _initializationAttempted = false;
    return null;
  }
}

// P0 FIX 2025-12-10: Safe no-op stub that returns chainable methods
// This prevents "Cannot read property 'select' of undefined" crashes
// when Supabase client fails to initialize
const NOOP_STUB = {
  select: () => Promise.resolve({ data: null, error: new Error('Supabase client not initialized') }),
  insert: () => Promise.resolve({ data: null, error: new Error('Supabase client not initialized') }),
  update: () => Promise.resolve({ data: null, error: new Error('Supabase client not initialized') }),
  delete: () => Promise.resolve({ data: null, error: new Error('Supabase client not initialized') }),
  eq: () => NOOP_STUB,
  neq: () => NOOP_STUB,
  in: () => NOOP_STUB,
  is: () => NOOP_STUB,
  order: () => NOOP_STUB,
  limit: () => NOOP_STUB,
  single: () => Promise.resolve({ data: null, error: new Error('Supabase client not initialized') }),
  maybeSingle: () => Promise.resolve({ data: null, error: new Error('Supabase client not initialized') }),
  then: (resolve) => resolve({ data: null, error: new Error('Supabase client not initialized') }),
};

// CRITICAL: Export a Proxy that lazily initializes on first property access
// This prevents createClient() from running at module level
export const supabase = new Proxy({}, {
  get(target, prop) {
    const client = getSupabaseClient();

    // P0 FIX 2025-12-10: Return safe stub instead of undefined
    // This prevents crashes when hooks call supabase.from().select()
    if (!client) {
      console.error(`[Supabase] Cannot access '${String(prop)}' - client not initialized`);
      // For 'from' method, return a function that returns the safe stub
      if (prop === 'from') {
        return () => NOOP_STUB;
      }
      // For 'auth' property, return a safe auth stub
      if (prop === 'auth') {
        return {
          getSession: () => Promise.resolve({ data: { session: null }, error: new Error('Client not initialized') }),
          setSession: () => Promise.resolve({ data: { session: null }, error: new Error('Client not initialized') }),
          signOut: () => Promise.resolve({ error: new Error('Client not initialized') }),
          onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
        };
      }
      return undefined;
    }

    const value = client[prop];

    // If it's a method, bind it to the client context
    if (typeof value === 'function') {
      return value.bind(client);
    }

    return value;
  },

  // Support 'supabase in obj' checks
  has(target, prop) {
    const client = getSupabaseClient();
    return client ? prop in client : false;
  }
});

// DEVELOPMENT: Expose supabase to window for console debugging/testing
if (typeof window !== 'undefined' && supabase) {
  window.supabase = supabase;
}

// App constants
export const STORAGE_KEY = 'stageflow_preferences';
export const VIEWS = {
  DASHBOARD: 'dashboard',
  ANALYTICS: 'analytics',
  SETTINGS: 'settings',
  TEAM: 'team',
  INTEGRATIONS: 'integrations',
  REPORTS: 'reports'
};

/**
 * FIX 2025-12-03: Handle invalid session by signing out and redirecting to login
 *
 * Call this when SESSION_ERROR is detected to cleanly log the user out
 * and redirect them to the login page. This prevents cascading auth failures.
 */
export async function handleSessionInvalid() {
  console.warn('[Auth] handleSessionInvalid called - signing out and redirecting');

  // H6-B HARDENING 2025-12-04: Notify other tabs that session is invalid
  // This ensures all tabs redirect together, preventing stale-auth confusion
  broadcastAuthEvent('SESSION_INVALID');

  try {
    // Sign out from Supabase client (clears any local state)
    const client = getSupabaseClient();
    if (client) {
      await client.auth.signOut();
    }
  } catch (e) {
    console.warn('[Auth] Error during signOut:', e.message);
  }

  // Clear auth-related cookies via auth-logout endpoint
  try {
    await fetch('/.netlify/functions/auth-logout', {
      method: 'POST',
      credentials: 'include'
    });
  } catch (e) {
    console.warn('[Auth] Error calling auth-logout:', e.message);
  }

  // Redirect to login page
  // Use replace to prevent back button from returning to a broken state
  window.location.replace('/login');
}

/**
 * Get current session (uses Supabase native method)
 * @returns {Promise<{session: Object|null, error: Error|null}>}
 */
export const getSession = async () => {
  if (!supabase) {
    return { session: null, error: new Error('Supabase not initialized') };
  }

  try {
    const { data: { session }, error } = await supabase.auth.getSession();
    return { session, error };
  } catch (error) {
    console.error('[Auth] Session fetch failed:', error);
    return { session: null, error };
  }
};

/**
 * Get current user (convenience method)
 * @returns {Promise<Object|null>}
 */
export const getUser = async () => {
  const { session } = await getSession();
  return session?.user || null;
};

/**
 * Check if user is authenticated
 * @returns {Promise<boolean>}
 */
export const isAuthenticated = async () => {
  const { session } = await getSession();
  return !!session;
};

/**
 * Sign out user
 * @returns {Promise<{error: Error|null}>}
 */
export const signOut = async () => {
  if (!supabase) {
    return { error: new Error('Supabase not initialized') };
  }

  try {
    // H6-B HARDENING 2025-12-04: Notify other tabs before signing out
    // This ensures all tabs sign out together
    broadcastAuthEvent('SIGNED_OUT');

    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    return { error: null };
  } catch (error) {
    console.error('❌ [Auth] Sign out error:', error);
    return { error };
  }
};

/**
 * Helper to ensure auth before operations
 * @param {Function} operation - Async operation to execute
 * @returns {Promise<any>}
 */
export const withAuth = async (operation) => {
  const { session, error } = await getSession();

  if (error || !session?.user) {
    throw new Error(error?.message || 'Not authenticated');
  }

  return await operation(session.user);
};

/**
 * FIX 2025-12-03: Bootstrap session on app initialization
 *
 * Call this ONCE when the app loads to ensure the Supabase client has a valid
 * session from cookies. This prevents the catch-22 where:
 * - No session in memory after page refresh
 * - ensureValidSession tries to call auth-session
 * - auth-session needs cookies OR Authorization header
 * - Neither exists → 401
 *
 * @returns {Promise<boolean>} true if session was bootstrapped successfully
 */
let _bootstrapPromise = null;
let _isBootstrapped = false;

export const bootstrapSession = async () => {
  // Only bootstrap once
  if (_isBootstrapped) {
    return true;
  }

  // Prevent concurrent bootstrap attempts
  if (_bootstrapPromise) {
    return _bootstrapPromise;
  }

  _bootstrapPromise = (async () => {
    try {
      console.log('[Session] Bootstrapping session from cookies...');

      // Check if we already have a session
      const { data: { session: existingSession } } = await supabase.auth.getSession();
      if (existingSession?.access_token) {
        console.log('[Session] ✓ Session already exists in memory');
        _isBootstrapped = true;
        return true;
      }

      // Try to get session from auth-session endpoint (uses cookies)
      const response = await fetch('/.netlify/functions/auth-session', {
        method: 'GET',
        credentials: 'include',
        headers: { 'Cache-Control': 'no-cache' }
      });

      if (!response.ok) {
        console.warn('[Session] Bootstrap failed - no valid session:', response.status);
        // Not an error - user just isn't logged in
        return false;
      }

      const data = await response.json();

      if (data.session?.access_token) {
        await supabase.auth.setSession({
          access_token: data.session.access_token,
          refresh_token: data.session.refresh_token
        });
        console.log('[Session] ✓ Session bootstrapped from cookies');
        _isBootstrapped = true;
        return true;
      }

      return false;
    } catch (error) {
      console.warn('[Session] Bootstrap error:', error.message);
      return false;
    } finally {
      _bootstrapPromise = null;
    }
  })();

  return _bootstrapPromise;
};

/**
 * FIX 2025-12-03: Ensure valid session before RLS-protected queries
 *
 * The client has persistSession: false, so it relies on setSession() being called.
 * If the session expires or becomes stale, queries fail with RLS errors.
 * This helper checks for a valid session and refreshes from auth-session if needed.
 *
 * CRITICAL HOTFIX: Returns structured result that api-client MUST check
 * - { valid: true } - Session is valid, Authorization header can be set
 * - { valid: false, error, code } - Session invalid, caller should handle
 *
 * @returns {Promise<{valid: boolean, error: string|null, code: string|null}>}
 */
let _sessionRefreshPromise = null; // Mutex to prevent concurrent refreshes
let _lastRefreshAttempt = 0; // Throttle refresh attempts
const REFRESH_THROTTLE_MS = 2000; // Minimum 2 seconds between refresh attempts

export const ensureValidSession = async () => {
  // Check if we already have a valid session
  try {
    const { data: { session } } = await supabase.auth.getSession();

    if (session?.access_token) {
      // Session exists - check if it's about to expire (within 5 minutes)
      const expiresAt = session.expires_at;
      const now = Math.floor(Date.now() / 1000);
      const isExpiringSoon = expiresAt && (expiresAt - now) < 300;

      if (!isExpiringSoon) {
        return { valid: true, error: null, code: null };
      }
      console.log('[Session] Token expiring soon, will refresh');
    }
  } catch (e) {
    console.warn('[Session] getSession() failed:', e.message);
  }

  // H6-G HARDENING 2025-12-04: Mutex check BEFORE throttle check
  // If a refresh is already in progress, ALL callers should share that result
  // regardless of throttle timing. This ensures concurrent calls don't get THROTTLED
  // when they could share the in-flight refresh result.
  if (_sessionRefreshPromise) {
    console.log('[Session] Refresh already in progress, waiting...');
    return _sessionRefreshPromise;
  }

  // FIX 2025-12-03: Throttle refresh attempts to prevent hammering server
  // Only throttle NEW refresh attempts (not callers sharing an in-progress refresh)
  const now = Date.now();
  if (now - _lastRefreshAttempt < REFRESH_THROTTLE_MS) {
    console.log('[Session] Throttled - too soon since last refresh attempt');
    return { valid: false, error: 'Refresh throttled', code: 'THROTTLED' };
  }

  _lastRefreshAttempt = now;

  _sessionRefreshPromise = (async () => {
    try {
      console.log('[Session] Fetching session from auth-session...');

      // FIX 2025-12-03: Also send Authorization header if we have a token in memory
      // This provides fallback when cookies aren't sent (cross-origin/SameSite issues)
      const headers = {
        'Cache-Control': 'no-cache'
      };

      // Try to get existing token from Supabase client memory (if any)
      try {
        const { data: { session: existingSession } } = await supabase.auth.getSession();
        if (existingSession?.access_token) {
          headers['Authorization'] = `Bearer ${existingSession.access_token}`;
          console.log('[Session] Including Authorization header as cookie fallback');
        }
      } catch (e) {
        // Ignore - we'll still try with just cookies
      }

      const response = await fetch('/.netlify/functions/auth-session', {
        method: 'GET',
        credentials: 'include', // Send HttpOnly cookies
        headers
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.warn('[Session] auth-session returned:', response.status, errorData);

        // If retryable (SESSION_ROTATED), try auth-refresh first
        if (errorData.retryable && errorData.retryHint === 'CALL_AUTH_REFRESH_FIRST') {
          console.log('[Session] Attempting auth-refresh before retry...');
          const refreshResponse = await fetch('/.netlify/functions/auth-refresh', {
            method: 'POST',
            credentials: 'include'
          });

          if (refreshResponse.ok) {
            // Retry auth-session after refresh
            const retryResponse = await fetch('/.netlify/functions/auth-session', {
              method: 'GET',
              credentials: 'include'
            });

            if (retryResponse.ok) {
              const retryData = await retryResponse.json();
              if (retryData.session?.access_token) {
                await supabase.auth.setSession({
                  access_token: retryData.session.access_token,
                  refresh_token: retryData.session.refresh_token
                });
                console.log('[Session] ✓ Session restored after refresh');
                return { valid: true, error: null, code: null };
              }
            }
          }
        }

        // FIX 2025-12-03: Return structured error for api-client to check
        return {
          valid: false,
          error: errorData.error || 'Session validation failed',
          code: errorData.code || 'SESSION_INVALID'
        };
      }

      const data = await response.json();

      if (data.session?.access_token) {
        // Set session in client
        await supabase.auth.setSession({
          access_token: data.session.access_token,
          refresh_token: data.session.refresh_token
        });
        console.log('[Session] ✓ Session refreshed from cookies');
        return { valid: true, error: null, code: null };
      }

      // FIX 2025-12-03: Handle case where response is 200 but no session
      return { valid: false, error: 'No session in response', code: 'NO_SESSION' };

    } catch (error) {
      console.error('[Session] Refresh failed:', error);
      return { valid: false, error: error.message, code: 'REFRESH_ERROR' };
    } finally {
      _sessionRefreshPromise = null;
    }
  })();

  return _sessionRefreshPromise;
};
