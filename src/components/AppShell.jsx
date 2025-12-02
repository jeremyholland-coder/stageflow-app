import React, { useState, useCallback, useRef, useEffect } from 'react';
import { BarChart3, Moon, Sun, LogOut, Loader2, AlertCircle, User, Sparkles, RefreshCw, Menu, X, Users, Mail, Eye, EyeOff } from 'lucide-react';
import { PasswordRequirements } from './PasswordInput';
import { VIEWS, STORAGE_KEY, supabase } from '../lib/supabase';
import { Logo } from './ui/Logo';
import { StageFlowLogo } from './StageFlowLogo';
import { ErrorBoundary } from './ErrorBoundary';
import { secureFetch } from '../lib/csrf-client';
import { sendVerificationEmail } from '../lib/auth'; // APPLE-LEVEL FIX #7: Shared utility
import { ForgotPasswordModal } from './ForgotPasswordModal';
import { MobileNav } from './MobileNav';
import { FeedbackWidget } from './FeedbackWidget';
import { sanitizeText } from '../lib/sanitize';
import { pageVisibility } from '../lib/page-visibility'; // CRITICAL FIX: Import page visibility utility
import { initializeCache } from '../lib/cache-manager'; // CRITICAL FIX: Auto-clear stale caches
import { setSentryUser, clearSentryUser } from '../lib/sentry'; // Error monitoring user tracking
import LoadingOverlay from './LoadingOverlay';
import AppContext, { useApp } from '../context/AppContext';
import { logger } from '../lib/logger';
import { api } from '../lib/api-client'; // PHASE J: Auth-aware API client

// Re-export for backward compatibility
export { useApp };

