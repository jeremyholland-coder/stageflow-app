/**
 * Cookie-Based Authentication Module
 *
 * PURPOSE:
 * Replaces localStorage authentication with secure HttpOnly cookie authentication.
 * Provides login, logout, session management, and automatic token refresh.
 *
 * SECURITY:
 * - No localStorage access (prevents XSS token theft)
 * - HttpOnly cookies (server-side only)
 * - Automatic session refresh (before 1-hour expiration)
 * - CSRF protection (SameSite=Strict)
 *
 * USAGE:
 * import { login, logout, getCurrentUser, setupAutoRefresh } from './lib/auth';
 */

/**
 * Login with email and password
 *
 * @param {string} email - User email
 * @param {string} password - User password
 * @returns {Promise<{user: Object, session: Object}>}
 * @throws {Error} If login fails
 */
export async function login(email, password) {
  try {
    const response = await fetch('/.netlify/functions/auth-login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      credentials: 'include', // CRITICAL: Include cookies in request/response
      body: JSON.stringify({ email, password })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || data.message || 'Login failed');
    }

    return data;

  } catch (error) {
    console.error('Login error:', error);
    throw error;
  }
}

/**
 * Logout and clear session
 *
 * @returns {Promise<void>}
 */
export async function logout() {
  try {
    await fetch('/.netlify/functions/auth-logout', {
      method: 'POST',
      credentials: 'include' // Include cookies to identify session
    });

    // Redirect to login page
    window.location.href = '/login';

  } catch (error) {
    console.error('Logout error:', error);
    // Even if logout fails server-side, redirect to login
    window.location.href = '/login';
  }
}

/**
 * Get current authenticated user
 *
 * Validates session using HttpOnly cookies (automatic).
 * No localStorage access needed.
 *
 * @returns {Promise<Object|null>} User object or null if not authenticated
 */
export async function getCurrentUser() {
  try {
    // For Phase 2 transition: Use existing supabase.auth.getUser()
    // This will read from cookies via updated auth-middleware
    const { supabase } = await import('./supabase.js');

    const { data: { user }, error } = await supabase.auth.getUser();

    if (error || !user) {
      return null;
    }

    return user;

  } catch (error) {
    console.error('Get current user error:', error);
    return null;
  }
}

/**
 * Refresh session using refresh token
 *
 * Called automatically before access token expires (every 55 minutes).
 * Uses refresh token from HttpOnly cookie.
 *
 * @returns {Promise<{user: Object, session: Object}|null>}
 */
export async function refreshSession() {
  try {
    const response = await fetch('/.netlify/functions/auth-refresh', {
      method: 'POST',
      credentials: 'include' // Include refresh token cookie
    });

    if (!response.ok) {
      // CRITICAL FIX: Don't force redirect on background refresh failure
      // This prevents reload loop when user returns after >1 hour
      console.error('[Auth] Session refresh failed - tokens likely expired');
      console.error('[Auth] User will need to re-authenticate on next action');
      return null;
    }

    const data = await response.json();
    return data;

  } catch (error) {
    console.error('[Auth] Session refresh error:', error);
    // CRITICAL FIX: Don't force redirect on network errors
    // Silent failure - user can continue working with cached data
    return null;
  }
}

/**
 * Setup automatic session refresh
 *
 * Refreshes session every 55 minutes (before 1-hour expiration).
 * Should be called once after successful login.
 *
 * @returns {number} Interval ID (for cleanup)
 */
export function setupAutoRefresh() {
  // Refresh every 55 minutes (tokens expire in 1 hour)
  const intervalId = setInterval(async () => {
    console.warn('[Auth] Auto-refreshing session...');
    await refreshSession();
  }, 55 * 60 * 1000);

  // Cleanup on page unload
  window.addEventListener('beforeunload', () => {
    clearInterval(intervalId);
  });

  return intervalId;
}

/**
 * Check if user is authenticated
 *
 * @returns {Promise<boolean>}
 */
export async function isAuthenticated() {
  const user = await getCurrentUser();
  return !!user;
}

/**
 * Sign up new user with email and password
 *
 * @param {string} email
 * @param {string} password
 * @param {Object} metadata - Additional user metadata
 * @returns {Promise<{user: Object, session: Object}>}
 */
export async function signUp(email, password, metadata = {}) {
  try {
    const response = await fetch('/.netlify/functions/auth-signup', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      credentials: 'include', // CRITICAL: Include cookies for session
      body: JSON.stringify({ email, password, metadata })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || data.message || 'Sign up failed');
    }

    return data;

  } catch (error) {
    console.error('Sign up error:', error);
    throw error;
  }
}

/**
 * Request password reset email
 *
 * @param {string} email
 * @returns {Promise<void>}
 */
export async function resetPassword(email) {
  try {
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
      throw new Error(data.error || data.message || 'Password reset failed');
    }

  } catch (error) {
    console.error('Password reset error:', error);
    throw error;
  }
}

/**
 * Update user password
 *
 * @param {string} newPassword
 * @returns {Promise<void>}
 */
export async function updatePassword(newPassword) {
  try {
    const { supabase } = await import('./supabase.js');

    const { error } = await supabase.auth.updateUser({
      password: newPassword
    });

    if (error) {
      throw error;
    }

  } catch (error) {
    console.error('Password update error:', error);
    throw error;
  }
}

/**
 * APPLE-LEVEL FIX #7: Shared utility for resending verification email
 *
 * Sends a verification email with 5-second timeout protection.
 * Rate limiting should be handled by the caller.
 *
 * @param {string} email - User's email address
 * @returns {Promise<{emailId: string}>} Email result with ID
 * @throws {Error} If email sending fails or times out
 */
export async function sendVerificationEmail(email) {
  if (!email) {
    throw new Error('Email is required');
  }

  // Add 5-second timeout to prevent infinite loading on email service issues
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);

  try {
    // Use our custom function for reliable delivery
    const emailResponse = await fetch('/.netlify/functions/generate-confirmation-link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include', // Include HttpOnly auth cookies
      body: JSON.stringify({
        email,
        type: 'signup'
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);
    const emailResult = await emailResponse.json();

    if (!emailResponse.ok) {
      throw new Error(emailResult.details || 'Failed to send verification email');
    }

    return emailResult;

  } catch (error) {
    clearTimeout(timeoutId);

    // Enhance error message for timeout
    if (error.name === 'AbortError') {
      throw new Error('Request timed out. Please check your connection and try again.');
    }

    throw error;
  }
}
