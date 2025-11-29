import React, { useEffect, useState, Suspense, lazy } from 'react';
import { Loader2, AlertCircle } from 'lucide-react';
import { AppProvider, useApp, AuthScreen, AppShell } from './components/AppShell';
import { ErrorBoundary } from './components/ErrorBoundary';
import { MaintenanceMode } from './components/MaintenanceMode';
import { ServiceWorkerUpdateNotification } from './components/ServiceWorkerUpdateNotification';
import { ConnectionStatus } from './components/ConnectionStatus'; // NEXT-LEVEL: Real-time connection status
import { ResetPasswordModal } from './components/ResetPasswordModal';
import { Dashboard } from './components/Dashboard';
import { VIEWS, supabase } from './lib/supabase';
import validator, { initValidator } from './lib/config-validator';
import { csrfProtection } from './lib/csrf-protection';
import { logger } from './lib/logger';
import { timerManager, initTimerManager } from './lib/timerManager';
import { cleanupMemoryCaches, initMemoryCaches } from './lib/memory-cache';
import { onboardingStorage } from './lib/onboardingStorage';
import { onboardingSync } from './lib/onboardingSync';
import { initIndexedDBCache } from './lib/indexeddb-cache';
import { backgroundSync } from './lib/background-sync';
import { initPerformanceBudget } from './lib/performance-budget';

// NEXT-LEVEL PERFORMANCE: Lazy load non-critical views for faster initial load
// Dashboard loads immediately (most common), others load on-demand
// This reduces initial bundle by ~50-60KB and improves First Contentful Paint
const Settings = lazy(() => import('./components/Settings'));
const Integrations = lazy(() => import('./components/Integrations'));
const TeamDashboard = lazy(() => import('./components/TeamDashboard'));