export const AppProvider = ({ children }) => {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  } catch (e) {
    logger.error('[AppProvider] Failed to parse saved settings:', e);
  }
  const [user, setUser] = React.useState(null);
  const [organization, setOrganization] = React.useState(null);
  const [userRole, setUserRole] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [orgLoading, setOrgLoading] = React.useState(false);
  const [darkMode, setDarkMode] = React.useState(saved?.darkMode ?? true);
  const [activeView, setActiveView] = React.useState(VIEWS.DASHBOARD);
  const [notifications, setNotifications] = React.useState([]);
  const [avatarUrl, setAvatarUrl] = React.useState(null); // User profile avatar
  const [profileFirstName, setProfileFirstName] = React.useState(''); // User first name
  const [profileLastName, setProfileLastName] = React.useState(''); // User last name
  const [showResetPassword, setShowResetPassword] = React.useState(false); // Password reset modal
  const [resetPasswordSession, setResetPasswordSession] = React.useState(null); // Store session for password reset
  const [orgSetupRetrying, setOrgSetupRetrying] = React.useState(false); // AUTO-HEAL: Track org setup retry status
  const notificationIdRef = React.useRef(0);
  const orgRetryIntervalRef = React.useRef(null); // AUTO-HEAL: Track retry interval

  // FIX M11: Track last auth time for session management
  const lastAuthTimeRef = React.useRef(Date.now());

  // DEBUG: State change tracking (disabled for production)
  // Uncomment these only when debugging infinite loops
  /*
  React.useEffect(() => {
    logger.debug('[DEBUG] organization changed:', organization?.id, organization?.name);
  }, [organization]);

  React.useEffect(() => {
    logger.debug('[DEBUG] loading changed:', loading);
  }, [loading]);

  React.useEffect(() => {
    logger.debug('[DEBUG] orgLoading changed:', orgLoading);
  }, [orgLoading]);

  React.useEffect(() => {
    logger.debug('[DEBUG] user changed:', user?.id, user?.email);
  }, [user]);

  React.useEffect(() => {
    logger.debug('[DEBUG] activeView changed:', activeView);
  }, [activeView]);
  */

  // ARCHITECTURAL FIX: Promise-based mutex instead of boolean flag
  // This prevents race conditions by ensuring only ONE setupOrganization runs at a time
  // If called while already running, returns the existing Promise instead of starting new one
  const setupOrganizationPromise = useRef(null);
  const setupAttempts = useRef(0);
  const lastSetupAttemptTime = useRef(0);
  const MAX_SETUP_ATTEMPTS = 3;
  const SETUP_ATTEMPT_RESET_TIME = 60000; // Reset attempts after 60 seconds

  // MOBILE FIX: Detect mobile and use LONGER timeouts (mobile connections are slower)
  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  // OPT-2: PERFORMANCE FIX - Reduced timeouts for faster feedback
  // EMERGENCY FIX: Increased timeouts to prevent annoying "loading timeout" notification
  // 20s was too aggressive - users see notification even on normal loads
  // 60s gives proper time for slow networks/mobile while cache (OPT-1) keeps fast path
  const AUTH_TIMEOUT = isMobile ? 15000 : 12000; // 15s on mobile, 12s on desktop (was 8-10s)
  const ORG_SETUP_TIMEOUT = isMobile ? 20000 : 18000; // 20s on mobile, 18s on desktop (was 12-15s)
  const FAILSAFE_TIMEOUT = isMobile ? 60000 : 60000; // 60s timeout - prevent notification spam (was 20-25s)

  // Initialize cache management and log mobile detection for debugging
  React.useEffect(() => {
    // CRITICAL FIX: Clear stale caches on version change to fix deal loading issues
    const cacheCleared = initializeCache();
    if (cacheCleared) {
      logger.log('[Cache] Stale cache cleared - deals will load fresh data');
    }

    logger.log('[Mobile] Device detected:', isMobile ? 'MOBILE' : 'DESKTOP');
    logger.log('[Mobile] User Agent:', navigator.userAgent);
    logger.log('[Mobile] Timeouts:', { AUTH_TIMEOUT, ORG_SETUP_TIMEOUT, FAILSAFE_TIMEOUT });
    logger.log('[Mobile] Viewport:', window.innerWidth + 'x' + window.innerHeight);
  }, []);

  // PRODUCTION MONITORING: Track user context in Sentry
  React.useEffect(() => {
    if (user) {
      setSentryUser(user);
    } else {
      clearSentryUser();
    }
  }, [user]);

  // MEDIUM FIX: Track notification timeouts for cleanup to prevent memory leaks
  const notificationTimeoutsRef = useRef(new Map());

  // v1.7.54: Dynamic notification timeout based on message length (Apple UX pattern)
  const getNotificationTimeout = useCallback((message) => {
    const baseTime = 5000; // 5 seconds minimum
    const wordsPerSecond = 3; // Average reading speed
    const words = message.split(' ').length;
    const readingTime = (words / wordsPerSecond) * 1000;
    return Math.max(baseTime, Math.min(readingTime, 10000)); // 5-10s range
  }, []);

  const addNotification = useCallback((msg, type = 'success') => {
    const id = notificationIdRef.current++;
    setNotifications(prev => [...prev, { id, message: msg, type }]);

    // v1.7.54: Use dynamic timeout based on message length
    const timeout = getNotificationTimeout(msg);

    // CRITICAL FIX: Store timeout ID for cleanup
    const timeoutId = setTimeout(() => {
      setNotifications(prev => prev.filter(x => x.id !== id));
      notificationTimeoutsRef.current.delete(id);
    }, timeout);

    notificationTimeoutsRef.current.set(id, timeoutId);
  }, [getNotificationTimeout]);

  // Remove notification by ID (for explicit dismiss)
  const removeNotification = useCallback((id) => {
    // Clear any pending auto-dismiss timeout
    const timeoutId = notificationTimeoutsRef.current.get(id);
    if (timeoutId) {
      clearTimeout(timeoutId);
      notificationTimeoutsRef.current.delete(id);
    }
    setNotifications(prev => prev.filter(n => n.id !== id));
  }, []);

  // FIX HOOKS: Use useRef for addNotification to prevent dependency changes
  const addNotificationRef = useRef(addNotification);
  useEffect(() => {
    addNotificationRef.current = addNotification;
  }, [addNotification]);

  const setupOrganization = useCallback(async (user) => {
    if (!user) {
      logger.log('[Setup] Skipped - no user provided');
      return null;
    }

    logger.log('[Setup] Starting organization setup for user:', user.email);

    // CRITICAL FIX: Skip expensive operations when page is hidden (workspace switching)
    // This is the FINAL optimization for eliminating 5-second delay
    if (!pageVisibility.isVisible()) {
      logger.log('[Setup] Page hidden, checking cache only');
      // Return cached data if available, otherwise null
      const cachedOrg = localStorage.getItem(`stageflow_org_${user.id}`);
      if (cachedOrg) {
        try {
          const parsed = JSON.parse(cachedOrg);
          if (parsed.timestamp && Date.now() - parsed.timestamp < 5 * 60 * 1000) {
            logger.log('[Setup] Using cached organization (page hidden)');
            return { organization: parsed.organization, role: parsed.role };
          }
        } catch (e) {
          logger.error('[Setup] Failed to parse cached org:', e);
        }
      }
      logger.log('[Setup] No valid cache (page hidden)');
      return null;
    }

    // ARCHITECTURAL FIX: Promise-based mutex (truly atomic)
    // If setup is already running, return the existing Promise
    // This prevents ALL race conditions - multiple callers get same result
    if (setupOrganizationPromise.current) {
      logger.log('[Setup] Already running, returning existing promise');
      return setupOrganizationPromise.current;
    }

    // SURGICAL FIX: Removed expensive cache validation query (saves 3-10s on every load)
    // Previous code validated cache with DB query before using it - defeats cache purpose
    // Now: Trust cache timestamp, validate data structure, clear if corrupt
    let cachedOrgValidated = false;
    try {
      const cachedOrg = localStorage.getItem(`stageflow_org_${user.id}`);
      if (cachedOrg) {
        const parsed = JSON.parse(cachedOrg);
        const isCacheFresh = parsed.timestamp && Date.now() - parsed.timestamp < 5 * 60 * 1000;
        const hasRequiredFields = parsed.organization?.id && parsed.organization?.name;

        if (isCacheFresh && hasRequiredFields) {
          // Trust cache - use immediately without validation query
          logger.log('[Setup] ✅ Using cached org (no validation query needed):', parsed.organization?.name);
          setOrganization(parsed.organization);
          setUserRole(parsed.role);
          setOrgLoading(false);
          cachedOrgValidated = true;
          // Fetch in background to refresh cache
        } else if (!isCacheFresh) {
          logger.log('[Setup] Cache expired, will fetch fresh');
        } else {
          console.warn('[Setup] Cache missing required fields, clearing');
          localStorage.removeItem(`stageflow_org_${user.id}`);
        }
      } else {
        logger.log('[Setup] No cache found, will fetch fresh');
      }
    } catch (e) {
      console.warn('[Setup] Cache validation failed:', e);
      // Clear potentially corrupt cache
      localStorage.removeItem(`stageflow_org_${user.id}`);
    }

    // CRITICAL FIX: Reset attempts after timeout to prevent permanent lockout
    // If enough time has passed since last attempt, user gets fresh attempts
    const timeSinceLastAttempt = Date.now() - lastSetupAttemptTime.current;
    if (timeSinceLastAttempt > SETUP_ATTEMPT_RESET_TIME) {
      setupAttempts.current = 0;
    }

    // Check attempt limit before starting
    if (setupAttempts.current >= MAX_SETUP_ATTEMPTS) {
      console.error('🛑 Max setup attempts reached. Try again in 60 seconds.');
      addNotificationRef.current('Setup failed after multiple attempts. Please wait 60 seconds and try again.', 'error');

      // CRITICAL FIX: Clear ALL loading states to prevent infinite spinner
      setOrgLoading(false);
      setLoading(false);

      return null;
    }

    // Track attempt time for reset logic
    lastSetupAttemptTime.current = Date.now();

    // Create a unique promise instance to prevent race conditions
    const setupPromise = (async () => {
      setOrgLoading(true);
      setupAttempts.current++;

      // BUG FIX: Check if organization already exists before creating
      // CRITICAL FIX v1.7.46: Race condition fix with exponential backoff retry
      // Problem: Database trigger creates org, but may not complete before this query runs
      // Solution: Retry up to 5 times with exponential backoff (100ms, 200ms, 400ms, 800ms, 1600ms)
      // This handles the race condition between trigger and frontend gracefully
      let existingMembership = null;
      let membershipError = null;

      try {
        const MAX_RETRY_ATTEMPTS = 5;
        let attempt = 0;

        while (attempt < MAX_RETRY_ATTEMPTS) {
          attempt++;

          // CRITICAL FIX: Use maybeSingle() not single() - single() throws 406 if no rows
          // maybeSingle() returns null if no rows, which is what we want for new users
          // OPT-3: PERFORMANCE FIX - Select only needed organization columns
          const { data, error } = await supabase
            .from('team_members')
            .select('organization_id, organizations(id, name, pipeline_template, created_at, plan), role')
            .eq('user_id', user.id)
            .limit(1)
            .maybeSingle();

          membershipError = error;

          // Success: Found organization
          if (!error && data && data.organizations?.id) {
            existingMembership = data;
            logger.log(`[APPSHELL] Organization found on attempt ${attempt}/${MAX_RETRY_ATTEMPTS}`);
            break;
          }

          // Database error (not just "not found") - stop retrying
          if (error && error.code !== 'PGRST116') {
            logger.error('[APPSHELL] Database error during org lookup:', error);
            break;
          }

          // No org found yet - retry with exponential backoff (unless last attempt)
          if (attempt < MAX_RETRY_ATTEMPTS) {
            const delayMs = 100 * Math.pow(2, attempt - 1); // 100, 200, 400, 800, 1600ms
            logger.log(`[APPSHELL] Org not found on attempt ${attempt}, retrying in ${delayMs}ms...`);
            await new Promise(resolve => setTimeout(resolve, delayMs));
          }
        }

        // After all retries, if still no org, log for monitoring
        if (!existingMembership) {
          logger.warn(`[APPSHELL] No organization found after ${MAX_RETRY_ATTEMPTS} attempts - will create new`, {
            userId: user?.id,
            email: user?.email
          });
        }

        if (!membershipError && existingMembership && existingMembership.organizations?.id) {

          // FIX: Validate that the organization object is actually valid (not just truthy)
          // Check if it has required fields beyond just an ID
          const org = existingMembership.organizations;

          if (org.id && org.name) {
            logger.log('[APPSHELL DEBUG] Setting organization:', {
              orgId: org.id,
              orgName: org.name,
              pipelineTemplate: org.pipeline_template,
              role: existingMembership.role
            });
            setOrganization(org);
            setUserRole(existingMembership.role);
            setOrgLoading(false);
            setupAttempts.current = 0;

            // PERFORMANCE FIX: Cache organization for instant subsequent loads
            // Save to BOTH localStorage (5min TTL) AND sessionStorage (entire session)
            const orgCache = {
              organization: org,
              role: existingMembership.role,
              timestamp: Date.now()
            };

            try {
              localStorage.setItem(`stageflow_org_${user.id}`, JSON.stringify(orgCache));
              // EMERGENCY FIX: Also save to sessionStorage for instant tab-switch restore
              sessionStorage.setItem(`stageflow_org_session_${user.id}`, JSON.stringify(orgCache));
            } catch (e) {
              console.warn('Cache write failed:', e);
            }

            return { organization: org, role: existingMembership.role };
          } else {
            console.warn('⚠️ Organization object exists but is incomplete/invalid - will recreate', org);
            console.warn('   org.id:', org.id, 'org.name:', org.name);
            // Fall through to recreate organization
          }
        } else if (existingMembership && !existingMembership.organizations?.id) {
          console.warn('⚠️ Found membership but organization is null - will recreate');
          // Organization was deleted but membership remains - continue to recreate
        } else if (membershipError) {
          console.error('❌ Membership query error:', membershipError);
        } else {
        }
      } catch (error) {
        // HOTFIX v1.7.46: Better error logging + Sentry capture for monitoring
        const errorDetails = {
          error: error.message,
          userId: user?.id,
          email: user?.email,
          errorType: error.name
        };

        console.error('⚠️ Organization lookup failed (will create new):', errorDetails);

        // MONITORING FIX: Capture in Sentry for production visibility
        if (typeof window !== 'undefined' && window.Sentry) {
          window.Sentry.captureException(error, {
            level: 'warning',
            tags: { context: 'organization_lookup' },
            extra: errorDetails
          });
        }

        // Continue with setup if check fails - this is expected for new users
      }


    try {
      // CRITICAL FIX: Use ORG_SETUP_TIMEOUT constant (mobile-aware)
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), ORG_SETUP_TIMEOUT);

      const response = await fetch('/.netlify/functions/setup-organization', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include', // Send HttpOnly cookies for auth
        body: JSON.stringify({
          userId: user.id,
          email: user.email
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      const responseText = await response.text();
      let responseData;
      
      try {
        responseData = JSON.parse(responseText);
      } catch (jsonError) {
        console.error('Non-JSON response:', responseText);
        if (!response.ok) {
          throw new Error(`Server error ${response.status}: ${responseText.substring(0, 100)}`);
        }
        throw new Error('Invalid JSON response from server');
      }

      if (!response.ok) {
        throw new Error(responseData.error || `HTTP ${response.status}`);
      }

      const { organization, role, error } = responseData;

      if (error) {
        throw new Error(error);
      }

      if (!organization || !role) {
        throw new Error('Invalid response: missing organization or role');
      }

      setOrganization(organization);
      setUserRole(role);
      // FIX v1.7.81 (#3): Remove annoying "Workspace loaded!" notification
      // REASON: Unnecessary noise - users don't need to be told workspace loaded every time
      setupAttempts.current = 0;
      setOrgLoading(false);

      return { organization, role };

    } catch (error) {
      console.error('💥 Organization setup failed:', error);

      // ENHANCED MOBILE ERROR LOGGING
      const errorContext = {
        userId: user?.id,
        email: user?.email,
        errorType: error.name,
        errorMessage: error.message,
        isAbortError: error.name === 'AbortError',
        isNetworkError: error.message?.includes('fetch') || error.message?.includes('network'),
        isMobile: isMobile,
        timeoutUsed: ORG_SETUP_TIMEOUT,
        setupAttempts: setupAttempts.current,
        stack: error.stack
      };

      console.error('[Setup Error] User ID:', errorContext.userId);
      console.error('[Setup Error] Email:', errorContext.email);
      console.error('[Setup Error] Error type:', errorContext.errorType);
      console.error('[Setup Error] Error message:', errorContext.errorMessage);
      console.error('[Setup Error] Is abort error:', errorContext.isAbortError);
      console.error('[Setup Error] Is network error:', errorContext.isNetworkError);
      console.error('[Setup Error] Mobile device:', errorContext.isMobile);
      console.error('[Setup Error] Timeout used:', errorContext.timeoutUsed + 'ms');
      console.error('[Setup Error] Setup attempts:', errorContext.setupAttempts);
      console.error('[Setup Error] Stack:', errorContext.stack);

      // MONITORING FIX: Capture in Sentry with full context
      if (typeof window !== 'undefined' && window.Sentry) {
        window.Sentry.captureException(error, {
          level: 'error',
          tags: {
            context: 'organization_setup',
            isMobile: isMobile ? 'true' : 'false',
            isAbortError: errorContext.isAbortError ? 'true' : 'false',
            attemptNumber: setupAttempts.current
          },
          extra: errorContext
        });
      }

      // Better error messages for users
      let userMessage = 'Setup failed: ';
      if (error.name === 'AbortError') {
        userMessage += `Request timed out after ${ORG_SETUP_TIMEOUT / 1000}s. Please check your connection and try again.`;
      } else if (error.message?.includes('fetch') || error.message?.includes('Failed to fetch')) {
        userMessage += 'Network error. Please check your internet connection.';
      } else {
        userMessage += error.message;
      }

      addNotificationRef.current(userMessage, 'error');

      // CRITICAL FIX: Reset ALL loading states on error to prevent infinite spinner
      setOrgLoading(false);
      setLoading(false);

      // Don't clear Promise immediately - prevent rapid retries
      // Caller will get the error and can decide to retry
      throw error;
    }
    })(); // Execute the async function immediately

    // Store the promise reference ATOMICALLY (before any await)
    setupOrganizationPromise.current = setupPromise;

    // Return the Promise so callers can await the result
    try {
      return await setupPromise;
    } finally {
      // CRITICAL: Only clear if this is still the active promise (prevents race condition)
      if (setupOrganizationPromise.current === setupPromise) {
        setupOrganizationPromise.current = null;
      }
    }
  }, []); // FIX HOOKS: Empty deps - uses addNotificationRef.current instead to prevent re-creation

  // Initial auth check and auth state listener
  React.useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }

    // PRODUCTION FIX: DISABLED all loading notifications
    // User feedback: "They shouldn't have to worry about what's loading"
    // Loading happens silently in background, only show actual errors
    const progressTimeout = setTimeout(() => {
      // DISABLED - was annoying green notification after 30s
      logger.log('[Loading] Still loading after 30s (notification disabled for production)');
    }, 30000);

    // Final failsafe timeout to prevent infinite loading
    const failsafeTimeout = setTimeout(() => {
      console.error(`⚠️ FAILSAFE TRIGGERED: Forcing loading to false after ${FAILSAFE_TIMEOUT}ms`);
      console.error('   This indicates a critical issue with auth or org setup');
      console.error('   Check console for auth/setup errors above');
      console.error('   Device:', isMobile ? 'MOBILE' : 'DESKTOP');
      console.error('   Timeouts used:', { AUTH_TIMEOUT, ORG_SETUP_TIMEOUT, FAILSAFE_TIMEOUT });
      setLoading(false);
      setOrgLoading(false);
      clearTimeout(progressTimeout);
      // DISABLED - only log to console, don't show notification to user
      logger.error('[Loading] Timed out after ' + (FAILSAFE_TIMEOUT / 1000) + 's (notification disabled)');
    }, FAILSAFE_TIMEOUT);

    // CRITICAL FIX: Reset setup progress on mount/refresh
    // Clear any stale Promise reference from previous mount
    setupOrganizationPromise.current = null;
    setupAttempts.current = 0;

    // ARCHITECTURAL FIX: Check for existing session first, then set up listener
    // This works with all Supabase versions (v2.39.0 doesn't have INITIAL_SESSION)
    const initializeAuth = async () => {
      try {
        // CRITICAL FIX v1.7.57: Check if OAuth is already being processed by AuthScreen
        // Prevents duplicate token exchange that causes React #300 error
        if (sessionStorage.getItem('oauth_processing') === 'true') {
          logger.log('[Auth] OAuth already being processed by AuthScreen, skipping duplicate');
          setLoading(false);
          return;
        }

        // CRITICAL FIX: Check for email verification errors in URL first
        const urlParams = new URLSearchParams(window.location.hash.substring(1));
        const errorDescription = urlParams.get('error_description');
        if (errorDescription) {
          console.error('[Auth] Email verification error:', errorDescription);
          addNotificationRef.current(`Verification failed: ${errorDescription}`, 'error');
          setLoading(false);
          // Clear the error from URL
          window.history.replaceState(null, '', window.location.pathname);
          return;
        }

        // SECURITY FIX: Handle magic link / password reset tokens from URL hash
        // When user clicks magic link, Supabase returns tokens in URL hash (#access_token=xxx)
        // We need to exchange these for HttpOnly cookies via backend endpoint
        const accessToken = urlParams.get('access_token');
        const refreshToken = urlParams.get('refresh_token');
        const tokenType = urlParams.get('type'); // 'recovery' for password reset, 'magiclink' for email login

        if (accessToken && refreshToken) {
          // SECURITY FIX (HIGH-SEC-2): Clear tokens from URL IMMEDIATELY before any logging
          // Prevents tokens from being captured in browser history or console logs
          const cleanPath = window.location.pathname;
          window.history.replaceState(null, '', cleanPath);

          // Don't log tokens - exchange happens silently for security
          try {
            // Exchange URL tokens for HttpOnly cookies via backend
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

            // SECURITY FIX (HIGH-SEC-2): Don't log sensitive user data
            // Tokens already cleared above, exchange successful

            // CRITICAL VALIDATION: Ensure exchangeData has required session data
            if (!exchangeData.session || !exchangeData.session.access_token) {
              console.error('[Auth] Token exchange returned invalid data structure:', {
                exchangeData,
                hasSession: !!exchangeData.session,
                hasAccessToken: !!exchangeData.session?.access_token
              });
              throw new Error('Token exchange returned invalid session data. Please try again.');
            }

            // CRITICAL FIX: Handle password reset differently from magic link
            if (tokenType === 'recovery') {
              // For password reset, show modal to enter new password
              // Don't log in until password is updated
              console.warn('[AppShell] Setting resetPasswordSession with VALIDATED exchangeData:', {
                hasSession: !!exchangeData.session,
                hasAccessToken: !!exchangeData.session?.access_token,
                sessionKeys: exchangeData.session ? Object.keys(exchangeData.session) : [],
                exchangeData: exchangeData
              });
              setResetPasswordSession(exchangeData);
              setShowResetPassword(true);
              setLoading(false);
              return; // Exit early - wait for user to set new password
            }

            // For magic link login, log in immediately
            const authenticatedUser = exchangeData.user;
            setUser(authenticatedUser);

            addNotificationRef.current('Login successful!', 'success');

            // Continue with org setup if email verified
            if (authenticatedUser.email_confirmed_at) {
              if (!organization || !organization.id) {
                const setupPromise = setupOrganization(authenticatedUser);
                const orgTimeoutPromise = new Promise((_, reject) =>
                  setTimeout(() => reject(new Error('Organization setup timed out')), ORG_SETUP_TIMEOUT)
                );

                try {
                  await Promise.race([setupPromise, orgTimeoutPromise]);
                } catch (setupError) {
                  console.error('[Auth] Organization setup failed:', setupError);
                  addNotificationRef.current('Failed to load workspace. Please refresh.', 'error');
                }
              }
            }

            setLoading(false);
            return; // Exit early - we handled authentication from URL tokens

          } catch (tokenError) {
            console.error('[Auth] Token exchange failed:', tokenError);
            addNotificationRef.current('Authentication failed. Please try again.', 'error');
            // Clear bad tokens from URL
            window.history.replaceState(null, '', window.location.pathname);
            setLoading(false);
            return;
          }
        }

        // SECURITY: Backend-only session check from HttpOnly cookies
        // FIX 2025-12-02: Add single retry for token rotation race condition
        const fetchAuthSession = async (attempt = 1) => {
          const sessionPromise = fetch('/.netlify/functions/auth-session', {
            method: 'GET',
            credentials: 'include' // Send HttpOnly cookies
          });
          const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Auth session check timed out')), AUTH_TIMEOUT)
          );

          const response = await Promise.race([sessionPromise, timeoutPromise]);

          // Retry once on transient failures (not 401 which means genuinely not logged in)
          if (!response.ok && response.status !== 401 && attempt === 1) {
            console.warn('[auth-session] Retrying after transient failure:', response.status);
            await new Promise(resolve => setTimeout(resolve, 500)); // Brief delay before retry
            return fetchAuthSession(2);
          }

          return response;
        };

        const response = await fetchAuthSession();

        // Handle session response
        let user = null;
        let session = null;
        if (response.ok) {
          const data = await response.json();
          user = data.user; // Backend returns full user object
          session = data.session; // CRITICAL FIX: Also get session tokens
        } else if (response.status !== 401) {
          // 401 = not logged in (expected), other errors are problems
          console.error('❌ Session check error:', response.status);
          setLoading(false);
          return;
        }

        if (user && session) {

          // CRITICAL FIX: Set session in Supabase client so DB queries work
          // Without this, the client doesn't know about the session and all
          // client-side queries (deals, AI providers) fail with RLS errors
          await supabase.auth.setSession({
            access_token: session.access_token,
            refresh_token: session.refresh_token
          });

          // CRITICAL FIX v1.7.57: Wait 50ms for session to propagate through client internals
          // Prevents WebSocket "closed before connection established" error
          await new Promise(resolve => setTimeout(resolve, 50));

          // Check if email is verified
          if (!user.email_confirmed_at) {
            setUser(user);
            setLoading(false);
            return; // Don't setup organization for unverified users
          }

          setUser(user);
          logger.log('[APPSHELL DEBUG] User set:', {
            userId: user.id,
            email: user.email,
            emailConfirmed: !!user.email_confirmed_at
          });

          // CRITICAL FIX: Only setup organization if we don't already have one loaded
          // This prevents unnecessary re-fetches when switching Mac workspaces/desktops
          if (!organization || !organization.id) {
            logger.log('[APPSHELL DEBUG] Starting organization setup...');
            // MOBILE FIX: Add timeout wrapper to prevent infinite loading on slow connections
            const setupPromise = setupOrganization(user);
            const orgTimeoutPromise = new Promise((_, reject) =>
              setTimeout(() => reject(new Error('Organization setup timed out')), ORG_SETUP_TIMEOUT)
            );

            try {
              const result = await Promise.race([setupPromise, orgTimeoutPromise]);
              logger.log('[APPSHELL DEBUG] Organization setup complete:', {
                hasResult: !!result,
                orgId: result?.id,
                orgName: result?.name
              });
            } catch (setupError) {
              console.error('❌ Setup failed during init:', setupError);
              console.error('   User:', user?.email);
              console.error('   Timeout:', ORG_SETUP_TIMEOUT + 'ms');
              // CRITICAL: Ensure loading is cleared so user sees error banner
              setOrgLoading(false);
              // Continue anyway - user can still use app with limited functionality
            }
          } else {
            logger.log('[APPSHELL DEBUG] Organization already loaded:', {
              orgId: organization.id,
              orgName: organization.name
            });
          }
        } else {
        }

        setLoading(false);
      } catch (error) {
        console.error('❌ Auth initialization failed:', error);

        // CRITICAL FIX: Show user-friendly message for timeout errors
        if (error.message?.includes('timed out')) {
          addNotificationRef.current('Connection timeout. Please check your internet and refresh.', 'error');
        }

        setLoading(false);
      }
    };

    // SECURITY: Initialize auth (check for existing session)
    initializeAuth();

    // PHASE 4 CLEANUP: Session refresh moved to App.jsx (lines 186-341)
    // App.jsx has better implementation with mutex and cross-tab coordination
    // Removing duplicate to prevent race conditions

    // FIX M7: Error handling in cleanup
    return () => {
      try {
        clearTimeout(failsafeTimeout); // Clear failsafe timeout
        clearTimeout(progressTimeout); // Clear progress notification timeout

        // MEDIUM FIX: Clear all notification timeouts to prevent memory leaks
        notificationTimeoutsRef.current.forEach(timeoutId => clearTimeout(timeoutId));
        notificationTimeoutsRef.current.clear();
      } catch (error) {
        console.error('Cleanup error:', error);
      }
    };
  }, [setupOrganization]); // FIX HOOKS: Only setupOrganization (stable with empty deps)

  // OPT-1: PERFORMANCE FIX - Restore cached organization on page visibility return
  // Fixes the "Setting up your workspace..." reload when switching Mac workspaces/mobile tabs
  // When user switches away and returns, restore from cache instead of re-fetching
  React.useEffect(() => {
    const handleVisibilityChange = (isVisible) => {
      if (isVisible && !organization && user) {
        logger.log('[Visibility] Page returned to visible - attempting cache restore');

        const cachedOrgKey = `stageflow_org_${user.id}`;
        const cachedOrgData = localStorage.getItem(cachedOrgKey);

        if (cachedOrgData) {
          try {
            const parsed = JSON.parse(cachedOrgData);
            const isCacheFresh = parsed.timestamp && Date.now() - parsed.timestamp < 5 * 60 * 1000;
            const hasRequiredFields = parsed.organization?.id && parsed.organization?.name;

            if (isCacheFresh && hasRequiredFields) {
              // Cache is fresh - use it immediately, skip expensive setup
              logger.log('[Visibility] ✅ Restored organization from cache:', parsed.organization.name);
              setOrganization(parsed.organization);
              setUserRole(parsed.role);
              setOrgLoading(false);
              setLoading(false);
              return; // Exit early - no need to call setupOrganization
            } else if (!isCacheFresh) {
              logger.log('[Visibility] Cache expired (age:', Math.round((Date.now() - parsed.timestamp) / 1000), 'seconds)');
            } else {
              logger.log('[Visibility] Cache missing required fields');
            }
          } catch (e) {
            console.error('[Visibility] Failed to parse cached org:', e);
            // Clear corrupt cache
            localStorage.removeItem(cachedOrgKey);
          }
        } else {
          logger.log('[Visibility] No cached organization found');
        }

        // If no valid cache, trigger normal setup (but only if not already running)
        if (!setupOrganizationPromise.current) {
          logger.log('[Visibility] No valid cache, triggering setup');
          setupOrganization(user);
        }
      } else if (isVisible && organization) {
        logger.log('[Visibility] Page visible, organization already loaded');
      }
    };

    // Register visibility change listener
    const unsubscribe = pageVisibility.addListener(handleVisibilityChange);

    // Return cleanup function
    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [user, setupOrganization]); // CRITICAL FIX: Removed 'organization' to prevent infinite loop when setOrganization is called

  React.useEffect(() => {
    // SAFARI COMPATIBILITY FIX: Wrap localStorage in try-catch
    // Private browsing mode in Safari throws QuotaExceededError even for small writes
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ darkMode }));
    } catch (error) {
      // Graceful degradation: Dark mode preference won't persist, but app continues working
      logger.warn('[AppShell] Failed to save dark mode preference (private browsing?):', error);
    }
  }, [darkMode]);

  // Fetch user profile data (avatar, first_name, last_name) when user logs in
  // PHASE G FIX: Use backend endpoint for reliable cookie-only auth
  React.useEffect(() => {
    const abortController = new AbortController();
    let isMounted = true;

    const fetchProfileData = async () => {
      if (!user) {
        setAvatarUrl(null);
        setProfileFirstName('');
        setProfileLastName('');
        return;
      }

      try {
        // PHASE J: Use auth-aware api-client with Authorization header
        // Fixes cross-origin cookie issues by sending Bearer token
        const { data: result, response } = await api.get('profile-get', {
          signal: abortController.signal
        });

        // Only update state if component is still mounted
        if (!isMounted || abortController.signal.aborted) {
          return;
        }

        if (response.ok) {
          const profile = result.profile;

          if (profile) {
            setAvatarUrl(profile.avatar_url || null);
            setProfileFirstName(profile.first_name || '');
            setProfileLastName(profile.last_name || '');
          } else {
            setAvatarUrl(null);
            setProfileFirstName('');
            setProfileLastName('');
          }
        } else if (response.status !== 401) {
          // 401 = not authenticated (expected for logged out users)
          console.error('Failed to load profile data:', response.status);
        }
      } catch (error) {
        if (!abortController.signal.aborted && error.name !== 'AbortError') {
          console.error('Profile data fetch error:', error);
        }
      }
    };

    fetchProfileData();

    // Cleanup: Cancel fetch if component unmounts
    return () => {
      isMounted = false;
      abortController.abort();
    };
  }, [user]);

  const retryOrganizationSetup = useCallback(() => {
    if (user && !setupOrganizationPromise.current) {
      setupOrganization(user);
    }
  }, [user, setupOrganization]);

  // AUTO-HEAL: Auto-retry organization setup if user has no organization
  // CRITICAL FIX: DISABLED - was causing "Setting up workspace" on every tab switch
  // Instead, rely on visibility change handler with caching (lines 659-712)
  React.useEffect(() => {
    // EMERGENCY FIX: Check BOTH sessionStorage AND localStorage for instant restore
    // sessionStorage = entire browser session (no expiry), localStorage = 5 min TTL
    if (user && !organization && !loading && !orgLoading) {
      // 1. Check sessionStorage FIRST (fastest, no expiry check needed)
      const sessionKey = `stageflow_org_session_${user.id}`;
      const sessionData = sessionStorage.getItem(sessionKey);

      if (sessionData) {
        try {
          const parsed = JSON.parse(sessionData);
          if (parsed.organization?.id && parsed.organization?.name) {
            logger.log('[INSTANT-RESTORE] Restoring org from sessionStorage (no reload needed):', parsed.organization.name);
            setOrganization(parsed.organization);
            setUserRole(parsed.role);
            return; // Exit early - instant restore
          }
        } catch (e) {
          logger.error('[INSTANT-RESTORE] Failed to parse session org:', e);
          sessionStorage.removeItem(sessionKey);
        }
      }

      // 2. Fallback to localStorage with TTL check
      const cachedOrgKey = `stageflow_org_${user.id}`;
      const cachedOrgData = localStorage.getItem(cachedOrgKey);

      if (cachedOrgData) {
        try {
          const parsed = JSON.parse(cachedOrgData);
          const isCacheFresh = parsed.timestamp && Date.now() - parsed.timestamp < 5 * 60 * 1000;
          const hasRequiredFields = parsed.organization?.id && parsed.organization?.name;

          if (isCacheFresh && hasRequiredFields) {
            logger.log('[AUTO-HEAL] Found cached org in localStorage, restoring:', parsed.organization.name);
            setOrganization(parsed.organization);
            setUserRole(parsed.role);

            // Also save to sessionStorage for instant future restores
            sessionStorage.setItem(sessionKey, JSON.stringify(parsed));
            return; // Exit early - no retry needed
          }
        } catch (e) {
          logger.error('[AUTO-HEAL] Failed to parse cached org:', e);
          localStorage.removeItem(cachedOrgKey);
        }
      }
    }

    // Stop any existing retry
    if (organization && orgRetryIntervalRef.current) {
      logger.log('[AUTO-HEAL] Organization set, stopping any retry');
      setOrgSetupRetrying(false);
      clearTimeout(orgRetryIntervalRef.current);
      orgRetryIntervalRef.current = null;
    }

    // Cleanup on unmount
    return () => {
      if (orgRetryIntervalRef.current) {
        clearTimeout(orgRetryIntervalRef.current);
        orgRetryIntervalRef.current = null;
      }
    };
  }, [user, loading, orgLoading]); // CRITICAL FIX: Removed 'organization' to prevent infinite loop (same as line 831)

  const logout = useCallback(async () => {
    // PHASE C FIX (B-SEC-02): Capture user ID before clearing state for cache cleanup
    const userId = user?.id;

    try {
      // SECURITY: Backend-only logout clears HttpOnly cookies
      const response = await fetch('/.netlify/functions/auth-logout', {
        method: 'POST',
        credentials: 'include' // Send cookies for server-side session invalidation
      });

      // Clear client state even if server logout fails
      setUser(null);
      setOrganization(null);
      setUserRole(null);
      setAvatarUrl(null);
      setProfileFirstName('');
      setProfileLastName('');
      setupOrganizationPromise.current = null;

      // PHASE C FIX (B-SEC-02): Clear ALL organization-specific caches on logout
      // This prevents data bleeding between users on shared devices
      if (userId) {
        try {
          // Clear org caches (localStorage + sessionStorage)
          localStorage.removeItem(`stageflow_org_${userId}`);
          sessionStorage.removeItem(`stageflow_org_session_${userId}`);

          // Clear AI provider status cache
          localStorage.removeItem(`ai_provider_status_${userId}`);

          // Clear any other user-specific keys
          const keysToRemove = [];
          for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && (key.includes(userId) || key.startsWith('stageflow_deals_'))) {
              keysToRemove.push(key);
            }
          }
          keysToRemove.forEach(key => localStorage.removeItem(key));

          logger.log('[Auth] Cleared all user-specific caches on logout');
        } catch (cacheError) {
          // Don't block logout if cache clearing fails (e.g., private browsing)
          logger.warn('[Auth] Failed to clear some caches:', cacheError);
        }
      }

      if (!response.ok) {
        console.error('[Auth] Server logout failed, but client state cleared');
      }

      addNotification('Logged out');

      // Small delay to show notification before redirect
      setTimeout(() => {
        window.location.href = '/login';
      }, 500);
    } catch (error) {
      console.error('Logout error:', error);
      addNotification('Logout failed', 'error');
      // Force redirect anyway
      setTimeout(() => {
        window.location.href = '/login';
      }, 500);
    }
  }, [user?.id, addNotification]);

  // Compute display name: prefer first/last name over email
  const displayName = React.useMemo(() => {
    const nameParts = [profileFirstName, profileLastName].filter(Boolean);
    if (nameParts.length > 0) {
      return nameParts.join(' ').trim();
    }
    return user?.email || '';
  }, [profileFirstName, profileLastName, user?.email]);

  // Function to update all profile data at once (called from Settings after save)
  const setProfileData = React.useCallback(({ firstName, lastName, avatarUrl: newAvatarUrl }) => {
    if (firstName !== undefined) setProfileFirstName(firstName);
    if (lastName !== undefined) setProfileLastName(lastName);
    if (newAvatarUrl !== undefined) setAvatarUrl(newAvatarUrl);
  }, []);

  // PERFORMANCE OPTIMIZATION: Split frequently-changing notifications from stable context
  // notifications array changes every 3 seconds (auto-dismiss), causing unnecessary re-renders
  // Stable values memoized separately to prevent cascade re-renders
  // CRITICAL FIX: Added setUser and setupOrganization to context
  // These were missing, causing password reset auto-login to fail
  // App.jsx ResetPasswordModalContainer needs these to set user after password update
  const stableContextValue = React.useMemo(() => ({
    user, setUser, logout, loading, darkMode, setDarkMode, activeView, setActiveView,
    addNotification, removeNotification, organization, setupOrganization, userRole, orgLoading, orgSetupRetrying,
    retryOrganizationSetup, avatarUrl, setAvatarUrl,
    profileFirstName, profileLastName, displayName, setProfileData,
    showResetPassword, setShowResetPassword, resetPasswordSession, setResetPasswordSession,
    VIEWS // Include VIEWS constant for navigation
  }), [
    user, logout, loading, darkMode, activeView,
    addNotification, removeNotification, organization, userRole, orgLoading, orgSetupRetrying,
    retryOrganizationSetup, avatarUrl,
    profileFirstName, profileLastName, displayName, setProfileData,
    showResetPassword, resetPasswordSession,
    setupOrganization // Added - stable due to empty deps in useCallback
  ]);

  // Add notifications separately to avoid re-renders when they change
  const contextValue = React.useMemo(() => ({
    ...stableContextValue,
    notifications
  }), [stableContextValue, notifications]);

  return (
    <AppContext.Provider value={contextValue}>
      {children}
    </AppContext.Provider>
  );
};

