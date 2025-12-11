import React, { useState, useEffect, useCallback } from 'react';
import {
  Sparkles, Check, X, Loader2, AlertCircle,
  Eye, EyeOff, ExternalLink, Zap, Lock
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useApp } from './AppShell';
import { api } from '../lib/api-client';

// AI Provider Logo Components
const OpenAILogo = () => (
  <svg viewBox="0 0 24 24" className="w-full h-full" fill="currentColor">
    <path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.896zm16.597 3.855l-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08-4.778 2.758a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z"/>
  </svg>
);

const ClaudeLogo = () => (
  <svg viewBox="0 0 50 50" className="w-full h-full" fill="currentColor">
    <path d="M19.861,27.625v-0.716l-16.65-0.681L2.07,25.985 L1,24.575l0.11-0.703l0.959-0.645l17.95,1.345l0.11-0.314L5.716,14.365l-0.729-0.924l-0.314-2.016L5.985,9.98l2.214,0.24 l11.312,8.602l0.327-0.353L12.623,5.977c0,0-0.548-2.175-0.548-2.697l1.494-2.029l0.827-0.266l2.833,0.995l7.935,17.331h0.314 l1.348-14.819l0.752-1.822l1.494-0.985l1.167,0.557l0.959,1.374l-2.551,14.294h0.425l0.486-0.486l8.434-10.197l1.092-0.862h2.065 l1.52,2.259l-0.681,2.334l-7.996,11.108l0.146,0.217l0.376-0.036l12.479-2.405l1.666,0.778l0.182,0.791l-0.655,1.617l-15.435,3.523 l-0.084,0.062l0.097,0.12l13.711,0.814l1.578,1.044L49,29.868l-0.159,0.972l-2.431,1.238l-13.561-3.254h-0.363v0.217l11.218,10.427 l0.256,1.154l-0.645,0.911l-0.681-0.097l-9.967-8.058h-0.256v0.34l5.578,8.35l0.243,2.162l-0.34,0.703l-1.215,0.425l-1.335-0.243 l-7.863-12.083l-0.279,0.159l-1.348,14.524l-0.632,0.742l-1.459,0.558l-1.215-0.924L21.9,46.597l2.966-14.939l-0.023-0.084 l-0.279,0.036L13.881,45.138l-0.827,0.327l-1.433-0.742l0.133-1.326l0.801-1.18l9.52-12.019l-0.013-0.314h-0.11l-12.69,8.239 l-2.259,0.292L6.03,37.505l0.12-1.494l0.46-0.486L19.861,27.625z"/>
  </svg>
);

const GeminiLogo = () => (
  <svg viewBox="0 0 50 50" className="w-full h-full" fill="currentColor">
    <path d="M49.04,24.001l-1.082-0.043h-0.001C36.134,23.492,26.508,13.866,26.042,2.043L25.999,0.96C25.978,0.424,25.537,0,25,0 s-0.978,0.424-0.999,0.96l-0.043,1.083C23.492,13.866,13.866,23.492,2.042,23.958L0.96,24.001C0.424,24.022,0,24.463,0,25 c0,0.537,0.424,0.978,0.961,0.999l1.082,0.042c11.823,0.467,21.449,10.093,21.915,21.916l0.043,1.083C24.022,49.576,24.463,50,25,50 s0.978-0.424,0.999-0.96l0.043-1.083c0.466-11.823,10.092-21.449,21.915-21.916l1.082-0.042C49.576,25.978,50,25.537,50,25 C50,24.463,49.576,24.022,49.04,24.001z"/>
  </svg>
);

// AI Provider configurations
const AI_PROVIDERS = [
  {
    id: 'openai',
    name: 'OpenAI',
    displayName: 'ChatGPT',
    Logo: OpenAILogo,
    color: '#10A37F',
    description: 'Latest GPT models',
    signupUrl: 'https://platform.openai.com/api-keys',
    docsUrl: 'https://platform.openai.com/docs'
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    displayName: 'Claude',
    Logo: ClaudeLogo,
    color: '#D97757',
    description: 'Latest Claude models',
    signupUrl: 'https://console.anthropic.com/',
    docsUrl: 'https://docs.anthropic.com'
  },
  {
    id: 'google',
    name: 'Google',
    displayName: 'Gemini',
    Logo: GeminiLogo,
    color: '#4285F4',
    description: 'Latest Gemini models',
    signupUrl: 'https://makersuite.google.com/app/apikey',
    docsUrl: 'https://ai.google.dev/docs'
  }
];

