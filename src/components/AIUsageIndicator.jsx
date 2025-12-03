import React, { useState, useEffect } from 'react';
import { Zap, AlertTriangle, TrendingUp } from 'lucide-react';
// FIX 2025-12-03: Import auth utilities for proper Authorization header injection
import { supabase, ensureValidSession } from '../lib/supabase';

/**
 * QA FIX #4: AI Usage Limit Indicator
 *
 * Shows remaining AI queries for the current billing period.
 * Minimal, unobtrusive design that fits the StageFlow aesthetic.
 *
 * States:
 * - Normal (< 80%): Shows usage count
 * - Warning (>= 80%): Yellow, suggests upgrade
 * - Critical (>= 100%): Red, shows upgrade CTA
 */
export const AIUsageIndicator = ({ organizationId, onNavigate }) => {
  const [usage, setUsage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!organizationId) {
      setLoading(false);
      return;
    }

    const fetchUsage = async () => {
      try {
        // FIX 2025-12-03: Inject Authorization header for reliable auth
        await ensureValidSession();
        const { data: { session } } = await supabase.auth.getSession();

        const headers = { 'Content-Type': 'application/json' };
        if (session?.access_token) {
          headers['Authorization'] = `Bearer ${session.access_token}`;
        }

        const response = await fetch('/.netlify/functions/get-ai-usage', {
          method: 'POST',
          headers,
          credentials: 'include', // Keep cookies as fallback
          body: JSON.stringify({ organization_id: organizationId })
        });

        if (!response.ok) {
          // FIX 2025-12-03: Handle auth errors gracefully
          if (response.status === 401 || response.status === 403) {
            console.warn('[AIUsageIndicator] Session expired - hiding indicator');
            setError('session_expired');
            return;
          }
          throw new Error('Failed to fetch usage');
        }

        const data = await response.json();
        setUsage(data);
        setError(null); // Clear any previous errors
      } catch (err) {
        console.error('[AIUsageIndicator] Error fetching usage:', err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchUsage();

    // Refresh every 5 minutes
    const interval = setInterval(fetchUsage, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [organizationId]);

  // Don't render while loading or on error
  if (loading || error || !usage) return null;

  // Unlimited plan - don't show indicator
  if (usage.limit === -1) return null;

  const { used, limit, plan } = usage;
  const percentage = Math.round((used / limit) * 100);
  const remaining = limit - used;

  // Determine state
  const isWarning = percentage >= 80 && percentage < 100;
  const isCritical = percentage >= 100;

  // Minimal display for normal state
  if (!isWarning && !isCritical) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-white/40">
        <Zap className="w-3 h-3" />
        <span>{remaining} AI queries left</span>
      </div>
    );
  }

  // Warning state (80-99%)
  if (isWarning) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-500/10 border border-amber-500/20 rounded-lg">
        <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
        <span className="text-xs text-amber-300">
          {remaining} AI queries left
        </span>
        {onNavigate && (
          <button
            onClick={() => onNavigate('SETTINGS')}
            className="text-[10px] text-amber-400 hover:text-amber-300 font-medium ml-1"
          >
            Upgrade
          </button>
        )}
      </div>
    );
  }

  // Critical state (100%+)
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 bg-rose-500/10 border border-rose-500/20 rounded-lg">
      <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
      <span className="text-xs text-rose-300">
        AI limit reached
      </span>
      {onNavigate && (
        <button
          onClick={() => onNavigate('SETTINGS')}
          className="text-[10px] text-rose-400 hover:text-rose-300 font-medium ml-1"
        >
          Upgrade
        </button>
      )}
    </div>
  );
};

/**
 * Compact version for header/footer placement
 */
export const AIUsageIndicatorCompact = ({ organizationId }) => {
  const [usage, setUsage] = useState(null);

  useEffect(() => {
    if (!organizationId) return;

    const fetchUsage = async () => {
      try {
        // FIX 2025-12-03: Inject Authorization header for reliable auth
        await ensureValidSession();
        const { data: { session } } = await supabase.auth.getSession();

        const headers = { 'Content-Type': 'application/json' };
        if (session?.access_token) {
          headers['Authorization'] = `Bearer ${session.access_token}`;
        }

        const response = await fetch('/.netlify/functions/get-ai-usage', {
          method: 'POST',
          headers,
          credentials: 'include', // Keep cookies as fallback
          body: JSON.stringify({ organization_id: organizationId })
        });

        if (response.ok) {
          const data = await response.json();
          setUsage(data);
        } else if (response.status === 401 || response.status === 403) {
          // FIX 2025-12-03: Silent fail on auth errors, hide indicator
          console.warn('[AIUsageIndicatorCompact] Session expired');
        }
      } catch (err) {
        // Silent fail for compact version
        console.warn('[AIUsageIndicatorCompact] Error:', err.message);
      }
    };

    fetchUsage();
  }, [organizationId]);

  if (!usage || usage.limit === -1) return null;

  const percentage = Math.round((usage.used / usage.limit) * 100);
  const isWarning = percentage >= 80;

  return (
    <span className={`text-[10px] ${isWarning ? 'text-amber-400' : 'text-white/30'}`}>
      {usage.used}/{usage.limit} AI
    </span>
  );
};

export default AIUsageIndicator;