export const AuthScreen = () => {
  const { darkMode, user, addNotification, setUser, setupOrganization, organization } = useApp();
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [emailError, setEmailError] = useState('');

  // APPLE-LEVEL FIX #4: Password visibility toggle
  const [showPassword, setShowPassword] = useState(false);

  // APPLE-LEVEL UX FIX: Email verification support
  const [isEmailNotConfirmed, setIsEmailNotConfirmed] = useState(false);
  const [unverifiedEmail, setUnverifiedEmail] = useState('');
  const [isResendingVerification, setIsResendingVerification] = useState(false);
  // CRITICAL FIX: Move these hooks to top to comply with Rules of Hooks
  const [isResending, setIsResending] = useState(false);
  const [lastResendTime, setLastResendTime] = useState(0);

  // APPLE-LEVEL FIX #2: Escape key handler
  // CIRCULAR DEP FIX: Use ref to avoid showForgotPassword in deps
  const showForgotPasswordRef = React.useRef(showForgotPassword);
  React.useEffect(() => {
    showForgotPasswordRef.current = showForgotPassword;
  }, [showForgotPassword]);

  React.useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === 'Escape' && showForgotPasswordRef.current) {
        setShowForgotPassword(false);
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, []); // FIXED: Empty deps - removed showForgotPassword

  // OAuth Callback Handler - detects and processes OAuth redirects
  React.useEffect(() => {
    const handleOAuthCallback = async () => {
      // Check if we're returning from OAuth (has access_token in hash)
      if (window.location.hash.includes('access_token')) {
        setLoading(true);
        setError('');

        // CRITICAL FIX: Set flag to prevent duplicate processing by initializeAuth
        sessionStorage.setItem('oauth_processing', 'true');

        try {
          // CRITICAL FIX: Exchange OAuth tokens for HttpOnly cookies
          // Parse tokens from URL hash
          const hashParams = new URLSearchParams(window.location.hash.substring(1));
          const accessToken = hashParams.get('access_token');
          const refreshToken = hashParams.get('refresh_token');

          // Clear hash immediately for security
          window.history.replaceState(null, '', window.location.pathname);

          if (!accessToken || !refreshToken) {
            throw new Error('Missing tokens in OAuth callback');
          }

          // Exchange tokens for HttpOnly cookies via backend
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

          if (!exchangeResponse.ok) {
            throw new Error('Token exchange failed');
          }

          const exchangeData = await exchangeResponse.json();

          if (!exchangeData.session || !exchangeData.session.access_token) {
            throw new Error('Token exchange returned invalid session data');
          }

          // CRITICAL FIX: Set session in Supabase client so DB queries work
          // Without this, the client doesn't know about the HttpOnly cookie session
          // and all team_members/organizations queries fail with 401
          await supabase.auth.setSession({
            access_token: exchangeData.session.access_token,
            refresh_token: exchangeData.session.refresh_token
          });

          // CRITICAL FIX v1.7.57: Wait 50ms for session to propagate through client internals
          // Prevents WebSocket "closed before connection established" error
          await new Promise(resolve => setTimeout(resolve, 50));

          // OAuth login successful!
          setUser(exchangeData.session.user);
          addNotification('Welcome! Signed in with Google', 'success');

          // Setup organization for OAuth user
          if (!organization || !organization.id) {
            setupOrganization(exchangeData.session.user);
          }

          // CRITICAL FIX: Clear processing flag after successful auth
          sessionStorage.removeItem('oauth_processing');
        } catch (err) {
          console.error('[OAuth Callback] Error:', err);
          setError('Failed to complete sign in. Please try again.');
          window.history.replaceState(null, '', '/');
          // Clear flag on error too
          sessionStorage.removeItem('oauth_processing');
        } finally {
          setLoading(false);
        }
      }
    };

    handleOAuthCallback();
  }, [setupOrganization, setUser, addNotification]); // FIX v1.7.83 (#7): Removed 'organization' to prevent infinite loop

  // REMOVED: Client-side rate limiting - backend has proper distributed rate limiting
  const checkRateLimit = () => {
    // Keeping function signature for compatibility but always allowing
    // Backend handles all rate limiting properly
    return { allowed: true, secondsRemaining: 0 };
  };

  // APPLE-LEVEL UX FIX: Resend verification email
  const handleResendVerification = async () => {
    if (!unverifiedEmail) return;

    setIsResendingVerification(true);
    setError('');

    try {
      await sendVerificationEmail(unverifiedEmail);
      addNotification('Verification email sent! Check your inbox and spam folder.', 'success');
      setError('Verification email sent! Check your inbox and spam folder to complete signup.');
    } catch (err) {
      console.error('[Auth] Failed to resend verification:', err);
      setError(err.message || 'Failed to send verification email. Please try again.');
    } finally {
      setIsResendingVerification(false);
    }
  };

  // FIX #5: Email validation
  const validateEmail = (email) => {
    // APPLE-LEVEL FIX: Normalize and validate email
    email = email.trim().toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email) && email.length <= 320; // RFC 5321 max length
  };

  // APPLE-LEVEL FIX #6: Debounced email validation (validate on blur, not on change)
  const handleEmailChange = (e) => {
    const newEmail = e.target.value;
    setEmail(newEmail);
    // Clear error immediately when user starts typing
    if (emailError) setEmailError('');
  };

  const handleEmailBlur = () => {
    // APPLE STANDARD: Validate on blur, not while typing
    if (email && !validateEmail(email)) {
      setEmailError('Please enter a valid email address');
    }
  };

  const handleSubmit = async () => {
    if (!supabase) return;

    // Validate email before submission
    if (!email || !validateEmail(email)) {
      setError('Please enter a valid email address');
      return;
    }

    // Password validation
    if (!password || password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }

    // Additional password strength requirements (only for signup)
    // CRITICAL FIX: Must match backend validation in auth-signup.mts
    if (!isLogin) {
      const hasUpperCase = /[A-Z]/.test(password);
      const hasLowerCase = /[a-z]/.test(password);
      const hasNumber = /[0-9]/.test(password);
      const hasSpecialChar = /[^A-Za-z0-9]/.test(password);

      if (!hasUpperCase || !hasLowerCase || !hasNumber || !hasSpecialChar) {
        setError('Password must contain uppercase, lowercase, number, and special character (!@#$%^&*)');
        return;
      }
    }

    setError('');
    setLoading(true);
    try {
      if (isLogin) {
        // Backend-only auth with HttpOnly cookies + CSRF
        const response = await secureFetch('/.netlify/functions/auth-login', {
          method: 'POST',
          body: JSON.stringify({ email: email.trim().toLowerCase(), password })
        });

        // DEBUG v1.7.95: Log response details for troubleshooting
        console.warn('[Login] Response status:', response.status, response.ok);

        const data = await response.json();
        console.warn('[Login] Response data:', { success: data.success, code: data.code, hasSession: !!data.session, hasUser: !!data.user });

        if (!response.ok) {
          console.error('[Login] Auth failed:', { status: response.status, code: data.code, error: data.error });
          // APPLE-LEVEL UX FIX: Detect specific error types and provide actionable guidance
          if (data.code === 'EMAIL_NOT_CONFIRMED') {
            // User needs to verify their email - provide helpful message + resend button
            setIsEmailNotConfirmed(true);
            setUnverifiedEmail(data.email || email.trim().toLowerCase());
            setError(data.error || 'Please verify your email address. Check your inbox for the verification link.');
          } else if (response.status === 429) {
            // Rate limiting
            setIsEmailNotConfirmed(false);
            setError('Too many attempts. Try again in 30 seconds.');
          } else {
            // Generic authentication failure (wrong password, invalid email, etc.)
            setIsEmailNotConfirmed(false);
            setError('Invalid email or password');
          }
          setLoading(false);
          return;
        }

        // Login successful - clear any email verification flags
        setIsEmailNotConfirmed(false);
        setUnverifiedEmail('');

        // CRITICAL FIX: Set session in Supabase client so DB queries work
        // Without this, the client doesn't know about the HttpOnly cookie session
        // and all deals/organizations queries fail with 401
        await supabase.auth.setSession({
          access_token: data.session.access_token,
          refresh_token: data.session.refresh_token
        });

        // CRITICAL FIX v1.7.57: Wait 50ms for session to propagate through client internals
        // Prevents WebSocket "closed before connection established" error
        await new Promise(resolve => setTimeout(resolve, 50));

        // APPLE-LEVEL FIX #1: Seamless transition - NO PAGE RELOAD
        // Update state directly for smooth, instant transition
        setUser(data.user);
        addNotification('Welcome back!', 'success');

        // Setup organization if email is verified
        if (data.user.email_confirmed_at && (!organization || !organization.id)) {
          setupOrganization(data.user);
        }
      } else {
        // SECURITY: Backend-only signup with HttpOnly cookies + CSRF
        const response = await secureFetch('/.netlify/functions/auth-signup', {
          method: 'POST',
          body: JSON.stringify({ email, password })
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || 'Registration failed. Please try again.');
        }

        // Supabase automatically sends verification email via configured SMTP
        setError('Success! Please check your email (including spam folder) to verify your account before signing in.');
        setIsLogin(true);
      }
    } catch (error) {
      // DEBUG v1.7.95: Log the actual error for troubleshooting
      console.error('[Login] Exception caught:', error.message, error);
      // FIX C6: Use generic error to prevent account enumeration
      // Don't reveal if email exists or if password is wrong
      if (isLogin) {
        setError('Invalid email or password');
      } else {
        setError(error.message || 'Registration failed. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  // Google OAuth Sign-In Handler
  const handleGoogleLogin = async () => {
    if (!supabase) return;

    setError('');
    setLoading(true);

    try {
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
          queryParams: {
            access_type: 'offline',
            prompt: 'consent',
          }
        }
      });

      if (error) {
        console.error('[OAuth] Google sign-in error:', error);
        setError('Failed to initiate Google sign-in. Please try again.');
        setLoading(false);
      }
      // If successful, browser will redirect to Google
      // Loading state will persist until redirect completes
    } catch (error) {
      console.error('[OAuth] Exception during Google sign-in:', error);
      setError('An error occurred during Google sign-in. Please try again.');
      setLoading(false);
    }
  };

  // CRITICAL FIX: Removed duplicate hooks - moved to top of component

  // APPLE-LEVEL FIX #7: Use shared utility for sending verification email
  const resendVerificationEmail = async () => {
    if (!user?.email) return;

    // Rate limiting: 60 seconds between resends
    const now = Date.now();
    const cooldownPeriod = 60000; // 60 seconds
    const timeSinceLastResend = now - lastResendTime;

    if (timeSinceLastResend < cooldownPeriod) {
      const secondsRemaining = Math.ceil((cooldownPeriod - timeSinceLastResend) / 1000);
      addNotification(`Please wait ${secondsRemaining} seconds before resending.`, 'warning');
      return;
    }

    setIsResending(true);

    try {
      const emailResult = await sendVerificationEmail(user.email);
      setLastResendTime(now);
      addNotification('Verification email sent! Check your inbox and spam folder.', 'success');
      logger.log('[Auth] Resent verification email:', emailResult.emailId);
    } catch (error) {
      console.error('[Auth] Failed to resend verification email:', error);
      addNotification(error.message || 'Failed to send verification email. Please try again.', 'error');
    } finally {
      setIsResending(false);
    }
  };

  return (
    <div className="dark">
      <div className="fixed inset-0 h-screen overflow-hidden overscroll-none bg-black/95 backdrop-blur-sm flex items-center justify-center p-4">
        {/* Enhanced loading overlay with timeout detection and recovery */}
        {loading && (
          <LoadingOverlay
            message={isLogin ? 'Signing in...' : 'Creating account...'}
            timeoutMs={15000}
            onTimeout={(info) => {
              console.error('Auth loading timeout:', info);
              setLoading(false);
              setError('Login timed out. Please check your connection and try again.');
            }}
            onRetry={() => {
              setError('');
              handleSubmit();
            }}
            showRetry={true}
          />
        )}

        <div className="bg-gradient-to-br from-gray-900 to-black border border-teal-500/30 rounded-2xl p-8 max-w-md w-full shadow-2xl relative animate-slideUp">
          {/* Logo */}
          <div className="flex flex-col items-center justify-center mb-8">
            <StageFlowLogo size="xl" showText={true} showTagline={true} className="mb-4" />
          </div>

          <div className="space-y-4">
            {/* SECURITY FIX (CRIT-A11Y-2): Email input with visible label and ARIA */}
            <div>
              <label htmlFor="auth-email" className="block text-sm font-medium text-white mb-2">
                Email Address
              </label>
              <input
                id="auth-email"
                type="email"
                placeholder="your@email.com"
                value={email}
                onChange={handleEmailChange}
                onBlur={handleEmailBlur}
                onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
                disabled={loading}
                autoComplete="email"
                aria-required="true"
                aria-invalid={emailError ? 'true' : 'false'}
                aria-describedby={emailError ? 'email-error' : undefined}
                className={`w-full px-4 py-3 bg-gray-800/50 border rounded-xl text-white placeholder-gray-400 focus:ring-2 focus:ring-teal-500 focus:border-teal-500 transition ${
                  emailError
                    ? 'border-red-500'
                    : 'border-gray-700 hover:border-gray-600'
                }`}
              />
              {emailError && (
                <p id="email-error" role="alert" className="text-xs text-red-400 mt-1">{emailError}</p>
              )}
            </div>

            {/* SECURITY FIX (CRIT-A11Y-2) + UX FIX (HIGH-UX-1): Password with visible label and toggle */}
            <div>
              <label htmlFor="auth-password" className="block text-sm font-medium text-white mb-2">
                Password
              </label>
              <div className="relative">
                <input
                  id="auth-password"
                  type={showPassword ? "text" : "password"}
                  placeholder="Enter password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
                  disabled={loading}
                  autoComplete={isLogin ? "current-password" : "new-password"}
                  aria-required="true"
                  className="w-full px-4 py-3 pr-12 bg-gray-800/50 border border-gray-700 hover:border-gray-600 rounded-xl text-white placeholder-gray-400 focus:ring-2 focus:ring-teal-500 focus:border-teal-500 transition"
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

            {/* UX FIX (HIGH-UX-2): Interactive password requirements checklist during signup */}
            {!isLogin && (
              <div className="mt-3">
                <PasswordRequirements password={password} />
              </div>
            )}

            {/* FIX #1: Forgot Password link */}
            {isLogin && (
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => setShowForgotPassword(true)}
                  title="Reset your password via email"
                  className="text-sm text-teal-300 hover:text-teal-200 hover:underline transition"
                  disabled={loading}
                >
                  Forgot password?
                </button>
              </div>
            )}

            {/* APPLE-LEVEL UX FIX: Error/success message with resend button for unverified emails */}
            {error && (
              <div
                role={error.includes('Success') ? 'status' : 'alert'}
                aria-live="polite"
                className={`border rounded-xl p-3 text-sm ${
                  error.includes('Success')
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                    : isEmailNotConfirmed
                    ? 'bg-amber-500/10 border-amber-500/30 text-amber-400'
                    : 'bg-red-500/10 border-red-500/30 text-red-400'
                }`}
              >
                {sanitizeText(error)}

                {/* APPLE-LEVEL UX FIX: One-click resend button for unverified emails */}
                {isEmailNotConfirmed && (
                  <button
                    onClick={handleResendVerification}
                    disabled={isResendingVerification}
                    className="mt-3 w-full bg-teal-700 hover:bg-teal-800 text-white py-2 rounded-lg font-medium transition disabled:opacity-50 flex items-center justify-center gap-2 min-h-touch shadow-lg shadow-teal-700/20 hover:shadow-teal-700/40 hover:scale-[1.01] active:scale-[0.99]"
                    aria-label="Resend verification email"
                  >
                    {isResendingVerification ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Sending Verification Email...
                      </>
                    ) : (
                      <>
                        <Mail className="w-4 h-4" />
                        Resend Verification Email
                      </>
                    )}
                  </button>
                )}
              </div>
            )}

            {/* REMOVED: Orange password reset prompt - redundant with green "Forgot password?" link above */}

            {/* APPLE-LEVEL FIX #3: Submit button with ARIA */}
            <button
              onClick={handleSubmit}
              disabled={loading || emailError}
              aria-busy={loading}
              aria-label={isLogin ? 'Sign in to your account' : 'Create new account'}
              title={loading ? (isLogin ? 'Signing in...' : 'Creating account...') : (isLogin ? 'Sign in to your account' : 'Create a new account')}
              className="w-full bg-teal-700 hover:bg-teal-800 text-white py-3 rounded-xl font-semibold transition disabled:opacity-50 flex items-center justify-center gap-2 min-h-touch shadow-lg shadow-teal-700/20 hover:shadow-teal-700/40 hover:scale-[1.02] active:scale-[0.98]"
            >
              {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : null}
              {isLogin ? 'Sign In' : 'Sign Up'}
            </button>

            {/* Divider */}
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-700"></div>
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-2 bg-gradient-to-br from-gray-900 to-black text-gray-400">Or continue with</span>
              </div>
            </div>

            {/* Google OAuth Button - PREMIUM BRIGHT DESIGN */}
            <button
              onClick={handleGoogleLogin}
              disabled={loading}
              aria-label={isLogin ? 'Sign in with Google' : 'Sign up with Google'}
              title={isLogin ? 'Sign in with your Google account' : 'Sign up with your Google account'}
              className="w-full bg-white hover:bg-gray-50 text-gray-900 py-4 px-6 rounded-xl font-bold text-base transition-all duration-200 disabled:opacity-50 flex items-center justify-center gap-3 border-2 border-gray-200 hover:border-blue-500 hover:shadow-xl hover:scale-[1.02] active:scale-[0.98] shadow-lg relative overflow-hidden group"
              style={{
                boxShadow: '0 4px 20px rgba(255, 255, 255, 0.25), 0 8px 30px rgba(66, 133, 244, 0.15)'
              }}
            >
              {/* Subtle gradient overlay on hover */}
              <div className="absolute inset-0 bg-gradient-to-r from-blue-50/0 via-blue-50/50 to-blue-50/0 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>

              {/* Google Icon - Larger and more prominent */}
              <svg className="w-6 h-6 relative z-10" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>

              {/* Button Text - Larger and bolder */}
              <span className="relative z-10 text-gray-900 font-bold tracking-wide">
                {isLogin ? 'Sign in with Google' : 'Sign up with Google'}
              </span>
            </button>

            <button
              onClick={() => setIsLogin(!isLogin)}
              disabled={loading}
              title={isLogin ? 'Switch to sign up form' : 'Switch to sign in form'}
              className="w-full text-gray-300 text-sm hover:text-gray-300 transition"
            >
              {isLogin ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
            </button>
          </div>
        </div>

        {/* FIX #1: Forgot Password Modal */}
        <ForgotPasswordModal
          isOpen={showForgotPassword}
          onClose={() => setShowForgotPassword(false)}
          darkMode={darkMode}
        />

      </div>
    </div>
  );
};

