import { createClient } from '@supabase/supabase-js';
import { createRateLimitedClient } from './rate-limited-supabase';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

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
}

// CRITICAL: Export a Proxy that lazily initializes on first property access
// This prevents createClient() from running at module level
export const supabase = new Proxy({}, {
  get(target, prop) {
    const client = getSupabaseClient();

    // Return undefined if client failed to initialize
    if (!client) {
      console.error(`[Supabase] Cannot access '${String(prop)}' - client not initialized`);
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
