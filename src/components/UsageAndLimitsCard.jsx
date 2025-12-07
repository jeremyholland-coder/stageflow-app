/**
 * UsageAndLimitsCard Component
 * Area 7 - Billing & Quotas
 *
 * Displays current usage and plan limits for AI features.
 * Shows progress bars for each quota category with upgrade prompts.
 *
 * @author StageFlow Engineering
 * @date December 2025
 */

import React, { memo } from 'react';
import { Sparkles, TrendingUp, Zap, AlertTriangle, ArrowUpRight, Loader2 } from 'lucide-react';
import { useUsageSummary } from '../hooks/useUsageSummary';
import { api } from '../lib/api-client';

/**
 * Progress bar component with color coding based on percentage
 */
const UsageProgressBar = memo(({ label, used, limit, percentage, icon: Icon }) => {
  // Determine color based on usage percentage
  const getColorClass = () => {
    if (percentage >= 100) return 'bg-red-500';
    if (percentage >= 80) return 'bg-amber-500';
    return 'bg-teal-500';
  };

  // Format limit display (handle unlimited)
  const formatLimit = (val) => {
    if (val === -1 || val >= 999999) return 'Unlimited';
    return val.toLocaleString();
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-2">
          {Icon && <Icon className="w-4 h-4 text-gray-400" />}
          <span className="text-gray-300">{label}</span>
        </div>
        <span className="text-gray-400">
          {used.toLocaleString()} / {formatLimit(limit)}
        </span>
      </div>
      <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
        <div
          className={`h-full ${getColorClass()} transition-all duration-300`}
          style={{ width: `${Math.min(percentage, 100)}%` }}
        />
      </div>
      {percentage >= 80 && percentage < 100 && (
        <p className="text-xs text-amber-400 flex items-center gap-1">
          <AlertTriangle className="w-3 h-3" />
          Approaching limit
        </p>
      )}
      {percentage >= 100 && (
        <p className="text-xs text-red-400 flex items-center gap-1">
          <AlertTriangle className="w-3 h-3" />
          Limit reached
        </p>
      )}
    </div>
  );
});

UsageProgressBar.displayName = 'UsageProgressBar';

/**
 * Main UsageAndLimitsCard component
 */
const UsageAndLimitsCard = memo(({ onManagePlan, onUpgrade, className = '' }) => {
  const { data, isLoading, isError, error } = useUsageSummary();

  // Loading state
  if (isLoading) {
    return (
      <div className={`bg-gray-800/50 border border-gray-700 rounded-xl p-6 ${className}`}>
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-6 h-6 animate-spin text-teal-400" />
        </div>
      </div>
    );
  }

  // Error state
  if (isError) {
    return (
      <div className={`bg-gray-800/50 border border-gray-700 rounded-xl p-6 ${className}`}>
        <div className="text-center py-4">
          <p className="text-gray-400 text-sm">Unable to load usage data</p>
          <p className="text-gray-500 text-xs mt-1">{error?.message || 'Please try again'}</p>
        </div>
      </div>
    );
  }

  const {
    planId,
    planName,
    limits,
    usage,
    percentages,
    nearLimit,
    atLimit,
    upgradePrompt,
    nextPlan,
  } = data || {};

  // Handle upgrade click
  const handleUpgrade = async () => {
    if (onUpgrade) {
      onUpgrade();
    } else {
      // Default: Open Stripe checkout for startup plan
      try {
        const response = await api.payment('create-checkout-session', {
          tier: 'startup',
          interval: 'annual',
        });
        if (response.url) {
          window.location.href = response.url;
        }
      } catch (err) {
        console.error('Failed to create checkout session:', err);
      }
    }
  };

  // Handle manage plan click
  const handleManagePlan = async () => {
    if (onManagePlan) {
      onManagePlan();
    } else {
      // Default: Open Stripe billing portal
      try {
        const response = await api.payment('create-portal-session', {});
        if (response.url) {
          window.location.href = response.url;
        }
      } catch (err) {
        console.error('Failed to create portal session:', err);
      }
    }
  };

  return (
    <div className={`bg-gray-800/50 border border-gray-700 rounded-xl p-6 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-teal-500/20 flex items-center justify-center">
            <TrendingUp className="w-5 h-5 text-teal-400" />
          </div>
          <div>
            <h3 className="font-semibold text-white">Usage & Limits</h3>
            <p className="text-sm text-gray-400">
              {planName || 'Free Plan'}
              {planId !== 'pro' && (
                <span className="ml-2 text-xs text-teal-400 cursor-pointer hover:underline" onClick={handleUpgrade}>
                  Upgrade
                </span>
              )}
            </p>
          </div>
        </div>

        {/* Warning badge if near limit */}
        {(nearLimit || atLimit) && (
          <div className={`px-3 py-1 rounded-full text-xs font-medium ${
            atLimit ? 'bg-red-500/20 text-red-400' : 'bg-amber-500/20 text-amber-400'
          }`}>
            {atLimit ? 'At Limit' : 'Near Limit'}
          </div>
        )}
      </div>

      {/* Usage bars */}
      <div className="space-y-5">
        {/* Monthly AI Requests */}
        {limits?.aiRequestsPerMonth > 0 && (
          <UsageProgressBar
            label="AI Requests (Monthly)"
            used={usage?.aiRequestsThisMonth || 0}
            limit={limits?.aiRequestsPerMonth || 100}
            percentage={percentages?.aiRequestsMonth || 0}
            icon={Sparkles}
          />
        )}

        {/* Daily AI Generic */}
        <UsageProgressBar
          label="AI Requests (Today)"
          used={usage?.aiGenericToday || 0}
          limit={limits?.aiGenericPerDay || 100}
          percentage={percentages?.aiGenericToday || 0}
          icon={Zap}
        />

        {/* Plan My Day */}
        <UsageProgressBar
          label="Plan My Day (Today)"
          used={usage?.planMyDayToday || 0}
          limit={limits?.planMyDayPerUserPerDay || 2}
          percentage={percentages?.planMyDayToday || 0}
          icon={TrendingUp}
        />
      </div>

      {/* Upgrade prompt for free tier */}
      {upgradePrompt && planId === 'free' && (
        <div className="mt-6 p-4 bg-gradient-to-br from-teal-900/30 to-emerald-900/30 border border-teal-500/30 rounded-lg">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm text-white font-medium">Need more AI power?</p>
              <p className="text-xs text-gray-400 mt-1">
                {nextPlan?.name} includes {nextPlan?.aiRequestsPerMonth?.toLocaleString() || '1,000'} AI requests/month
              </p>
            </div>
            <button
              onClick={handleUpgrade}
              className="flex items-center gap-1 px-3 py-1.5 bg-teal-500 hover:bg-teal-600 text-white text-sm font-medium rounded-lg transition"
            >
              Upgrade
              <ArrowUpRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Manage plan link for paid users */}
      {planId !== 'free' && (
        <div className="mt-6 pt-4 border-t border-gray-700">
          <button
            onClick={handleManagePlan}
            className="text-sm text-gray-400 hover:text-white transition flex items-center gap-1"
          >
            Manage subscription
            <ArrowUpRight className="w-3 h-3" />
          </button>
        </div>
      )}
    </div>
  );
});

UsageAndLimitsCard.displayName = 'UsageAndLimitsCard';

export default UsageAndLimitsCard;