export const AppShell = ({ children }) => {
  const { user, darkMode, setDarkMode, activeView, setActiveView, logout, notifications, removeNotification, organization, orgLoading, orgSetupRetrying, retryOrganizationSetup, avatarUrl, displayName, addNotification } = useApp();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [lastResendTime, setLastResendTime] = useState(0);
  // CRITICAL FIX: Move offline detection hook to top to comply with Rules of Hooks
  const [isOnline, setIsOnline] = React.useState(navigator.onLine);

  // APPLE-LEVEL FIX #7: Use shared utility for sending verification email
  const resendVerificationEmail = async () => {
    if (!user?.email) return;

    // Rate limiting: 60 seconds between resends
    const now = Date.now();
    const cooldownPeriod = 60000; // 60 seconds
    const timeSinceLastResend = now - lastResendTime;

    if (timeSinceLastResend < cooldownPeriod) {
      const secondsRemaining = Math.ceil((cooldownPeriod - timeSinceLastResend) / 1000);
      addNotification(`Please wait ${secondsRemaining} seconds before resending.`, 'warning');
      return;
    }

    setIsResending(true);

    try {
      const emailResult = await sendVerificationEmail(user.email);
      setLastResendTime(now);
      addNotification('Verification email sent! Check your inbox and spam folder.', 'success');
      logger.log('[Auth] Resent verification email:', emailResult.emailId);
    } catch (error) {
      console.error('[Auth] Failed to resend verification email:', error);
      addNotification(error.message || 'Failed to send verification email. Please try again.', 'error');
    } finally {
      setIsResending(false);
    }
  };

  // CRITICAL FIX: Removed duplicate hook - moved to top of component

  React.useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return (
    <div className={darkMode ? 'dark' : ''}>
      {/* CRITICAL FIX: Removed min-h-screen and -webkit-fill-available which block scrolling on Safari/Mac */}
      {/* Using flex-1 + min-h-0 allows proper flex behavior and enables page scroll */}
      <div className="flex-1 flex flex-col min-h-0 bg-white dark:bg-[#121212]">
        {/* FIX #9: Skip link for accessibility (WCAG 2.1 Level A) */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-[200] bg-[#1ABC9C] text-white px-4 py-2 rounded-lg font-medium shadow-lg"
        >
          Skip to main content
        </a>

        {/* Banners Container - Fixed at top above nav */}
        <div className="fixed top-0 left-0 right-0 z-[160]">
          {/* FIX #7: Offline detection banner */}
          {!isOnline && (
            <div className="bg-yellow-500 dark:bg-yellow-600 text-white py-3 text-center font-medium shadow-md">
              <div className="max-w-7xl mx-auto px-4 flex items-center justify-center gap-2">
                <AlertCircle className="w-5 h-5" />
                <span>You're offline. Changes will sync when reconnected.</span>
              </div>
            </div>
          )}

          {/* Organization Loading Banner - REMOVED: Silent background loading for better UX
              Only show if this is FIRST TIME setup (no cache) AND taking longer than 3 seconds
              Returning users should NEVER see this banner - organization loads from cache instantly */}
          {false && (orgLoading || orgSetupRetrying) && (
            <div className="bg-[#1ABC9C]/10 border-b border-[#1ABC9C] py-3 shadow-md backdrop-blur-xl">
              <div className="max-w-7xl mx-auto px-4 flex items-center justify-center gap-3">
                <Loader2 className="w-5 h-5 animate-spin text-[#1ABC9C]" />
                <span className="text-sm font-medium text-[#1ABC9C]">
                  {orgSetupRetrying ? 'Setting up your workspace (auto-retry)...' : 'Setting up your workspace...'}
                </span>
              </div>
            </div>
          )}

          {/* Email Verification Banner */}
          {user && !user?.email_confirmed_at && (
            <div className="bg-[#3B82F6]/10 border-b border-[#3B82F6] py-3 shadow-md backdrop-blur-xl">
              <div className="max-w-7xl mx-auto px-4 flex items-center justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <Mail className="w-5 h-5 text-[#3B82F6] flex-shrink-0" />
                  <div className="min-w-0">
                    <span className="text-sm font-medium text-[#3B82F6] block">
                      Email verification required
                    </span>
                    <span className="text-sm text-[#6B7280] dark:text-[#9CA3AF] block truncate">
                      Check your inbox at <strong>{user.email}</strong>
                    </span>
                  </div>
                </div>
                <button
                  onClick={resendVerificationEmail}
                  disabled={isResending}
                  className="flex items-center gap-2 px-4 py-2 bg-[#3B82F6] hover:bg-[#2563EB] text-white rounded-lg text-sm font-medium transition whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
                >
                  <RefreshCw className={`w-4 h-4 ${isResending ? 'animate-spin' : ''}`} />
                  {isResending ? 'Sending...' : 'Resend'}
                </button>
              </div>
            </div>
          )}

          {/* Organization Failed Banner */}
          {!orgLoading && !organization && (
            <div className="bg-[#F39C12]/10 border-b border-[#F39C12] py-3 shadow-md backdrop-blur-xl">
              <div className="max-w-7xl mx-auto px-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <AlertCircle className="w-5 h-5 text-[#F39C12] flex-shrink-0" />
                  <div>
                    <span className="text-sm font-medium text-[#F39C12]">
                      Workspace not loaded.
                    </span>
                    <span className="text-sm text-[#6B7280] dark:text-[#9CA3AF] ml-2">
                      Check console for errors (F12)
                    </span>
                  </div>
                </div>
                <button
                  onClick={retryOrganizationSetup}
                  className="flex items-center gap-2 px-4 py-2 bg-[#F39C12] hover:bg-[#E67E22] text-white rounded-lg text-sm font-medium transition"
                >
                  <RefreshCw className="w-4 h-4" />
                  Retry
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Premium Glass Nav - Fixed below banners, always accessible */}
        <nav
          className="bg-gradient-to-r from-gray-900/95 to-black/95 backdrop-blur-xl border-b border-teal-500/30 fixed left-0 right-0 z-[150] shadow-2xl overflow-x-clip w-full transition-all duration-200"
          style={{
            top: `${
              (!isOnline ? 60 : 0) +
              (orgLoading ? 60 : 0) +
              (user && !user?.email_confirmed_at ? 60 : 0) +
              (!orgLoading && !organization ? 60 : 0)
            }px`
          }}
        >
          <div className="max-w-7xl mx-auto px-4">
            <div className="flex items-center justify-between h-16">
              <div className="flex items-center gap-8">
                {/* Logo */}
                <Logo size="md" showText={true} />
                
                {/* Desktop Nav Links */}
                <div className="hidden md:flex gap-1">
                  <button
                    onClick={() => setActiveView(VIEWS.DASHBOARD)}
                    className={`px-4 py-2 rounded-xl font-medium transition-all ${
                      activeView === VIEWS.DASHBOARD
                        ? 'bg-teal-500/20 text-teal-400 shadow-lg shadow-teal-500/20'
                        : 'text-gray-300 hover:text-white hover:bg-gray-800/50'
                    }`}
                  >
                    Dashboard
                  </button>
                  <button
                    onClick={() => setActiveView(VIEWS.INTEGRATIONS)}
                    className={`px-4 py-2 rounded-xl font-medium transition-all ${
                      activeView === VIEWS.INTEGRATIONS
                        ? 'bg-teal-500/20 text-teal-400 shadow-lg shadow-teal-500/20'
                        : 'text-gray-300 hover:text-white hover:bg-gray-800/50'
                    }`}
                    data-tour="integrations-nav"
                  >
                    Integrations
                  </button>
                  <button
                    onClick={() => setActiveView(VIEWS.TEAM)}
                    className={`px-4 py-2 rounded-xl font-medium transition-all flex items-center gap-2 ${
                      activeView === VIEWS.TEAM
                        ? 'bg-teal-500/20 text-teal-400 shadow-lg shadow-teal-500/20'
                        : 'text-gray-300 hover:text-white hover:bg-gray-800/50'
                    }`}
                  >
                    <Users className="w-4 h-4" />
                    Team
                  </button>
                </div>
              </div>
              
              <div className="flex items-center gap-4">
                {/* Mobile Menu Button - Enhanced contrast for visibility */}
                <button
                  onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                  className="md:hidden p-2.5 bg-teal-500/20 hover:bg-teal-500/30 rounded-xl transition-all border border-teal-500/30"
                  aria-label="Toggle menu"
                >
                  {isMobileMenuOpen ? <X className="w-6 h-6 text-teal-400" /> : <Menu className="w-6 h-6 text-teal-400" />}
                </button>

                {/* Dark Mode Toggle */}
                <button
                  onClick={() => setDarkMode(!darkMode)}
                  className="p-2 hover:bg-gray-800/50 rounded-xl transition-all min-h-touch min-w-touch"
                  aria-label={darkMode ? "Switch to light mode" : "Switch to dark mode"}
                  title={darkMode ? "Switch to light mode" : "Switch to dark mode"}
                >
                  {darkMode ? <Sun className="w-5 h-5 text-amber-400" aria-hidden="true" /> : <Moon className="w-5 h-5 text-gray-300" aria-hidden="true" />}
                </button>

                {/* Settings Button with Avatar */}
                <button
                  onClick={() => setActiveView(VIEWS.SETTINGS)}
                  className={`w-10 h-10 rounded-full flex items-center justify-center font-semibold shadow-lg transition-all hover:scale-105 overflow-hidden border-2 min-h-touch min-w-touch ${
                    avatarUrl
                      ? 'bg-gray-800 border-gray-700 hover:border-teal-500/50'
                      : 'bg-gradient-to-br from-teal-500 to-teal-600 border-teal-500/30 text-white shadow-teal-500/20 hover:shadow-teal-500/40'
                  }`}
                  aria-label={`Open settings - ${displayName || 'Profile'}`}
                  title={displayName || 'Settings'}
                  data-tour="settings-button"
                >
                  {avatarUrl ? (
                    <img
                      src={avatarUrl}
                      alt={displayName || 'Profile'}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <User className="w-5 h-5" aria-hidden="true" />
                  )}
                </button>
              </div>
            </div>
          </div>
        </nav>

        {/* Mobile Menu Overlay */}
        {isMobileMenuOpen && (
          <div className="md:hidden fixed inset-0 z-[160] modal-backdrop-apple" onClick={() => setIsMobileMenuOpen(false)}>
            <div className="bg-white dark:bg-[#0D1F2D] w-full max-w-sm ml-auto h-full shadow-xl" onClick={(e) => e.stopPropagation()}>
              <div className="p-6 space-y-4">
                <button
                  onClick={() => { setActiveView(VIEWS.DASHBOARD); setIsMobileMenuOpen(false); }}
                  className={`w-full px-4 py-3 rounded-lg font-medium transition text-left ${
                    activeView === VIEWS.DASHBOARD
                      ? 'bg-[#1ABC9C]/10 text-[#1ABC9C] shadow-sm'
                      : 'text-[#6B7280] dark:text-[#9CA3AF] hover:bg-gray-100 dark:hover:bg-gray-800'
                  }`}
                >
                  Dashboard
                </button>
                <button
                  onClick={() => { setActiveView(VIEWS.INTEGRATIONS); setIsMobileMenuOpen(false); }}
                  className={`w-full px-4 py-3 rounded-lg font-medium transition text-left ${
                    activeView === VIEWS.INTEGRATIONS
                      ? 'bg-[#1ABC9C]/10 text-[#1ABC9C] shadow-sm'
                      : 'text-[#6B7280] dark:text-[#9CA3AF] hover:bg-gray-100 dark:hover:bg-gray-800'
                  }`}
                >
                  Integrations
                </button>
                <button
                  onClick={() => { setActiveView(VIEWS.TEAM); setIsMobileMenuOpen(false); }}
                  className={`w-full px-4 py-3 rounded-lg font-medium transition text-left flex items-center gap-2 ${
                    activeView === VIEWS.TEAM
                      ? 'bg-[#1ABC9C]/10 text-[#1ABC9C] shadow-sm'
                      : 'text-[#6B7280] dark:text-[#9CA3AF] hover:bg-gray-100 dark:hover:bg-gray-800'
                  }`}
                >
                  <Users className="w-4 h-4" />
                  Team
                </button>
                {/* FIX #10: Add Settings to mobile menu */}
                <button
                  onClick={() => { setActiveView(VIEWS.SETTINGS); setIsMobileMenuOpen(false); }}
                  className={`w-full px-4 py-3 rounded-lg font-medium transition text-left ${
                    activeView === VIEWS.SETTINGS
                      ? 'bg-[#1ABC9C]/10 text-[#1ABC9C] shadow-sm'
                      : 'text-[#6B7280] dark:text-[#9CA3AF] hover:bg-gray-100 dark:hover:bg-gray-800'
                  }`}
                >
                  Settings
                </button>
              </div>
            </div>
          </div>
        )}

        {/* CRITICAL FIX: Added flex-1 to allow main content to grow and enable page scrolling */}
        <main
          id="main-content"
          tabIndex="-1"
          className="flex-1 w-full mx-auto px-4 pb-8 lg:px-6 xl:px-8 2xl:px-12 transition-all duration-200"
          style={{
            paddingTop: `${
              64 + // Nav height (h-16 = 64px)
              (!isOnline ? 60 : 0) +
              (orgLoading ? 60 : 0) +
              (user && !user?.email_confirmed_at ? 60 : 0) +
              (!orgLoading && !organization ? 60 : 0) +
              32 // Extra spacing (8 * 4 = 32px)
            }px`
          }}
        >
          {/* CRITICAL: Error boundary prevents entire app crash if child components error */}
          <ErrorBoundary>
            {children}
          </ErrorBoundary>
        </main>

        {/* Mobile Bottom Navigation - REMOVED: Redundant with hamburger menu */}
        {/* <MobileNav activeView={activeView} setActiveView={setActiveView} /> */}

        {/* Enhanced Notifications */}
        {/* CRITICAL Z-INDEX FIX: Use z-300 to appear above AI provider cards (z-173) and all modals (z-200) */}
        <div className="fixed bottom-6 right-6 space-y-3 z-[300] max-w-md">
          {notifications.map(notif => (
            <div
              key={notif.id}
              role="alert"
              className={`px-5 py-4 rounded-2xl shadow-2xl border backdrop-blur-xl text-base font-medium transition-all duration-300 ease-out animate-slide-in ${
                notif.type === 'error'
                  ? 'bg-red-950/80 border-red-500/30 text-red-200'
                  : notif.type === 'warning'
                  ? 'bg-amber-950/80 border-amber-500/30 text-amber-200'
                  : 'bg-emerald-950/80 border-emerald-500/30 text-emerald-200'
              }`}
              style={{
                boxShadow: notif.type === 'error'
                  ? '0 18px 45px rgba(239, 68, 68, 0.25), 0 0 0 1px rgba(239, 68, 68, 0.1)'
                  : notif.type === 'warning'
                  ? '0 18px 45px rgba(245, 158, 11, 0.25), 0 0 0 1px rgba(245, 158, 11, 0.1)'
                  : '0 18px 45px rgba(16, 185, 129, 0.25), 0 0 0 1px rgba(16, 185, 129, 0.1)'
              }}
            >
              <div className="flex items-start gap-3">
                {notif.type === 'error' ? (
                  <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                ) : notif.type === 'warning' ? (
                  <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                ) : (
                  <svg className="w-5 h-5 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                )}
                <span className="flex-1 text-sm leading-relaxed">{notif.message}</span>
                <button
                  onClick={() => removeNotification(notif.id)}
                  className={`flex-shrink-0 p-1 rounded-lg transition-colors ${
                    notif.type === 'error'
                      ? 'hover:bg-red-800/50 text-red-300'
                      : notif.type === 'warning'
                      ? 'hover:bg-amber-800/50 text-amber-300'
                      : 'hover:bg-emerald-800/50 text-emerald-300'
                  }`}
                  aria-label="Dismiss notification"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Feedback Widget - Global across all pages */}
        <FeedbackWidget />
      </div>
    </div>
  );
};
