import React, { useState, useEffect, useMemo } from 'react';
import { Loader2, Check, Sparkles, TrendingUp, Shield, Users, Zap, BarChart3, Mail, Workflow, CheckCircle, RefreshCw, CreditCard } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { logger } from '../lib/logger';
import { api } from '../lib/api-client';

// REMOVED: @stripe/stripe-js - no longer needed after deprecation of redirectToCheckout()

const BillingSettings = ({ organizationId, currentPlan, usageStats = {} }) => {
  const [billingInterval, setBillingInterval] = useState('annual'); // Master toggle for all plans
  const [loadingTier, setLoadingTier] = useState(null);
  const [hoveredPlan, setHoveredPlan] = useState(null);

  // DEBUG: Log organization state (only runs when organizationId/currentPlan changes)
  useEffect(() => {
    logger.log('BillingSettings loaded with:', { organizationId, currentPlan });
  }, [organizationId, currentPlan]);

  // Show loading state if organization hasn't loaded yet
  if (!organizationId) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4 text-[#1ABC9C]" />
          <p className="text-[#6B7280] dark:text-[#9CA3AF]">Loading workspace...</p>
        </div>
      </div>
    );
  }

  // Extract usage stats with defaults
  const {
    dealsUsed = 23,
    dealsLimit = 100,
    usersUsed = 1,
    usersLimit = 1,
    aiRequestsUsed = 45,
    aiRequestsLimit = 100
  } = usageStats;

  // CRITICAL FIX: Memoize plans array to prevent infinite re-render loop
  // This array was being recreated on every render, causing useEffect to run infinitely
  const plans = useMemo(() => [
    {
      name: 'free',
      displayName: 'Free',
      priceMonthly: 0,
      priceAnnual: 0,
      maxDeals: 100,
      maxUsers: 1,
      aiRequests: 100,
      description: 'Get started with AI-powered CRM',
      features: [
        { text: 'Up to 100 deals', icon: Check },
        { text: '1 user', icon: Users },
        { text: '100 AI requests/month', icon: Sparkles, highlight: true },
        { text: 'Kanban pipeline', icon: BarChart3 },
        { text: 'Basic integrations', icon: Zap },
        { text: 'Email support', icon: Mail }
      ]
    },
    {
      name: 'startup',
      displayName: 'Startup',
      priceMonthly: 12,
      priceAnnual: 120,
      maxDeals: 'Unlimited',
      maxUsers: 5,
      aiRequests: 1000,
      description: 'Perfect for small teams scaling up',
      popular: true,
      features: [
        { text: 'Unlimited deals', icon: Check },
        { text: '2-5 team members', icon: Users },
        { text: '1,000 AI requests/month', icon: Sparkles, highlight: true },
        { text: 'Advanced analytics & charts', icon: BarChart3 },
        { text: 'All integrations', icon: Zap },
        { text: 'Priority email support', icon: Mail },
        { text: 'Custom workflows', icon: Workflow }
      ]
    },
    {
      name: 'growth',
      displayName: 'Growth',
      priceMonthly: 24,
      priceAnnual: 240,
      maxDeals: 'Unlimited',
      maxUsers: 20,
      aiRequests: 5000,
      description: 'Scale your revenue with AI-driven insights',
      features: [
        { text: 'Everything in Startup', icon: Check },
        { text: '6-20 team members', icon: Users },
        { text: '5,000 AI requests/month', icon: Sparkles, highlight: true },
        { text: 'Advanced analytics & reports', icon: BarChart3 },
        { text: 'API access', icon: Zap },
        { text: 'Onboarding support', icon: Mail },
        { text: 'Extended workflows', icon: Workflow }
      ]
    },
    {
      name: 'pro',
      displayName: 'Pro / Scale',
      priceMonthly: 40,
      priceAnnual: 400,
      maxDeals: 'Unlimited',
      maxUsers: 'Unlimited',
      aiRequests: 'Unlimited',
      description: 'For established businesses at scale',
      features: [
        { text: 'Everything in Growth', icon: Check },
        { text: '21+ team members', icon: Users },
        { text: 'Unlimited AI requests', icon: Sparkles, highlight: true },
        { text: 'White-label branding', icon: Shield },
        { text: 'Unlimited workflows', icon: Workflow },
        { text: 'Premium support', icon: Mail },
        { text: 'Dedicated success manager', icon: Users }
      ]
    }
  ], []); // Empty deps - plans never change

  const handleUpgrade = async (planName) => {
    setLoadingTier(planName);

    try {
      // Validate organization exists first
      if (!organizationId) {
        throw new Error('Organization not loaded. Please refresh the page and try again.');
      }

      // CRITICAL FIX: Use master billingInterval instead of per-plan toggle
      // This ensures ONE toggle controls ALL plan CTAs for consistent UX
      const interval = billingInterval;

      logger.log('Starting upgrade:', { organizationId, tier: planName, interval });

      // NEXT-LEVEL: Use centralized API client with automatic retry + timeout
      // Replaces manual fetch() with resilient payment endpoint (20s timeout, 1 retry max)
      const { data: responseData } = await api.payment('create-checkout-session', {
        organizationId,
        tier: planName,
        billingInterval: interval
      });

      logger.log('Checkout response:', responseData);

      // FIX v1.7.61 (#1): Better error handling - check for both sessionId and url
      if (!responseData || !responseData.sessionId || !responseData.url) {
        throw new Error(
          'Invalid checkout session response. ' +
          'Please check your billing configuration or contact support.'
        );
      }

      // CRITICAL FIX: stripe.redirectToCheckout() deprecated in API version 2025-09-30
      // Use direct URL redirect instead
      logger.log('Redirecting to Stripe checkout URL:', responseData.url);

      // Redirect to Stripe Checkout
      window.location.href = responseData.url;

    } catch (error) {
      // FIX v1.7.63 - E3: Deep backend error logging for Stripe checkout failures
      logger.error('❌ Upgrade error:', error);
      logger.error('Error details:', error.message);
      logger.error('Error name:', error.name);
      logger.error('Error stack:', error.stack);

      // FIX v1.7.61 (#1): Show parsed error details from backend if available
      if (error.data) {
        logger.error('Backend error data:', error.data);
        logger.error('Backend error type:', typeof error.data);
        logger.error('Backend error keys:', Object.keys(error.data));
      }

      // FIX v1.7.63 - E3: Log HTTP response details if available
      if (error.response) {
        logger.error('HTTP response status:', error.response.status);
        logger.error('HTTP response statusText:', error.response.statusText);
        logger.error('HTTP response headers:', error.response.headers);
      }

      // FIX v1.7.63 - E3: Log request details for debugging
      // CRITICAL FIX v1.7.88: Changed 'tier' to 'planName' (correct variable name)
      // CRITICAL FIX v1.7.92: Use organizationId prop (not organization object) - organization and user don't exist in scope
      logger.error('Failed Stripe checkout request context:', {
        tier: planName,
        interval: billingInterval,
        organizationId: organizationId, // FIX: Use prop directly (organization object not in scope)
        timestamp: new Date().toISOString()
      });

      // NEXT-LEVEL: Use enhanced error properties from api-client
      // FIX: Prioritize error.data.error for backend-specific messages
      const userMessage =
        error.data?.error ||
        error.data?.message ||
        error.userMessage ||
        error.message ||
        'Failed to start upgrade. Please try again.';

      // FIX v1.7.63 - E3: Show more specific error for 500 errors
      const displayMessage = error.response?.status === 500
        ? `Server error while creating checkout session. Please check logs or contact support. Error: ${userMessage}`
        : userMessage;

      alert(displayMessage);
    } finally {
      setLoadingTier(null);
    }
  };

  // CRITICAL FIX: Master toggle for all plans
  // One toggle controls ALL plan CTAs for consistent user experience
  const handleMasterToggle = () => {
    const newInterval = billingInterval === 'annual' ? 'monthly' : 'annual';
    setBillingInterval(newInterval);
  };

  const calculateSavings = (monthly, annual) => {
    const monthlyCost = monthly * 12;
    const savings = monthlyCost - annual;
    const percentage = monthlyCost > 0 ? Math.round((savings / monthlyCost) * 100) : 0;
    return { amount: savings, percentage };
  };

  // Calculate usage percentages
  const dealsPercentage = dealsLimit === 'Unlimited' || dealsLimit === 0 ? 0 : Math.round((dealsUsed / dealsLimit) * 100);
  const aiPercentage = (aiRequestsLimit === -1 || aiRequestsLimit === 'Unlimited' || aiRequestsLimit <= 0) ? 0 : Math.round((aiRequestsUsed / aiRequestsLimit) * 100);
  const isApproachingLimit = dealsPercentage > 80 || aiPercentage > 80;

  return (
    <div className="space-y-6">
      {/* Enhanced Current Plan Badge with Usage Metrics */}
      <div className="bg-gradient-to-r from-[#1ABC9C] to-[#16A085] text-white rounded-2xl shadow-xl overflow-hidden">
        <div className="p-6">
          <div className="flex items-start justify-between mb-4">
            <div>
              <p className="text-sm opacity-90 mb-1">Current Plan</p>
              <h3 className="text-3xl font-bold capitalize flex items-center gap-2">
                {currentPlan || 'Free'}
                {currentPlan === 'startup' && <Sparkles className="w-6 h-6" />}
              </h3>
            </div>
            <Shield className="w-10 h-10 opacity-75" />
          </div>

          {/* Usage Metrics Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6">
            {/* Deals Usage */}
            <div className="bg-white/10 backdrop-blur-sm rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs opacity-90 font-medium">Deals</span>
                <span className="text-xs font-bold">{dealsUsed}/{dealsLimit}</span>
              </div>
              {dealsLimit !== 'Unlimited' && (
                <div className="w-full h-2 bg-white/20 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${
                      dealsPercentage > 90 ? 'bg-red-400' : dealsPercentage > 80 ? 'bg-yellow-400' : 'bg-white'
                    }`}
                    style={{ width: `${dealsPercentage}%` }}
                  />
                </div>
              )}
              {dealsLimit === 'Unlimited' && (
                <p className="text-xs opacity-75 mt-1">Unlimited</p>
              )}
            </div>

            {/* Users */}
            <div className="bg-white/10 backdrop-blur-sm rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs opacity-90 font-medium flex items-center gap-1">
                  <Users className="w-3 h-3" /> Users
                </span>
                <span className="text-xs font-bold">{usersUsed}/{usersLimit}</span>
              </div>
              <p className="text-xs opacity-75">{usersLimit === 'Unlimited' ? 'Unlimited seats' : `${usersLimit - usersUsed} seats available`}</p>
            </div>

            {/* AI Requests */}
            <div className="bg-white/10 backdrop-blur-sm rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs opacity-90 font-medium flex items-center gap-1">
                  <Sparkles className="w-3 h-3" /> AI Requests
                </span>
                <span className="text-xs font-bold">{aiRequestsUsed}/{aiRequestsLimit === -1 || aiRequestsLimit === 'Unlimited' ? '∞' : aiRequestsLimit}</span>
              </div>
              {aiRequestsLimit !== -1 && aiRequestsLimit !== 'Unlimited' && (
                <div className="w-full h-2 bg-white/20 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${
                      aiPercentage > 90 ? 'bg-red-400' : aiPercentage > 80 ? 'bg-yellow-400' : 'bg-white'
                    }`}
                    style={{ width: `${aiPercentage}%` }}
                  />
                </div>
              )}
              {(aiRequestsLimit === -1 || aiRequestsLimit === 'Unlimited') && (
                <p className="text-xs opacity-75 mt-1">Unlimited requests</p>
              )}
            </div>
          </div>

          {/* Upgrade Prompt if Approaching Limits */}
          {isApproachingLimit && (
            <div className="mt-4 bg-white/10 backdrop-blur-sm rounded-lg p-3 flex items-start gap-2">
              <TrendingUp className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <p className="text-xs opacity-90">
                You're approaching your plan limits. Consider upgrading for unlimited access.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Manage Subscription Button (for paid plans only) */}
      {currentPlan && currentPlan !== 'free' && (
        <div className="flex justify-center mb-6">
          <button
            onClick={async () => {
              if (!organizationId) {
                alert('Organization not loaded. Please refresh the page.');
                return;
              }

              setLoadingTier('portal');
              try {
                logger.log('Opening billing portal:', { organizationId });

                // CRITICAL FIX v1.7.84: Access Stripe billing portal for subscription management
                const { data: responseData } = await api.payment('create-portal-session', {
                  organizationId
                });

                if (!responseData || !responseData.url) {
                  throw new Error('Failed to create portal session. Please contact support.');
                }

                // Redirect to Stripe billing portal
                window.location.href = responseData.url;
              } catch (error) {
                logger.error('Portal error:', error);
                const userMessage = error.data?.error || error.userMessage || error.message || 'Failed to open billing portal';
                alert(userMessage);
              } finally {
                setLoadingTier(null);
              }
            }}
            disabled={loadingTier === 'portal'}
            className="flex items-center gap-2 px-6 py-3 bg-white dark:bg-[#0D1F2D] border-2 border-[#1ABC9C] text-[#1ABC9C] rounded-xl font-semibold hover:bg-[#1ABC9C] hover:text-white transition shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loadingTier === 'portal' ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Opening Portal...
              </>
            ) : (
              <>
                <CreditCard className="w-5 h-5" />
                Manage Subscription
              </>
            )}
          </button>
        </div>
      )}

      {/* Master Billing Toggle */}
      <div className="flex justify-center mb-8">
        <div className="bg-white dark:bg-[#0D1F2D] rounded-2xl shadow-lg p-4 border-2 border-[#E5E7EB] dark:border-[#1E3A4C]">
          <div className="flex items-center gap-4">
            <span className={`text-sm font-semibold ${billingInterval === 'monthly' ? 'text-[#1ABC9C]' : 'text-[#6B7280] dark:text-[#9CA3AF]'}`}>
              Monthly Billing
            </span>
            <button
              onClick={handleMasterToggle}
              className={`relative w-14 h-7 rounded-full transition-colors ${
                billingInterval === 'annual' ? 'bg-[#1ABC9C]' : 'bg-[#D1D5DB] dark:bg-[#374151]'
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-6 h-6 bg-white rounded-full shadow-md transition-transform ${
                  billingInterval === 'annual' ? 'translate-x-7' : 'translate-x-0'
                }`}
              />
            </button>
            <span className={`text-sm font-semibold ${billingInterval === 'annual' ? 'text-[#1ABC9C]' : 'text-[#6B7280] dark:text-[#9CA3AF]'}`}>
              Annual Billing
            </span>
            {billingInterval === 'annual' && (
              <span className="ml-2 px-3 py-1 bg-[#1ABC9C]/10 text-[#1ABC9C] text-xs font-bold rounded-full flex items-center gap-1">
                <TrendingUp className="w-3 h-3" />
                Save up to 17%
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Pricing Cards */}
      <div className="grid lg:grid-cols-4 md:grid-cols-2 gap-6 mt-6">
        {plans.map((plan) => {
          const isAnnual = billingInterval === 'annual';
          const price = isAnnual ? plan.priceAnnual : plan.priceMonthly;
          const savings = plan.name !== 'free' ? calculateSavings(plan.priceMonthly, plan.priceAnnual) : { amount: 0, percentage: 0 };
          const monthlyEquivalent = isAnnual && plan.name !== 'free' ? (plan.priceAnnual / 12).toFixed(0) : null;
          const isFree = plan.name === 'free';

          // Determine if this card should be highlighted
          const isHighlighted = hoveredPlan ? hoveredPlan === plan.name : plan.popular;
          const isHovered = hoveredPlan === plan.name;

          return (
            <div
              key={plan.name}
              onMouseEnter={() => setHoveredPlan(plan.name)}
              onMouseLeave={() => setHoveredPlan(null)}
              className={`relative bg-white dark:bg-[#0D1F2D] rounded-2xl shadow-lg p-6 border-2 transition-all ${
                isHighlighted
                  ? 'border-[#1ABC9C] shadow-[#1ABC9C]/20'
                  : 'border-[#E5E7EB] dark:border-[#1E3A4C]'
              } ${
                isHovered
                  ? 'scale-105'
                  : 'scale-100'
              } hover:scale-105`}
            >
              {plan.popular && (
                <div className="absolute -top-4 left-1/2 -translate-x-1/2">
                  <span className="bg-gradient-to-r from-[#1ABC9C] to-[#16A085] text-white px-4 py-1 rounded-full text-xs font-bold shadow-lg flex items-center gap-1">
                    <Sparkles className="w-3 h-3" />
                    MOST POPULAR
                  </span>
                </div>
              )}

              {/* Plan Header */}
              <div className="text-center mb-6">
                <h3 className="text-xl font-bold text-[#1A1A1A] dark:text-[#E0E0E0] mb-1">
                  {plan.displayName}
                </h3>
                <p className="text-xs text-[#6B7280] dark:text-[#9CA3AF] mb-4">
                  {plan.description}
                </p>

                {/* Pricing Display */}
                <div className="mb-2">
                  {isFree ? (
                    <div>
                      <span className="text-4xl font-bold text-[#1A1A1A] dark:text-[#E0E0E0]">
                        Free
                      </span>
                      <p className="text-xs text-[#6B7280] dark:text-[#9CA3AF] mt-1">
                        Forever
                      </p>
                    </div>
                  ) : (
                    <>
                      <span className="text-4xl font-bold text-[#1A1A1A] dark:text-[#E0E0E0]">
                        ${isAnnual ? monthlyEquivalent : price}
                      </span>
                      <span className="text-[#6B7280] dark:text-[#9CA3AF]">
                        /month
                      </span>
                    </>
                  )}
                </div>

                {isAnnual && !isFree && savings.amount > 0 && (
                  <div className="space-y-1">
                    <div className="flex items-center justify-center gap-1 text-[#1ABC9C] font-semibold text-xs">
                      <TrendingUp className="w-3 h-3" />
                      Save ${savings.amount}/year ({savings.percentage}% off)
                    </div>
                    <p className="text-[10px] text-[#6B7280] dark:text-[#9CA3AF]">
                      ${plan.priceAnnual} billed annually
                    </p>
                  </div>
                )}
              </div>

              {/* Features List with Icons */}
              <ul className="space-y-2.5 mb-6">
                {plan.features.map((feature, idx) => {
                  const FeatureIcon = feature.icon || Check;
                  return (
                    <li key={idx} className="flex items-start gap-2 text-sm">
                      <FeatureIcon
                        className={`w-4 h-4 flex-shrink-0 mt-0.5 ${
                          feature.highlight
                            ? 'text-[#F39C12]'
                            : 'text-[#1ABC9C]'
                        }`}
                      />
                      <span className={`text-[#4B5563] dark:text-[#9CA3AF] ${feature.highlight ? 'font-medium' : ''}`}>
                        {feature.text}
                      </span>
                    </li>
                  );
                })}
              </ul>

              {/* CTA Button */}
              <button
                onClick={() => handleUpgrade(plan.name)}
                disabled={loadingTier === plan.name || currentPlan === plan.name || isFree || !organizationId}
                className={`w-full py-3 rounded-lg font-semibold hover:shadow-lg transition disabled:cursor-not-allowed flex items-center justify-center gap-2 ${
                  isFree
                    ? 'bg-[#E5E7EB] dark:bg-[#374151] text-[#6B7280] dark:text-[#9CA3AF] cursor-default'
                    : currentPlan === plan.name
                    ? 'bg-[#E5E7EB] dark:bg-[#374151] text-[#6B7280] dark:text-[#9CA3AF] opacity-50'
                    : !organizationId
                    ? 'bg-[#E5E7EB] dark:bg-[#374151] text-[#6B7280] dark:text-[#9CA3AF] opacity-50'
                    : 'bg-gradient-to-r from-[#1ABC9C] to-[#16A085] text-white'
                }`}
                title={!organizationId ? 'Loading workspace...' : ''}
              >
                {loadingTier === plan.name ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Processing...</>
                ) : currentPlan === plan.name ? (
                  <><Check className="w-4 h-4" /> Current Plan</>
                ) : isFree ? (
                  'Already Active'
                ) : !organizationId ? (
                  'Loading workspace...'
                ) : (
                  `Upgrade to ${plan.displayName}`
                )}
              </button>
            </div>
          );
        })}
      </div>

      {/* Helper Text & Trust Indicators */}
      <div className="space-y-4 mt-8">
        <div className="text-center text-xs text-[#6B7280] dark:text-[#9CA3AF]">
          💡 Pro tip: Hold Shift while toggling to sync all plans
        </div>

        {/* Trust Indicators */}
        <div className="flex flex-wrap items-center justify-center gap-6 py-6 px-4 bg-gradient-to-r from-[#F9FAFB] to-[#E5E7EB] dark:from-[#0D1F2D] dark:to-[#1E3A4C] rounded-xl">
          <div className="flex items-center gap-2">
            <CheckCircle className="w-5 h-5 text-[#1ABC9C]" />
            <span className="text-xs font-medium text-[#4B5563] dark:text-[#9CA3AF]">
              Free Plan Available
            </span>
          </div>
          <div className="flex items-center gap-2">
            <RefreshCw className="w-5 h-5 text-[#3A86FF]" />
            <span className="text-xs font-medium text-[#4B5563] dark:text-[#9CA3AF]">
              Cancel Anytime
            </span>
          </div>
          <div className="flex items-center gap-2">
            <CreditCard className="w-5 h-5 text-[#F39C12]" />
            <span className="text-xs font-medium text-[#4B5563] dark:text-[#9CA3AF]">
              No Credit Card Required
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-[#27AE60]" />
            <span className="text-xs font-medium text-[#4B5563] dark:text-[#9CA3AF]">
              Start in 60 Seconds
            </span>
          </div>
        </div>

        {/* CTA for Enterprise */}
        <div className="text-center p-6 bg-white dark:bg-[#0D1F2D] rounded-xl border-2 border-dashed border-[#E5E7EB] dark:border-[#1E3A4C]">
          <h4 className="text-lg font-bold text-[#1A1A1A] dark:text-[#E0E0E0] mb-2">
            Need More? Enterprise Plans Available
          </h4>
          <p className="text-sm text-[#6B7280] dark:text-[#9CA3AF] mb-4">
            Custom pricing for 50+ users, compliance requirements, and dedicated support
          </p>
          <a
            href="mailto:support@startupstage.com"
            className="inline-flex items-center gap-2 bg-[#6B7280] hover:bg-[#4B5563] text-white px-6 py-3 rounded-lg font-semibold transition"
          >
            <Mail className="w-4 h-4" />
            Contact Sales
          </a>
        </div>
      </div>
    </div>
  );
};

export default BillingSettings;
