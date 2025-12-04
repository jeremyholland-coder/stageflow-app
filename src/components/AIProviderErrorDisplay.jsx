import React from 'react';
import { AlertTriangle, ExternalLink, RefreshCw, Sparkles, CheckCircle, ArrowRight } from 'lucide-react';

/**
 * PHASE 4: AI Provider Error Display
 *
 * A detailed error display component for AI provider failures.
 * Shows per-provider error messages with dashboard links,
 * and displays the fallback plan when AI is unavailable.
 *
 * @author StageFlow Engineering
 * @since 2025-12-04
 */

/**
 * Provider display names and colors
 */
const PROVIDER_CONFIG = {
  openai: {
    name: 'OpenAI (ChatGPT)',
    color: 'text-emerald-400',
    bgColor: 'bg-emerald-500/10',
    borderColor: 'border-emerald-500/20'
  },
  anthropic: {
    name: 'Anthropic (Claude)',
    color: 'text-amber-400',
    bgColor: 'bg-amber-500/10',
    borderColor: 'border-amber-500/20'
  },
  google: {
    name: 'Google (Gemini)',
    color: 'text-blue-400',
    bgColor: 'bg-blue-500/10',
    borderColor: 'border-blue-500/20'
  }
};

/**
 * Error code to user-friendly description mapping
 */
const ERROR_DESCRIPTIONS = {
  INSUFFICIENT_QUOTA: 'API quota exceeded',
  BILLING_REQUIRED: 'Billing/credits required',
  MODEL_NOT_FOUND: 'Model not available',
  RATE_LIMIT: 'Rate limited',
  AUTH_ERROR: 'Authentication failed',
  INVALID_KEY: 'Invalid API key',
  NETWORK_ERROR: 'Connection failed',
  TIMEOUT: 'Request timed out',
  SERVICE_UNAVAILABLE: 'Service unavailable'
};

/**
 * Single provider error row
 */