// CRITICAL FIX: ProviderCard must be defined OUTSIDE AISettings to prevent React error #310
const ProviderCard = ({ provider, isProviderConnected, getConnectedProvider, handleConnectProvider, handleRemoveProvider }) => {
  if (!provider) {
    console.error('ProviderCard received undefined provider');
    return null;
  }

  const connected = isProviderConnected(provider.id);
  const connectedData = getConnectedProvider(provider.id);
  const isDisabled = provider.badge === 'Coming Soon';
  const Logo = provider.Logo;

  return (
    <div
      className={`relative bg-gradient-to-br from-gray-900 to-black rounded-2xl p-6 border transition-all duration-300 shadow-2xl h-full flex flex-col ${
        connected
          ? 'border-teal-500 shadow-teal-500/40 hover:shadow-teal-500/60'
          : 'border-teal-500/30 hover:border-teal-500/50 hover:shadow-teal-500/20'
      } ${isDisabled ? 'opacity-50' : ''}`}
      style={{
        // CRITICAL: Ensure cards are clearly visible during onboarding spotlight
        position: 'relative',
        zIndex: 43
      }}
    >
      {/* CRITICAL: Brightness overlay to make cards pop during onboarding */}
      <div
        className="absolute inset-0 rounded-2xl pointer-events-none"
        style={{
          background: 'radial-gradient(circle at center, rgba(255, 255, 255, 0.08) 0%, rgba(255, 255, 255, 0.04) 50%, transparent 100%)',
          mixBlendMode: 'overlay'
        }}
      />

      {/* Header section */}
      <div className="flex items-start justify-between mb-4 relative z-10">
        <div className="flex items-center gap-3">
          <div
            className="w-12 h-12 rounded-xl flex items-center justify-center bg-gray-800/50 border border-gray-700 p-2.5 shadow-lg backdrop-blur-sm"
            style={{ color: provider.color }}
          >
            <Logo />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h4 className="font-bold text-white">
                {provider.displayName}
              </h4>
              {provider.badge && (
                <span className="px-2 py-0.5 bg-[#F39C12]/10 text-[#F39C12] text-xs font-semibold rounded-full">
                  {provider.badge}
                </span>
              )}
            </div>
            <p className="text-sm text-gray-400">
              {provider.description}
            </p>
          </div>
        </div>
        {connected && (
          <div className="flex items-center gap-1 px-2 py-1 bg-teal-500/20 text-teal-400 rounded-full ring-1 ring-teal-500/30">
            <Check className="w-3 h-3" />
            <span className="text-xs font-semibold">Connected</span>
          </div>
        )}
      </div>

      {/* Body + Footer wrapper - flex-1 pushes footer to bottom */}
      {connected ? (
        <div className="flex-1 flex flex-col justify-between relative z-10">
          {/* Body: Key info */}
          <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-3 backdrop-blur-sm">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Lock className="w-4 h-4 text-teal-400" />
                <div>
                  <p className="text-sm font-medium text-white">Key configured</p>
                  <p className="text-xs text-gray-400">Stored securely • Not shown again</p>
                </div>
              </div>
              <span className="text-xs text-gray-400">
                Added {new Date(connectedData?.created_at).toLocaleDateString()}
              </span>
            </div>
          </div>
          {/* Footer: Action buttons */}
          <div className="flex gap-2 mt-4">
            <button
              onClick={() => handleRemoveProvider(provider.id)}
              className="flex-1 px-4 py-2 border border-red-500/50 text-red-400 rounded-lg hover:bg-red-500/10 hover:border-red-500 transition-all text-sm font-medium"
            >
              Remove
            </button>
            <a
              href={provider.docsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 px-4 py-2 border border-gray-700 text-gray-400 hover:text-white rounded-lg hover:bg-gray-800 hover:border-gray-600 transition-all text-sm font-medium"
            >
              <ExternalLink className="w-4 h-4" />
              Docs
            </a>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col justify-between relative z-10">
          {/* Body: Helper text */}
          <div className="flex items-center gap-2 text-xs text-gray-400">
            <AlertCircle className="w-3 h-3" />
            <span>You'll need an API key from {provider.name}</span>
          </div>
          {/* Footer: Action buttons */}
          <div className="flex gap-2 mt-4">
            <button
              onClick={() => handleConnectProvider(provider)}
              disabled={isDisabled}
              className="flex-1 bg-teal-500 hover:bg-teal-600 text-white py-2 px-4 rounded-lg shadow-lg shadow-teal-500/20 hover:shadow-teal-500/40 transition-all duration-200 hover:scale-[1.02] active:scale-[0.98] font-medium disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
            >
              Connect
            </button>
            <a
              href={provider.signupUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 px-4 py-2 border border-gray-700 text-gray-400 hover:text-white rounded-lg hover:bg-gray-800 hover:border-gray-600 transition-all text-sm font-medium"
            >
              <ExternalLink className="w-4 h-4" />
              Get Key
            </a>
          </div>
        </div>
      )}
    </div>
  );
};

export const AISettings = () => {
  const { user, organization, addNotification } = useApp();
  const [providers, setProviders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState(null);
  // PHASE 20: Track removal in progress to prevent double-click
  const [removingProviderId, setRemovingProviderId] = useState(null);

  // FIX v1.7.80 (#2): Use useCallback to properly memoize fetchProviders
  // REASON: Prevents recreation on every render, fixes "Can't find variable" error
  // PHASE 8 CRITICAL FIX: Use backend endpoint instead of direct Supabase query
  // Phase 3 Cookie-Only Auth has persistSession: false, so auth.uid() is NULL
  // RLS policies block direct client queries. Backend uses service role.
  const fetchProviders = useCallback(async () => {
    if (!user || !organization) {
      setLoading(false);
      return;
    }

    console.warn('[AISettings] fetchProviders starting for org:', organization.id);

    try {
      // PHASE J: Use auth-aware api-client with Authorization header
      const { data: result, response } = await api.post('get-ai-providers', {
        organization_id: organization.id
      });

      if (!response.ok) {
        console.error('[AI Providers] Backend error:', {
          status: response.status,
          error: result.error,
          details: result.details
        });
        throw new Error(result.error || `Failed to fetch providers: ${response.status}`);
      }

      console.warn('[AISettings] fetchProviders got data:', {
        count: result.providers?.length || 0,
        providers: result.providers?.map(p => ({ id: p.id, type: p.provider_type, active: p.active })) || []
      });

      setProviders(result.providers || []);
    } catch (error) {
      console.error('[AI Providers] Failed to fetch AI providers:', {
        error,
        errorMessage: error.message,
        organizationId: organization?.id
      });
      // Show actual error message for debugging
      const errorMsg = error.message?.includes('AUTH_REQUIRED')
        ? 'Please log in to view AI providers.'
        : error.message
        ? `Failed to load AI providers: ${error.message}`
        : 'Failed to load AI providers';
      addNotification(errorMsg, 'error');
    } finally {
      setLoading(false);
    }
  }, [user, organization, addNotification]);

  useEffect(() => {
    fetchProviders();
  }, [fetchProviders]);

  const isProviderConnected = (providerId) => {
    return providers.some(p => p.provider_type === providerId);
  };

  const getConnectedProvider = (providerId) => {
    return providers.find(p => p.provider_type === providerId);
  };

  const handleConnectProvider = (providerConfig) => {
    setSelectedProvider(providerConfig);
    setShowAddModal(true);
  };

  // CRITICAL FIX: Use backend endpoint instead of direct Supabase client
  // Phase 3 Cookie-Only Auth has persistSession: false, so auth.uid() is NULL
  // RLS policies deny all client-side mutations. Backend has service role.
  const handleRemoveProvider = async (providerId) => {
    // PHASE 20: Prevent double-click - check if already removing this provider
    if (removingProviderId === providerId) {
      return;
    }

    if (!confirm('Remove this AI provider? You can reconnect it anytime.')) return;

    const provider = getConnectedProvider(providerId);
    if (!provider) return;

    // PHASE 20: Mark as removing to prevent double-click
    setRemovingProviderId(providerId);

    // PHASE 20: Optimistic UI - remove card instantly before server response
    const previousProviders = [...providers];
    const remainingProviders = providers.filter(p => p.id !== provider.id);
    setProviders(remainingProviders);

    // PHASE J: Use auth-aware api-client with Authorization header
    // api-client has built-in retry logic with network-aware configuration
    try {
      const { data: result, response } = await api.post('remove-ai-provider', {
        providerId: provider.id,
        organizationId: organization.id
      }, { maxRetries: 2 });

      if (!response.ok) {
        // Check for typed error responses
        if (result.code === 'ALREADY_REMOVED') {
          // Provider already removed - treat as success, continue below
        } else if (result.code === 'invalid_provider') {
          throw new Error('Invalid provider - it may have already been removed');
        } else {
          const errorMsg = typeof result.error === 'string'
            ? result.error
            : (result.error?.message || `Remove failed: ${response.status}`);
          throw new Error(errorMsg);
        }
      }

      // Success - update cache and dispatch event
      if (organization?.id) {
        const cacheKey = `ai_provider_${organization.id}`;
        const hasRemainingProviders = remainingProviders.length > 0;
        localStorage.setItem(cacheKey, JSON.stringify({
          hasProvider: hasRemainingProviders,
          timestamp: Date.now()
        }));
        sessionStorage.removeItem(cacheKey);

        // Dispatch event so Dashboard updates immediately
        window.dispatchEvent(new CustomEvent('ai-provider-removed', {
          detail: { providerId, organizationId: organization.id }
        }));
      }

      addNotification('AI provider removed', 'success');
      setRemovingProviderId(null);
      return; // Success - exit function

    } catch (error) {
      console.error('[AISettings] Remove failed:', error);
      // Rollback optimistic update on failure
      setProviders(previousProviders);
      setRemovingProviderId(null);
      addNotification(`Failed to remove provider: ${error?.message || 'Unknown error'}`, 'error');
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-[#1ABC9C]" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-gradient-to-r from-[#2C3E50]/10 via-[#34495E]/10 to-[#1ABC9C]/10 border border-[#1ABC9C]/20 rounded-xl p-6">
        <div className="flex items-start gap-4">
          <div className="p-3 bg-gradient-to-br from-[#2C3E50]/20 via-[#34495E]/20 to-[#1ABC9C]/20 rounded-xl">
            <Sparkles className="w-6 h-6 text-[#1ABC9C]" />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-bold text-[#1A1A1A] dark:text-[#E0E0E0] mb-2">
              AI-Powered Assistance
            </h3>
            <p className="text-sm text-[#6B7280] dark:text-[#9CA3AF] mb-4">
              Connect your AI providers to enable intelligent features like deal analysis, email drafting, and smart recommendations. Your API keys are encrypted and never shared.
            </p>
            <div className="flex items-center gap-4 text-xs text-[#6B7280] dark:text-[#9CA3AF]">
              <div className="flex items-center gap-1">
                <Zap className="w-3 h-3 text-[#1ABC9C]" />
                <span>Multi-provider support</span>
              </div>
              <div className="flex items-center gap-1">
                <Check className="w-3 h-3 text-[#1ABC9C]" />
                <span>Automatic failover</span>
              </div>
              <div className="flex items-center gap-1">
                <Lock className="w-3 h-3 text-[#1ABC9C]" />
                <span>Encrypted storage</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* CRITICAL: AI Providers Grid - Enhanced visibility for onboarding spotlight */}
      {/* Layout: 1-col mobile, 2-col tablet, 3-col desktop for uniform card display */}
      <div
        data-tour="ai-providers"
        className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 items-stretch relative z-10"
        style={{
          // FIX v1.7.61 (#6): Changed from z-[173] to z-10 to prevent cards overlapping navbar
          // Navbar is z-150, so cards must be lower. Onboarding spotlight handles elevation.
          isolation: 'isolate'
        }}
      >
        {AI_PROVIDERS && AI_PROVIDERS.length > 0 ? (
          AI_PROVIDERS.map(provider => (
            <ProviderCard
              key={provider?.id || Math.random()}
              provider={provider}
              isProviderConnected={isProviderConnected}
              getConnectedProvider={getConnectedProvider}
              handleConnectProvider={handleConnectProvider}
              handleRemoveProvider={handleRemoveProvider}
            />
          ))
        ) : (
          <div className="col-span-full flex flex-col items-center justify-center py-12 px-6">
            <div className="w-16 h-16 bg-gradient-to-br from-teal-500/20 to-teal-600/10 rounded-2xl flex items-center justify-center mb-4">
              <Sparkles className="w-8 h-8 text-teal-400" />
            </div>
            <h4 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
              No AI providers available
            </h4>
            <p className="text-sm text-gray-500 dark:text-gray-400 text-center max-w-sm">
              AI providers will appear here once configured. Contact your administrator if this seems incorrect.
            </p>
          </div>
        )}
      </div>

      {showAddModal && selectedProvider && (
        <AddProviderModal
          provider={selectedProvider}
          onClose={() => {
            setShowAddModal(false);
            setSelectedProvider(null);
          }}
          onSuccess={(savedProvider) => {
            // PHASE AI4 FIX: Immediately update local state with saved provider
            // Eliminates race condition - no need to wait for DB visibility
            if (savedProvider) {
              setProviders(prev => {
                // Check if this provider_type already exists (update case)
                const exists = prev.some(p => p.provider_type === savedProvider.provider_type);
                if (exists) {
                  return prev.map(p => p.provider_type === savedProvider.provider_type ? savedProvider : p);
                }
                return [...prev, savedProvider];
              });
            }
            // Fire-and-forget verification (don't await)
            fetchProviders();
          }}
        />
      )}
    </div>
  );
};

const AddProviderModal = ({ provider, onClose, onSuccess }) => {
  const { user, organization, addNotification } = useApp();
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);

  if (!provider) {
    console.error('AddProviderModal received undefined provider');
    onClose();
    return null;
  }

  const Logo = provider.Logo;

  // CRITICAL FIX: Future-proof validation patterns
  // Strategy: Minimal validation to catch obvious errors, let provider APIs be final authority
  const validateApiKey = (key, providerId) => {
    const trimmed = key.trim();
    if (!trimmed) return false;

    switch(providerId) {
      case 'openai':
        // OpenAI keys: Must start with sk- (old: sk-...T3BlbkFJ..., new: sk-proj-...)
        // Accept any sk- key with reasonable minimum length (20 chars)
        return trimmed.startsWith('sk-') && trimmed.length >= 20;

      case 'anthropic':
        // Anthropic/Claude keys: Must start with sk-ant-
        // Formats evolve: sk-ant-api03-..., sk-ant-sid01-..., sk-ant-...
        // FUTURE-PROOF: Only check prefix and minimum length, not internal structure
        return trimmed.startsWith('sk-ant-') && trimmed.length >= 20;

      case 'google':
        // Google AI Studio keys: AIza prefix + base62 chars
        // Length can vary, but typically 39-40 chars total
        return trimmed.startsWith('AIza') && trimmed.length >= 35;

      default:
        // Generic fallback: any non-empty string with reasonable length
        return trimmed.length >= 20;
    }
  };

  const handleSave = async () => {
    const trimmedKey = apiKey.trim();
    
    if (!trimmedKey) {
      addNotification('Please enter an API key', 'error');
      return;
    }

    if (!validateApiKey(trimmedKey, provider.id)) {
      addNotification(`Invalid ${provider.displayName} API key format`, 'error');
      return;
    }

    setSaving(true);

    try {
      // Save to backend (model is auto-selected by backend based on provider)
      const response = await api.post('save-ai-provider', {
        user_id: user.id,
        organization_id: organization.id,
        provider_type: provider.id,
        api_key: trimmedKey,
        display_name: provider.displayName
      }, {
        timeout: 10000
      });

      // Extract the saved provider data from response
      const savedProvider = response?.data?.provider;
      console.warn('[AISettings] Provider saved successfully:', {
        providerId: provider.id,
        organizationId: organization.id,
        savedProviderId: savedProvider?.id || 'no-id',
        savedProviderData: savedProvider
      });

      // AIWIRE-03 FIX: Set cache to hasProvider=true IMMEDIATELY
      // This ensures Dashboard's hook sees correct value even before DB query
      const cacheKey = `ai_provider_${organization.id}`;
      localStorage.setItem(cacheKey, JSON.stringify({
        hasProvider: true,
        timestamp: Date.now()
      }));
      sessionStorage.removeItem(cacheKey); // Clear any stale session cache

      // CRITICAL FIX: Dispatch event FIRST so any mounted listeners get optimistic update
      // This triggers immediate UI updates in useAIProviderStatus hook
      window.dispatchEvent(new CustomEvent('ai-provider-connected', {
        detail: { providerId: provider.id, organizationId: organization.id }
      }));

      // PHASE AI4 FIX: Pass saved provider directly to onSuccess for immediate state update
      // Removes the 250ms delay race condition - state updates from save response, not refetch
      onSuccess(savedProvider);

      console.warn('[AISettings] Provider added to state immediately from save response');

      // PHASE K4 FIX: Clear success message that confirms secure storage
      addNotification('API key saved securely. Your AI is now powered up!', 'success');

      // Small delay to let user see the "Connected" state before closing modal
      setTimeout(() => {
        onClose();
      }, 500);
    } catch (error) {
      console.error('Failed to save provider:', error);

      // NEXT-LEVEL: Use enhanced error from api-client
      addNotification(error.userMessage || error.message || 'Failed to save API key', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    // CRITICAL Z-INDEX FIX: Must use z-[200] to sit above AI provider cards (z-[173])
    // Cards are elevated to z-[173] for onboarding spotlight, so modal needs higher z-index
    // Z-index hierarchy: spotlight (170-172) < cards (173) < modals (200)
    // UI UPDATE: Glass-effect design matching ServiceWorkerUpdateNotification
    <div className="fixed inset-0 bg-black/95 backdrop-blur-sm flex items-center justify-center z-[200] p-4 animate-fade-in">
      <div className="bg-gradient-to-br from-gray-900 to-black rounded-2xl max-w-md w-full p-8 shadow-2xl border border-teal-500/30 relative animate-scale-in">
        {/* Close button - absolute positioned */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-400 hover:text-white transition-colors duration-200 p-2 hover:bg-gray-800/50 rounded-lg"
          aria-label="Close modal"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Header with icon */}
        <div className="flex items-center gap-4 mb-6">
          <div
            className="w-14 h-14 rounded-xl flex items-center justify-center p-3 ring-4 ring-teal-500/10"
            style={{
              backgroundColor: `${provider.color}20`,
              borderColor: `${provider.color}40`,
              borderWidth: '2px',
              color: provider.color
            }}
          >
            <Logo className="w-full h-full" />
          </div>
          <div>
            <h3 className="text-2xl font-bold text-white">
              Connect {provider.displayName}
            </h3>
            <p className="text-sm text-gray-400">
              {provider.description}
            </p>
          </div>
        </div>

        <div className="space-y-4 mb-6">
          <div>
            <label htmlFor="ai-api-key" className="block text-sm font-medium text-gray-300 mb-2">
              API Key
            </label>
            <div className="relative">
              <input
                id="ai-api-key"
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={`sk-...`}
                autoComplete="new-password"
                data-1p-ignore
                data-lpignore="true"
                data-form-type="other"
                aria-invalid={!apiKey.trim() ? 'true' : 'false'}
                aria-describedby="ai-api-key-help"
                className="w-full px-4 py-2.5 pr-10 bg-gray-900/50 border border-gray-700 rounded-lg focus:ring-2 focus:ring-teal-500/50 focus:border-teal-500 text-white font-mono text-sm placeholder-gray-500 transition-colors duration-200"
              />
              <button
                onClick={() => setShowKey(!showKey)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white transition-colors duration-200"
                aria-label={showKey ? 'Hide API key' : 'Show API key'}
              >
                {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div className="bg-teal-500/10 border border-teal-500/30 rounded-lg p-3 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-teal-400 mt-0.5 flex-shrink-0" />
            <div className="text-xs text-gray-300">
              <p id="ai-api-key-help" className="font-medium text-white mb-1">One key for all {provider.displayName} models</p>
              <p>Get your API key from <a href={provider.signupUrl} target="_blank" rel="noopener noreferrer" className="text-teal-400 hover:text-teal-300 hover:underline transition-colors duration-200">{provider.name}</a>. The key works with all available models and will be encrypted.</p>
            </div>
          </div>
        </div>

        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2.5 border border-gray-700 text-gray-300 rounded-lg hover:bg-gray-800/50 hover:border-gray-600 transition-all duration-200 font-medium"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!apiKey.trim() || saving}
            className="flex-1 bg-gradient-to-r from-teal-600 to-teal-500 hover:from-teal-500 hover:to-teal-400 text-white px-4 py-2.5 rounded-lg shadow-lg hover:shadow-teal-500/20 transition-all duration-200 font-medium disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:from-teal-600 disabled:hover:to-teal-500"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : 'Connect'}
          </button>
        </div>
      </div>
    </div>
  );
};