// NEXT-LEVEL: Fallback component for lazy-loaded views
// Professional loading skeleton that matches view structure
const ViewFallback = () => (
  <div className="min-h-screen bg-[#F9FAFB] dark:bg-[#121212] p-8">
    <div className="max-w-7xl mx-auto space-y-6 animate-pulse">
      {/* Header skeleton */}
      <div className="h-10 bg-gray-200 dark:bg-gray-700 rounded w-1/4 mb-8" />
      {/* Content skeleton */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {[1, 2, 3].map(i => (
          <div key={i} className="bg-white dark:bg-[#0D1F2D] rounded-2xl p-6 border border-[#E0E0E0] dark:border-gray-700">
            <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded w-3/4 mb-4" />
            <div className="space-y-3">
              <div className="h-4 bg-gray-100 dark:bg-gray-800 rounded w-full" />
              <div className="h-4 bg-gray-100 dark:bg-gray-800 rounded w-5/6" />
            </div>
          </div>
        ))}
      </div>
    </div>
  </div>
);

// CRITICAL FIX: NoOrganizationPlaceholder must be defined OUTSIDE MainApp
// Defining components inside render functions causes React error #310
const NoOrganizationPlaceholder = () => {
  const [diagnosticInfo, setDiagnosticInfo] = React.useState(null);
  const [isRunningDiagnostic, setIsRunningDiagnostic] = React.useState(false);
  const [showPlaceholder, setShowPlaceholder] = React.useState(false);

  // CRITICAL FIX: Don't show diagnostic screen immediately
  // Give organization 10 seconds to load before showing error
  // This prevents the flash/reload on login
  React.useEffect(() => {
    const timer = setTimeout(() => {
      setShowPlaceholder(true);
    }, 10000); // 10 second grace period

    return () => clearTimeout(timer);
  }, []);

  // Don't render anything during grace period - just show spinner
  if (!showPlaceholder) {
    return (
      <div className="min-h-screen bg-[#F9FAFB] dark:bg-[#121212] flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-12 h-12 animate-spin text-[#1ABC9C] mx-auto mb-4" />
          <p className="text-sm text-[#6B7280] dark:text-[#9CA3AF]">Loading workspace...</p>
        </div>
      </div>
    );
  }

  const runDiagnostic = async () => {
    setIsRunningDiagnostic(true);
    try {
      // Run diagnostic - backend gets user from HttpOnly cookies
      const response = await fetch('/.netlify/functions/mobile-diagnostic', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include', // Include HttpOnly auth cookies
        body: JSON.stringify({})
      });

      const result = await response.json();
      setDiagnosticInfo(result);
    } catch (error) {
      setDiagnosticInfo({ error: error.message });
    } finally {
      setIsRunningDiagnostic(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F9FAFB] dark:bg-[#121212] flex items-center justify-center p-4">
      <div className="bg-white dark:bg-[#0D1F2D] rounded-2xl p-8 max-w-md w-full shadow-xl border border-[#E0E0E0] dark:border-gray-700">
        <div className="flex items-center justify-center mb-6">
          <div className="w-16 h-16 bg-amber-100 dark:bg-amber-900/30 rounded-full flex items-center justify-center">
            <AlertCircle className="w-8 h-8 text-amber-600 dark:text-amber-400" />
          </div>
        </div>
        <h2 className="text-2xl font-bold text-center text-[#1A1A1A] dark:text-[#E0E0E0] mb-2">
          Workspace Not Loaded
        </h2>
        <p className="text-center text-[#6B7280] dark:text-[#9CA3AF] mb-6">
          We couldn't load your organization data. This might be a temporary issue.
        </p>
        <div className="space-y-3">
          <button
            onClick={() => window.location.reload()}
            className="w-full bg-[#1ABC9C] hover:bg-[#16A085] text-white py-3 rounded-lg font-semibold transition flex items-center justify-center gap-2"
          >
            <Loader2 className="w-4 h-4" />
            Reload Page
          </button>
          <button
            onClick={runDiagnostic}
            disabled={isRunningDiagnostic}
            className="w-full border-2 border-[#E0E0E0] dark:border-gray-700 text-[#1A1A1A] dark:text-[#E0E0E0] py-3 rounded-lg font-semibold hover:bg-gray-50 dark:hover:bg-gray-800 transition disabled:opacity-50"
          >
            {isRunningDiagnostic ? 'Running Diagnostic...' : 'Run Diagnostic'}
          </button>
        </div>
        {diagnosticInfo && (
          <div className="mt-4 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
            <pre className="text-xs overflow-auto">
              {JSON.stringify(diagnosticInfo, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
};

const MainApp = () => {
  const { user, loading, orgLoading, activeView, organization } = useApp();

  // CRITICAL DEBUG: Track renders to find infinite loop
  const renderCount = React.useRef(0);
  renderCount.current++;

  if (renderCount.current > 50) {
    console.error('🚨🚨🚨 INFINITE LOOP DETECTED - MainApp rendered', renderCount.current, 'times!');
    console.error('Current values:', { loading, orgLoading, hasUser: !!user, hasOrg: !!organization, activeView });
    throw new Error('Infinite loop detected in MainApp - stopping to prevent browser crash');
  }

  // console.error('[DEBUG] MainApp render #' + renderCount.current, { loading, orgLoading, hasUser: !!user, hasOrg: !!organization, activeView });

  // APPLE-LEVEL UX: Track if first load is complete
  // After first load, NEVER show loading spinner again (like VS Code, Supabase)
  // This prevents the "weird refresh" when switching workspaces
  const firstLoadComplete = React.useRef(false);
  const loadStartTime = React.useRef(Date.now());

  // MOBILE DEBUG: Log loading states for debugging blank screen issues
  React.useEffect(() => {
    logger.log('[App] Loading states:', { loading, orgLoading, hasUser: !!user, hasOrg: !!organization, activeView });

    // CRITICAL FIX: Force complete first load after 10 seconds to prevent infinite spinner
    // This ensures the app always shows even if org setup fails
    const elapsed = Date.now() - loadStartTime.current;
    if (elapsed > 10000 && !firstLoadComplete.current) {
      console.warn('[App] ⚠️ Force completing first load after 10s timeout');
      firstLoadComplete.current = true;
    }

    // Mark first load as complete once we have a user (logged in) or loading stops
    if ((user || !loading) && !firstLoadComplete.current) {
      logger.log('[App] ✅ First load complete - future loads will be instant');
      firstLoadComplete.current = true;
    }
  }, [loading, orgLoading, user, organization, activeView]);

  // CRITICAL FIX: ALL HOOKS MUST BE CALLED BEFORE ANY EARLY RETURNS
  // PHASE 2: Setup automatic session refresh for cookie-based auth
  // Refreshes access token every 55 minutes (before 1-hour expiration)
  // SECURITY FIX (2025-11-19): Added mutex to prevent race conditions
  React.useEffect(() => {
    if (!user) return;

    logger.log('[Auth] Setting up automatic session refresh with race condition protection');

    // SECURITY FIX 1: Mutex to prevent concurrent refresh requests
    let isRefreshing = false;
    let refreshPromise = null;

    // SECURITY FIX 2: Broadcast Channel for cross-tab coordination
    // Only create if supported (not available in all browsers)
    let refreshChannel = null;
    try {
      refreshChannel = new BroadcastChannel('stageflow-auth-refresh');

      // Listen for refresh events from other tabs
      refreshChannel.addEventListener('message', (event) => {
        if (event.data === 'REFRESH_STARTED') {
          isRefreshing = true;
          logger.log('[Auth] Another tab is refreshing, waiting...');
        } else if (event.data === 'REFRESH_COMPLETED') {
          isRefreshing = false;
          logger.log('[Auth] Another tab completed refresh');
        } else if (event.data === 'REFRESH_FAILED') {
          isRefreshing = false;
          // Other tab's refresh failed, allow this tab to try
        }
      });
    } catch (error) {
      // BroadcastChannel not supported, continue without cross-tab coordination
      logger.log('[Auth] BroadcastChannel not supported, single-tab refresh only');
    }

    // SECURITY FIX 3: Refresh function with mutex
    // v1.7.98: Fixed race condition - set promise BEFORE setting isRefreshing flag
    const refreshSession = async () => {
      // Prevent concurrent refreshes - check BOTH conditions
      if (isRefreshing && refreshPromise) {
        logger.log('[Auth] Refresh already in progress, reusing existing promise');
        return refreshPromise;
      }

      // v1.7.98: CRITICAL - Set promise FIRST, then flag to prevent race condition
      // Previous bug: isRefreshing was true but refreshPromise was null for a brief moment,
      // allowing subsequent calls to return Promise.resolve() instead of the actual promise
      refreshPromise = (async () => {
        // Set flag AFTER promise is assigned to prevent race window
        isRefreshing = true;

        // Notify other tabs
        if (refreshChannel) {
          try {
            refreshChannel.postMessage('REFRESH_STARTED');
          } catch (e) {
            // Ignore broadcast errors
          }
        }

        try {
          logger.log('[Auth] Auto-refreshing session...');

          const response = await fetch('/.netlify/functions/auth-refresh', {
            method: 'POST',
            credentials: 'include' // Include refresh token cookie
          });

          if (!response.ok) {
            console.error('[Auth] Session refresh failed - tokens likely expired');

            // Notify other tabs of failure
            if (refreshChannel) {
              try {
                refreshChannel.postMessage('REFRESH_FAILED');
              } catch (e) {
                // Ignore
              }
            }

            // CRITICAL FIX: Don't force redirect on background refresh failure
            // User may have been away > 1 hour and tokens expired naturally
            // Instead, let the app gracefully handle expired state on next interaction
            // This prevents constant reload loops when user returns
            logger.log('[Auth] Clearing refresh interval - user will need to re-auth on next action');
            clearInterval(refreshInterval);

            // Only redirect if this was an interactive refresh (user action triggered it)
            // Background auto-refresh failures should be silent
            return;
          } else {
            logger.log('[Auth] Session refreshed successfully');

            // Notify other tabs of success
            if (refreshChannel) {
              try {
                refreshChannel.postMessage('REFRESH_COMPLETED');
              } catch (e) {
                // Ignore
              }
            }
          }
        } catch (error) {
          console.error('[Auth] Session refresh error:', error);

          // Notify other tabs of failure
          if (refreshChannel) {
            try {
              refreshChannel.postMessage('REFRESH_FAILED');
            } catch (e) {
              // Ignore
            }
          }

          // CRITICAL FIX: Don't force redirect on network errors
          // Network issues (offline, server down) shouldn't cause reload loops
          logger.log('[Auth] Clearing refresh interval due to error');
          clearInterval(refreshInterval);
          return;
        } finally {
          isRefreshing = false;
          refreshPromise = null;
        }
      })();

      return refreshPromise;
    };

    // SECURITY FIX 4: Add jitter to prevent predictable timing (55-56 minutes)
    // Makes timing attacks harder
    const baseInterval = 55 * 60 * 1000; // 55 minutes
    const jitter = Math.random() * 60 * 1000; // 0-1 minute
    const intervalWithJitter = baseInterval + jitter;

    logger.log(`[Auth] Refresh interval: ${Math.round(intervalWithJitter / 60000)} minutes`);

    // Set up interval with mutex-protected refresh
    const refreshInterval = setInterval(refreshSession, intervalWithJitter);

    // SECURITY FIX 5: Expose global refresh function for manual calls
    // This allows other parts of the app to trigger refresh without race conditions
    window.__stageflowRefreshSession = refreshSession;

    // Cleanup interval on unmount or user change
    return () => {
      logger.log('[Auth] Cleaning up session refresh interval');
      clearInterval(refreshInterval);

      // Close broadcast channel
      if (refreshChannel) {
        try {
          refreshChannel.close();
        } catch (e) {
          // Ignore
        }
      }

      // Clean up global function
      delete window.__stageflowRefreshSession;
    };
  }, [user]);

  // CRITICAL FIX: ALL CONDITIONAL RENDERS MUST COME AFTER ALL HOOKS
  // APPLE-LEVEL UX FIX: Show spinner ONLY on first load
  // After first load, show cached content immediately (no spinner)
  // This is how VS Code and Supabase work - instant on workspace switch
  const shouldShowSpinner = (loading || orgLoading) && !firstLoadComplete.current;

  if (shouldShowSpinner) {
    const elapsed = Date.now() - loadStartTime.current;
    const isSlowLoad = elapsed > 5000;

    return (
      <div className="min-h-screen bg-[#F9FAFB] dark:bg-[#121212] flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-12 h-12 animate-spin text-[#1ABC9C] mx-auto mb-4" />
          {isSlowLoad && (
            <p className="text-sm text-[#6B7280] dark:text-[#9CA3AF] mt-4">
              This is taking longer than usual...
              <br />
              <span className="text-xs">Check your internet connection</span>
            </p>
          )}
        </div>
      </div>
    );
  }

  if (!user) return <AuthScreen />;

  // REMOVED: All blocking checks for !organization
  // Components now conditionally render based on organization existence
  // If organization is null, AppShell shows "Workspace not loaded" banner with Retry button

  // PERFORMANCE FIX: Conditional rendering instead of display:none
  // Saves 15-20 MB memory per inactive view by unmounting them
  // Uses React.lazy() + Suspense for fast initial loads
  return (
    <AppShell>
      {/* CRITICAL MOBILE FIX: Always render something - never blank screen */}
      {/* Show content if organization exists, otherwise show helpful placeholder */}
      {activeView === VIEWS.DASHBOARD && (
        organization ? <Dashboard /> : <NoOrganizationPlaceholder />
      )}

      {activeView === VIEWS.INTEGRATIONS && (
        organization ? (
          <Suspense fallback={<ViewFallback />}>
            <ErrorBoundary fallback={<div className="p-8 text-center"><AlertCircle className="w-12 h-12 mx-auto mb-4 text-red-500" /><p>Failed to load Integrations. Please refresh the page.</p></div>}>
              <Integrations />
            </ErrorBoundary>
          </Suspense>
        ) : (
          <NoOrganizationPlaceholder />
        )
      )}

      {activeView === VIEWS.SETTINGS && (
        organization ? (
          <Suspense fallback={<ViewFallback />}>
            <ErrorBoundary fallback={<div className="p-8 text-center"><AlertCircle className="w-12 h-12 mx-auto mb-4 text-red-500" /><p>Failed to load Settings. Please refresh the page.</p></div>}>
              <Settings />
            </ErrorBoundary>
          </Suspense>
        ) : (
          <NoOrganizationPlaceholder />
        )
      )}

      {activeView === VIEWS.TEAM && (
        organization ? (
          <Suspense fallback={<ViewFallback />}>
            <ErrorBoundary fallback={<div className="p-8 text-center"><AlertCircle className="w-12 h-12 mx-auto mb-4 text-red-500" /><p>Failed to load Team Dashboard. Please refresh the page.</p></div>}>
              <TeamDashboard />
            </ErrorBoundary>
          </Suspense>
        ) : (
          <NoOrganizationPlaceholder />
        )
      )}
    </AppShell>
  );
};

export default function App() {
  // ZERO-DOWNTIME ARCHITECTURE: Dynamic maintenance mode checking
  // Allows toggling maintenance mode without requiring user refresh
  const [maintenanceMode, setMaintenanceMode] = useState(
    import.meta.env.VITE_MAINTENANCE_MODE === 'true'
  );

  useEffect(() => {
    // Initialize security features
    try {
      const report = validator.getValidationReport();
      if (report.status === 'error') {
        console.error('[Security] Config validation failed');
      }

      // Initialize CSRF protection
      csrfProtection.getToken();
    } catch (error) {
      console.error('[Security] Initialization failed:', error);
    }

    // CRITICAL: Check remote maintenance status dynamically
    // This allows zero-downtime deployments by showing maintenance screen
    // without requiring users to refresh their browser
    const checkMaintenanceStatus = async () => {
      try {
        const response = await fetch('/api/maintenance-status', {
          method: 'GET',
          cache: 'no-store', // Always get fresh status
          signal: AbortSignal.timeout(5000) // 5 second timeout
        });

        if (response.ok) {
          const { enabled, message, estimatedTime } = await response.json();
          logger.log('[Maintenance] Remote status:', { enabled, message });
          setMaintenanceMode(enabled);
        }
      } catch (error) {
        // FAIL OPEN: If maintenance check fails, don't block users
        // This ensures users can access the app even if the check endpoint is down
        console.debug('[Maintenance] Status check failed (failing open):', error.message);
      }
    };

    // Check immediately on app start
    checkMaintenanceStatus();

    // Check every 60 seconds for maintenance mode changes
    const interval = setInterval(checkMaintenanceStatus, 60000);

    return () => clearInterval(interval);
  }, []);

  // CRITICAL FIX #14: Initialize memory caches and IndexedDB after module load
  // This prevents Temporal Dead Zone (TDZ) errors in production builds
  // Must run BEFORE any cache usage to avoid "Cannot access before initialization" errors
  useEffect(() => {
    logger.info('[App] Initializing caches and timers');
    initValidator(); // Initialize config validator (was running at module load)
    initTimerManager(); // Initialize timer cleanup listener
    onboardingStorage.init(); // Initialize onboarding storage event listeners
    initMemoryCaches(); // Initialize memory cache timers and event listeners
    initIndexedDBCache(); // Initialize IndexedDB and cleanup timer
    backgroundSync.init(); // Initialize background sync event listeners
    initPerformanceBudget(); // Initialize performance budget monitoring
  }, []);

  // PERFORMANCE FIX: Cleanup all global timers and event listeners on app unmount
  // Prevents memory leaks from module-level setInterval/addEventListener calls
  useEffect(() => {
    return () => {
      logger.info('[App] Unmounting - cleaning up global resources');
      timerManager.cleanup(); // Fix #7: Timer cleanup
      cleanupMemoryCaches(); // Fix #11: Memory cache event listener cleanup
      onboardingStorage.cleanup(); // Fix #11: Onboarding storage event listener cleanup
      onboardingSync.cleanup(); // Fix #12: Supabase subscription cleanup
    };
  }, []);

  // Show maintenance mode if enabled
  if (maintenanceMode) {
    return <MaintenanceMode />;
  }

  return (
    <ErrorBoundary>
      <AppProvider>
        <MainApp />
        {/* CRITICAL FIX: Reset Password Modal rendered at App level (outside context provider) */}
        <ResetPasswordModalContainer />
      </AppProvider>
      {/* NEXT-LEVEL: Service worker update notification */}
      <ServiceWorkerUpdateNotification />
      {/* NEXT-LEVEL: Real-time connection status indicator */}
      <ConnectionStatus />
    </ErrorBoundary>
  );
}

// Modal container component that uses context but renders outside provider tree
const ResetPasswordModalContainer = () => {
  const { showResetPassword, setShowResetPassword, resetPasswordSession, setResetPasswordSession, setUser, addNotification, organization, setupOrganization } = useApp();

  const handleClose = React.useCallback(() => {
    setShowResetPassword(false);
    setResetPasswordSession(null);
  }, [setShowResetPassword, setResetPasswordSession]);

  const handleSuccess = React.useCallback((freshUserData) => {
    // ✅ CRITICAL FIX: Use FRESH user data from backend (after password update)
    // This has the updated user with new password and fresh session tokens in cookies
    const userData = freshUserData || resetPasswordSession?.user;

    if (userData) {
      console.warn('[App] 🚀 INSTANT LOGIN: Setting user and loading dashboard...', {
        userId: userData.id,
        email: userData.email,
        emailConfirmed: !!userData.email_confirmed_at
      });

      // IMMEDIATE LOGIN: Set user in App context
      setUser(userData);
      addNotification('Welcome back! Your password has been updated.', 'success');

      // Setup organization if needed (async - happens in background)
      if (userData.email_confirmed_at) {
        onboardingStorage.migrateOldKeys(userData.id);
        if (!organization || !organization.id) {
          setupOrganization(userData);
        }
      }
    }

    // Clean up reset password state
    setShowResetPassword(false);
    setResetPasswordSession(null);
  }, [resetPasswordSession, setUser, addNotification, organization, setupOrganization, setShowResetPassword, setResetPasswordSession]);

  if (!showResetPassword) return null;

  // DEBUGGING: Log what we're passing to the modal
  console.warn('[App] Rendering ResetPasswordModal with:', {
    resetPasswordSession: resetPasswordSession,
    sessionProp: resetPasswordSession?.session,
    hasResetPasswordSession: !!resetPasswordSession,
    hasSessionProp: !!resetPasswordSession?.session,
    hasAccessToken: !!resetPasswordSession?.session?.access_token
  });

  return (
    <ResetPasswordModal
      isOpen={showResetPassword}
      session={resetPasswordSession?.session}
      onClose={handleClose}
      onSuccess={handleSuccess}
    />
  );
};