const ProviderErrorRow = ({ provider, code, message, dashboardUrl }) => {
  const config = PROVIDER_CONFIG[provider] || {
    name: provider,
    color: 'text-white/70',
    bgColor: 'bg-white/5',
    borderColor: 'border-white/10'
  };

  const errorDesc = ERROR_DESCRIPTIONS[code] || code || 'Error';

  return (
    <div className={`flex items-start gap-3 px-3 py-2.5 rounded-lg ${config.bgColor} border ${config.borderColor}`}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className={`text-xs font-semibold ${config.color}`}>
            {config.name}
          </span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-white/50 uppercase">
            {errorDesc}
          </span>
        </div>
        <p className="text-xs text-white/60 mt-1 line-clamp-2">
          {message}
        </p>
      </div>
      {dashboardUrl && (
        <a
          href={dashboardUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 text-[10px] text-white/50 hover:text-white/80 whitespace-nowrap px-2 py-1 rounded bg-white/5 hover:bg-white/10 transition-colors"
        >
          Open dashboard
          <ExternalLink className="w-3 h-3" />
        </a>
      )}
    </div>
  );
};

/**
 * Fallback plan display component
 */
const FallbackPlanDisplay = ({ plan }) => {
  if (!plan) return null;

  return (
    <div className="mt-4 pt-4 border-t border-white/10">
      <div className="flex items-center gap-2 mb-3">
        <Sparkles className="w-4 h-4 text-[#0CE3B1]" />
        <span className="text-sm font-medium text-white">
          {plan.headline || "Here's your pipeline at a glance"}
        </span>
        <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#0CE3B1]/10 text-[#0CE3B1] border border-[#0CE3B1]/20">
          No-AI Mode
        </span>
      </div>

      {/* Bullets */}
      {plan.bullets && plan.bullets.length > 0 && (
        <ul className="space-y-1.5 mb-4">
          {plan.bullets.map((bullet, idx) => (
            <li key={idx} className="flex items-start gap-2 text-xs text-white/70">
              <CheckCircle className="w-3.5 h-3.5 text-[#0CE3B1] mt-0.5 flex-shrink-0" />
              <span>{bullet}</span>
            </li>
          ))}
        </ul>
      )}

      {/* Recommended Actions */}
      {plan.recommendedActions && plan.recommendedActions.length > 0 && (
        <div className="space-y-2">
          <span className="text-[10px] uppercase tracking-wider text-white/40 font-semibold">
            Recommended Actions
          </span>
          {plan.recommendedActions.slice(0, 3).map((action, idx) => (
            <div
              key={idx}
              className={`flex items-start gap-2 px-3 py-2 rounded-lg border ${
                action.priority === 'high'
                  ? 'bg-rose-500/5 border-rose-500/20'
                  : action.priority === 'medium'
                  ? 'bg-amber-500/5 border-amber-500/20'
                  : 'bg-white/5 border-white/10'
              }`}
            >
              <ArrowRight className={`w-3.5 h-3.5 mt-0.5 flex-shrink-0 ${
                action.priority === 'high' ? 'text-rose-400' :
                action.priority === 'medium' ? 'text-amber-400' : 'text-white/50'
              }`} />
              <div className="flex-1 min-w-0">
                <p className="text-xs text-white/90 font-medium">{action.action}</p>
                {action.reason && (
                  <p className="text-[10px] text-white/50 mt-0.5">{action.reason}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

/**
 * Main AI Provider Error Display component
 */
export const AIProviderErrorDisplay = ({
  message,
  providerErrors = [],
  fallbackPlan,
  onRetry,
  onDismiss,
  className = ''
}) => {
  const hasProviderErrors = providerErrors && providerErrors.length > 0;

  return (
    <div className={`bg-rose-500/5 border border-rose-500/20 rounded-xl p-4 ${className}`}>
      {/* Header */}
      <div className="flex items-start gap-3 mb-4">
        <AlertTriangle className="w-5 h-5 text-rose-400 flex-shrink-0 mt-0.5" />
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-rose-300">
            AI Providers Unavailable
          </h3>
          <p className="text-xs text-rose-200/80 mt-1">
            {message || 'Your AI providers are currently failing due to quota, billing, or configuration issues.'}
          </p>
        </div>
        {onRetry && (
          <button
            onClick={onRetry}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-rose-400 hover:text-rose-300 bg-rose-500/10 hover:bg-rose-500/20 transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Retry
          </button>
        )}
      </div>

      {/* Provider-specific errors */}
      {hasProviderErrors && (
        <div className="space-y-2 mb-4">
          <span className="text-[10px] uppercase tracking-wider text-white/40 font-semibold">
            Provider Status
          </span>
          {providerErrors.map((err, idx) => (
            <ProviderErrorRow
              key={idx}
              provider={err.provider}
              code={err.code}
              message={err.message}
              dashboardUrl={err.dashboardUrl}
            />
          ))}
        </div>
      )}

      {/* Fallback plan */}
      {fallbackPlan && (
        <FallbackPlanDisplay plan={fallbackPlan} />
      )}

      {/* Help text */}
      <p className="text-[10px] text-white/40 mt-4">
        Visit the provider dashboard links above to check your billing status and API configuration.
        After updating, click Retry to try again.
      </p>
    </div>
  );
};

/**
 * Compact version for tighter spaces
 */
export const AIProviderErrorCompact = ({
  message,
  providerErrors = [],
  onRetry
}) => {
  // Get the most important error
  const mainError = providerErrors[0];
  const errorCount = providerErrors.length;

  return (
    <div className="flex items-center gap-3 px-4 py-3 bg-rose-500/5 border border-rose-500/20 rounded-xl">
      <AlertTriangle className="w-4 h-4 text-rose-400 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm text-rose-200">
          {mainError?.message || message || 'AI providers unavailable'}
        </p>
        {errorCount > 1 && (
          <p className="text-[10px] text-rose-300/60 mt-0.5">
            +{errorCount - 1} more provider{errorCount > 2 ? 's' : ''} also failing
          </p>
        )}
      </div>
      {mainError?.dashboardUrl && (
        <a
          href={mainError.dashboardUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-rose-400 hover:text-rose-300 flex items-center gap-1"
        >
          Fix
          <ExternalLink className="w-3 h-3" />
        </a>
      )}
      {onRetry && (
        <button
          onClick={onRetry}
          className="text-xs text-rose-400 hover:text-rose-300 flex items-center gap-1"
        >
          <RefreshCw className="w-3 h-3" />
        </button>
      )}
    </div>
  );
};

export default AIProviderErrorDisplay;
