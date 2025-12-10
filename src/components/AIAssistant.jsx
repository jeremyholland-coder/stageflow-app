import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Bot, X, Send, Sparkles, TrendingUp, Target, Zap, Loader2, AlertCircle, Settings, ChevronDown, WifiOff } from 'lucide-react';
import { useApp } from './AppShell';
// P0 FIX 2025-12-04: Removed direct supabase import - use backend endpoint instead (RLS-safe)
import { AIMessageRenderer } from './AIMessageRenderer';
import { api } from '../lib/api-client';
// Phase 3: Unified error handling and offline awareness
import { ErrorSurface } from './ErrorSurface';
import { normalizeAIError, isOffline, shouldBlockAIRequest } from '../lib/ai-error-codes';
// Phase 9: Accessibility improvements
import { useFocusTrap, useAnnounce } from '../lib/accessibility';
// STEP 4: AI Readiness State Machine integration
import { useWiredAIReadiness } from '../ai/useAIReadiness';

// P0 FIX: Allowed provider types - matches backend filtering
// Belt-and-suspenders guard against zombie providers (e.g., deprecated xAI/Grok)
const ALLOWED_PROVIDER_TYPES = ['openai', 'anthropic', 'google'];

// 4-Star AI Icon Component
const AIStarIcon = ({ className = "w-6 h-6" }) => (
  <svg viewBox="0 0 48 48" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
    {/* Large center star */}
    <path d="M24 2L26.5 16.5L34 10L29 21H42L32 27L38 39L24 31L10 39L16 27L6 21H19L14 10L21.5 16.5L24 2Z" fill="url(#gradient1)" />
    
    {/* Three smaller stars */}
    <path d="M8 8L9 11L12 10L10 13L13 14L9 14L8 17L7 14L3 14L6 13L4 10L7 11L8 8Z" fill="url(#gradient2)" opacity="0.8" />
    <path d="M40 8L41 11L44 10L42 13L45 14L41 14L40 17L39 14L35 14L38 13L36 10L39 11L40 8Z" fill="url(#gradient3)" opacity="0.8" />
    <path d="M24 42L25 45L28 44L26 47L29 48L25 48L24 51L23 48L19 48L22 47L20 44L23 45L24 42Z" fill="url(#gradient4)" opacity="0.8" />
    
    <defs>
      <linearGradient id="gradient1" x1="24" y1="2" x2="24" y2="39" gradientUnits="userSpaceOnUse">
        <stop stopColor="#2C3E50" />
        <stop offset="0.5" stopColor="#34495E" />
        <stop offset="1" stopColor="#1ABC9C" />
      </linearGradient>
      <linearGradient id="gradient2" x1="8" y1="8" x2="8" y2="17" gradientUnits="userSpaceOnUse">
        <stop stopColor="#3A86FF" />
        <stop offset="1" stopColor="#9D4EDD" />
      </linearGradient>
      <linearGradient id="gradient3" x1="40" y1="8" x2="40" y2="17" gradientUnits="userSpaceOnUse">
        <stop stopColor="#F39C12" />
        <stop offset="1" stopColor="#E74C3C" />
      </linearGradient>
      <linearGradient id="gradient4" x1="24" y1="42" x2="24" y2="51" gradientUnits="userSpaceOnUse">
        <stop stopColor="#16A085" />
        <stop offset="1" stopColor="#1ABC9C" />
      </linearGradient>
    </defs>
  </svg>
);

export const AIAssistant = ({ deals = [] }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState([
    {
      id: 1,
      type: 'assistant',
      content: "Hi! I'm your AI sales assistant powered by multiple AI models. I can help you analyze your pipeline, optimize deal flow, and provide strategic insights. What would you like to know?",
      timestamp: new Date()
    }
  ]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [providers, setProviders] = useState([]);
  const [selectedProvider, setSelectedProvider] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  // M1 HARDENING: Track provider fetch errors with message (null = no error, string = error message)
  // This is DIFFERENT from "no providers configured" (which is providers.length === 0 with no fetch error)
  const [providerFetchError, setProviderFetchError] = useState(null);
  // M1 HARDENING: Track if initial provider fetch has completed
  const [providersLoaded, setProvidersLoaded] = useState(false);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const { user, organization, addNotification, navigateToIntegrations } = useApp();

  // STEP 4: AI Readiness State Machine - single source of truth for AI availability
  const { uiVariant: aiReadinessVariant } = useWiredAIReadiness({
    organizationId: organization?.id || null,
  });

  // Phase 9: Accessibility - Focus trap and announcements
  const focusTrapRef = useFocusTrap(isOpen);
  const { announcePolite } = useAnnounce();

  // Load available AI providers
  // P0 FIX 2025-12-08: Use stable IDs to prevent unnecessary refetches
  useEffect(() => {
    fetchProviders();
  }, [user?.id, organization?.id]);

  // P0 FIX 2025-12-04: Use backend endpoint instead of direct Supabase query
  // Direct Supabase queries fail with RLS when persistSession: false (auth.uid() is NULL)
  const fetchProviders = async () => {
    if (!user || !organization) return;

    // M1 HARDENING: Reset error state on new fetch
    setProviderFetchError(null);

    try {
      const { data: result } = await api.post('get-ai-providers', {
        organization_id: organization.id
      });

      // Check for error response from backend
      if (result.error) {
        console.error('[StageFlow][AI][ERROR] Provider fetch returned error:', result.error);
        // M1 HARDENING: Store error message for UI display
        setProviderFetchError(
          "We couldn't reach your AI provider settings. This is likely temporary. Please try again."
        );
        setProvidersLoaded(true);
        return;
      }

      // P0 FIX: Filter to allowed provider types (belt-and-suspenders)
      // Prevents showing zombie providers (e.g., deprecated xAI/Grok)
      const rawProviders = result.providers || [];
      const filteredProviders = rawProviders.filter(p =>
        ALLOWED_PROVIDER_TYPES.includes(p.provider_type)
      );

      setProviders(filteredProviders);
      // M1 HARDENING: Mark as loaded successfully (no error)
      setProvidersLoaded(true);
      setProviderFetchError(null);

      // Auto-select first provider if none selected
      if (filteredProviders.length > 0 && !selectedProvider) {
        setSelectedProvider(filteredProviders[0]);
      }
    } catch (err) {
      // M1 HARDENING: Distinguish between "no providers" and "provider fetch error"
      // Network errors, 5xx, auth errors = fetch error (NOT "no providers")
      console.error('[StageFlow][AI][ERROR] Failed to fetch AI providers:', err);
      setProviderFetchError(
        "We couldn't reach your AI provider settings. This is likely temporary. Please try again."
      );
      setProvidersLoaded(true);
      // DO NOT clear providers list - preserve any cached state
    }
  };

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Focus input when chat opens
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  // Phase 9: Handle Escape key to close chat panel
  useEffect(() => {
    if (!isOpen) return;

    const handleEscape = (e) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen]);

  // Phase 9: Announce new assistant messages to screen readers
  const lastMessageRef = useRef(null);
  useEffect(() => {
    const lastMessage = messages[messages.length - 1];
    if (lastMessage && lastMessage.type === 'assistant' && lastMessage.id !== lastMessageRef.current) {
      lastMessageRef.current = lastMessage.id;
      // Announce the first 100 chars of the message
      const preview = lastMessage.content.substring(0, 100);
      announcePolite(`AI Assistant: ${preview}${lastMessage.content.length > 100 ? '...' : ''}`);
    }
  }, [messages, announcePolite]);

  // Quick action suggestions
  const quickActions = [
    {
      icon: TrendingUp,
      label: 'Analyze Pipeline',
      prompt: 'Analyze my current pipeline and provide insights'
    },
    {
      icon: Target,
      label: 'Win Probability',
      prompt: 'What are my most likely deals to close this month?'
    },
    {
      icon: Zap,
      label: 'Optimization Tips',
      prompt: 'How can I optimize my sales process?'
    }
  ];

  const handleSendMessage = async (messageText = inputValue) => {
    if (!messageText.trim() || isLoading) return;

    // P0 FIX 2025-12-08: Check provider fetch error BEFORE checking providers.length
    // If there's a network error, we should show that, not "please configure provider"
    if (providerFetchError) {
      addNotification('Unable to reach AI services. Please try again.', 'error');
      return;
    }

    if (providers.length === 0) {
      addNotification('Please configure an AI provider in Integrations → AI Settings', 'error');
      return;
    }

    // Phase 3: Pre-flight offline check - fail fast instead of waiting for timeout
    const blockError = shouldBlockAIRequest({ requireOnline: true });
    if (blockError) {
      setError(blockError);
      return;
    }

    // STEP 4: AI readiness pre-flight guard - prevent requests when AI is known to be unavailable
    if (aiReadinessVariant && (
      aiReadinessVariant === 'session_invalid' ||
      aiReadinessVariant === 'connect_provider' ||
      aiReadinessVariant === 'config_error' ||
      aiReadinessVariant === 'disabled'
    )) {
      console.warn('[AIAssistant] Request blocked - AI not available:', aiReadinessVariant);
      const variantMessages = {
        session_invalid: 'Your session has expired. Please refresh the page or sign in again.',
        connect_provider: 'Please connect an AI provider in Settings to use AI.',
        config_error: 'AI is temporarily unavailable due to a server configuration issue.',
        disabled: 'AI features are disabled for your current plan.'
      };
      setError({
        code: 'AI_NOT_AVAILABLE',
        message: variantMessages[aiReadinessVariant] || 'AI is not available right now.',
        retryable: false
      });
      return;
    }

    // STEP 4: Diagnostic logging - log AI readiness state before each request
    console.info('[AI REQUEST]', {
      entrypoint: 'AIAssistant.chat',
      aiReadinessVariant,
      hasProviders: providers.length > 0,
      providerFetchError: !!providerFetchError,
    });

    const userMessage = {
      id: Date.now(),
      type: 'user',
      content: messageText,
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    setInputValue('');
    setIsLoading(true);
    setError(null);

    // SURGICAL FIX: Removed redundant auth check - user already verified by AppShell
    // AppShell.jsx handles centralized auth, no need to re-check per component
    if (!user) {
      console.warn('[AIAssistant] No user - AppShell should handle redirect');
      return;
    }

    try {
      // NEXT-LEVEL: Use centralized API client with automatic retry + 30s timeout
      // Replaces manual fetch() with resilient AI endpoint
      const { data } = await api.ai('ai-assistant', {
        message: messageText,
        deals: deals,
        conversationHistory: messages.slice(-5), // Last 5 messages for context
        preferredProvider: selectedProvider?.provider_type
      });

      // ENGINE REBUILD Phase 5: Handle normalized error format from backend
      // Backend now sends { ok: false, error: AIErrorInfo } for failures
      if (data.ok === false) {
        const errorInfo = data.error || {};
        const errorMessage = {
          id: Date.now() + 1,
          type: 'assistant',
          content: errorInfo.message || data.message || data.response || 'AI request failed',
          timestamp: new Date(),
          isError: true,
          errorCode: errorInfo.code || data.code,
          retryable: errorInfo.retryable ?? data.retryable,
        };
        setMessages(prev => [...prev, errorMessage]);

        // Set error state for ErrorSurface if needed
        if (errorInfo.code) {
          setError({ code: errorInfo.code, message: errorInfo.message, retryable: errorInfo.retryable });
        }
        return;
      }

      // ENGINE REBUILD: Validate response content is non-empty
      const responseContent = data.response || '';
      if (!responseContent.trim()) {
        const emptyErrorMessage = {
          id: Date.now() + 1,
          type: 'assistant',
          content: 'I received an empty response. Please try again.',
          timestamp: new Date(),
          isError: true,
          errorCode: 'EMPTY_RESPONSE',
        };
        setMessages(prev => [...prev, emptyErrorMessage]);
        return;
      }

      const assistantMessage = {
        id: Date.now() + 1,
        type: 'assistant',
        content: responseContent,
        timestamp: new Date(),
        suggestions: data.suggestions || [],
        provider: data.provider || 'AI'
      };

      setMessages(prev => [...prev, assistantMessage]);
    } catch (err) {
      console.error('AI Assistant error:', err);

      // Phase 3: Normalize error to unified format for consistent messaging
      const normalizedError = normalizeAIError(err, 'AIAssistant');
      setError(normalizedError);

      // ENGINE REBUILD: Use error.message from normalized error (never undefined)
      const errorMessage = {
        id: Date.now() + 1,
        type: 'assistant',
        content: normalizedError.message || 'Something went wrong. Please try again.',
        timestamp: new Date(),
        isError: true,
        errorCode: normalizedError.code,
        retryable: normalizedError.retryable,
      };

      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleQuickAction = (prompt) => {
    setInputValue(prompt);
    handleSendMessage(prompt);
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  // MOBILE FIX: Prevent image pasting (mobile browsers often try to paste screenshots)
  const handlePaste = (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    // Check if clipboard contains images
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        e.preventDefault();
        addNotification('Image uploads are not supported yet. Please describe your question in text.', 'error');
        return;
      }
    }
  };

  const getProviderDisplayName = (providerType) => {
    // FIX 2025-12-04: Removed Grok/xAI - deprecated provider
    const names = {
      'openai': 'ChatGPT',
      'anthropic': 'Claude',
      'google': 'Gemini'
    };
    return names[providerType] || providerType;
  };

  return (
    <>
      {/* Floating Button */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          aria-label="Open AI Assistant"
          className="fixed bottom-6 right-6 w-14 h-14 min-h-touch min-w-touch bg-gradient-to-r from-[#2C3E50] via-[#34495E] to-[#1ABC9C] text-white rounded-full shadow-2xl hover:shadow-3xl hover:scale-110 transition-all duration-300 flex items-center justify-center z-50 group focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900"
        >
          <AIStarIcon className="w-7 h-7 group-hover:rotate-12 transition-transform" aria-hidden="true" />
          <div className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full animate-pulse" aria-hidden="true" />
          <span className="sr-only">AI Assistant available</span>
        </button>
      )}

      {/* Chat Panel - Mobile Responsive */}
      {isOpen && (
        <div
          ref={focusTrapRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="ai-assistant-title"
          className="fixed bottom-0 right-0 md:bottom-6 md:right-6 w-full h-full md:w-96 md:h-[600px] bg-white dark:bg-[#0D1F2D] md:rounded-2xl shadow-2xl border-t md:border border-gray-200 dark:border-gray-700 flex flex-col z-50 overflow-hidden animate-slide-up max-h-screen"
        >
          {/* Header */}
          <div className="bg-gradient-to-r from-[#2C3E50] via-[#34495E] to-[#1ABC9C] p-4 flex items-center justify-between text-white">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-white/20 backdrop-blur-sm rounded-full flex items-center justify-center" aria-hidden="true">
                <AIStarIcon className="w-6 h-6" />
              </div>
              <div>
                <h3 id="ai-assistant-title" className="font-bold">AI Assistant</h3>
                <p className="text-xs text-white/80">
                  {selectedProvider ? getProviderDisplayName(selectedProvider.provider_type) : `${providers.length} models`}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {providers.length > 1 && (
                <button
                  onClick={() => setShowSettings(!showSettings)}
                  className="p-2 min-h-touch min-w-touch hover:bg-white/20 rounded-lg transition focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
                  aria-label="Switch AI Model"
                  aria-expanded={showSettings}
                >
                  <Settings className="w-5 h-5" aria-hidden="true" />
                </button>
              )}
              <button
                onClick={() => setIsOpen(false)}
                className="p-2 min-h-touch min-w-touch hover:bg-white/20 rounded-lg transition focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
                aria-label="Close AI Assistant"
              >
                <X className="w-5 h-5" aria-hidden="true" />
              </button>
            </div>
          </div>

          {/* Provider Selector */}
          {showSettings && providers.length > 1 && (
            <div className="p-4 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-[#0A1520]">
              <p className="text-xs font-medium text-[#6B7280] dark:text-[#9CA3AF] mb-2">Select AI Model</p>
              <div className="space-y-2">
                {providers.map((provider) => (
                  <button
                    key={provider.id}
                    onClick={() => {
                      setSelectedProvider(provider);
                      setShowSettings(false);
                      addNotification(`Switched to ${getProviderDisplayName(provider.provider_type)}`, 'success');
                    }}
                    className={`w-full text-left px-3 py-2 rounded-lg transition ${
                      selectedProvider?.id === provider.id
                        ? 'bg-gradient-to-r from-[#2C3E50] via-[#34495E] to-[#1ABC9C] text-white'
                        : 'bg-white dark:bg-[#0D1F2D] hover:bg-gray-100 dark:hover:bg-gray-800 text-[#1A1A1A] dark:text-[#E0E0E0]'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">{getProviderDisplayName(provider.provider_type)}</span>
                      {selectedProvider?.id === provider.id && (
                        <span className="text-xs">✓ Active</span>
                      )}
                    </div>
                    {provider.model && (
                      <span className="text-xs opacity-80">{provider.model}</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Messages */}
          <div
            className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50 dark:bg-[#0A1520]"
            role="log"
            aria-label="Chat messages"
            aria-live="polite"
            aria-relevant="additions"
          >
            {messages.map((message) => (
              <div
                key={message.id}
                className={`flex gap-3 ${message.type === 'user' ? 'flex-row-reverse' : 'flex-row'}`}
              >
                {message.type === 'assistant' && (
                  <div className="w-8 h-8 bg-gradient-to-br from-[#2C3E50] via-[#34495E] to-[#1ABC9C] rounded-full flex items-center justify-center flex-shrink-0">
                    <AIStarIcon className="w-5 h-5" />
                  </div>
                )}
                <div className="flex-1">
                  <div
                    className={`w-full md:max-w-[85%] rounded-2xl ${
                      message.type === 'user'
                        ? 'ml-auto bg-gradient-to-r from-[#2C3E50] via-[#34495E] to-[#1ABC9C] text-white px-4 py-3'
                        : 'bg-white dark:bg-[#0D1F2D] text-[#1A1A1A] dark:text-[#E0E0E0] border border-gray-200 dark:border-gray-700 px-3 py-3'
                    }`}
                  >
                    {message.type === 'user' ? (
                      <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                    ) : (
                      <AIMessageRenderer content={message.content} />
                    )}
                    {message.provider && message.type === 'assistant' && (
                      <p className="text-xs mt-2 opacity-60">via {message.provider}</p>
                    )}
                    {message.suggestions && message.suggestions.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-600 space-y-2">
                        <p className="text-xs font-medium text-[#6B7280] dark:text-[#9CA3AF]">Suggestions:</p>
                        {message.suggestions.map((suggestion, idx) => (
                          <button
                            key={idx}
                            onClick={() => handleQuickAction(suggestion)}
                            className="w-full text-left text-xs px-3 py-2 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg transition"
                          >
                            {suggestion}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}

            {isLoading && (
              <div className="flex gap-3">
                <div className="w-8 h-8 bg-gradient-to-br from-[#2C3E50] via-[#34495E] to-[#1ABC9C] rounded-full flex items-center justify-center flex-shrink-0">
                  <AIStarIcon className="w-5 h-5" />
                </div>
                <div className="bg-white dark:bg-[#0D1F2D] border border-gray-200 dark:border-gray-700 rounded-2xl px-4 py-3">
                  <div className="flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin text-[#1ABC9C]" />
                    <span className="text-sm text-[#6B7280] dark:text-[#9CA3AF]">Analyzing your pipeline...</span>
                  </div>
                </div>
              </div>
            )}

            {/* Phase 3: Use ErrorSurface for consistent Apple-grade error display */}
            {error && (
              <ErrorSurface
                error={error}
                variant="inline"
                onRetry={error.retryable ? () => {
                  setError(null);
                  // Re-send the last user message if available
                  const lastUserMessage = [...messages].reverse().find(m => m.type === 'user');
                  if (lastUserMessage) {
                    handleSendMessage(lastUserMessage.content);
                  }
                } : undefined}
                onDismiss={() => setError(null)}
                onNavigate={(path) => {
                  setIsOpen(false);
                  window.location.href = path;
                }}
                showRecovery={true}
              />
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Quick Actions */}
          {messages.length === 1 && (
            <div className="p-4 border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-[#0D1F2D]">
              <p className="text-xs font-medium text-[#6B7280] dark:text-[#9CA3AF] mb-3">Quick Actions</p>
              <div className="space-y-2">
                {quickActions.map((action, idx) => (
                  <button
                    key={idx}
                    onClick={() => handleQuickAction(action.prompt)}
                    className="w-full flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-900 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition group"
                  >
                    <div className="w-8 h-8 bg-gradient-to-br from-[#2C3E50] via-[#34495E] to-[#1ABC9C] rounded-lg flex items-center justify-center group-hover:scale-110 transition-transform">
                      <action.icon className="w-4 h-4 text-white" />
                    </div>
                    <span className="text-sm font-medium text-[#1A1A1A] dark:text-[#E0E0E0]">{action.label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Input */}
          <div className="p-4 border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-[#0D1F2D]">
            {/* M1 HARDENING: Distinguish between "provider fetch error" and "no providers configured" */}
            {/* Phase 3: Use ErrorSurface for consistent error display */}
            {providerFetchError ? (
              // CASE 1: Provider fetch failed (network error, DB error, auth error)
              // This is NOT "no providers" - it's an infrastructure issue
              <div className="py-2">
                <ErrorSurface
                  error={{ code: 'NETWORK_ERROR', message: providerFetchError }}
                  variant="inline"
                  onRetry={() => fetchProviders()}
                  showRecovery={false}
                />
              </div>
            ) : providersLoaded && providers.length === 0 ? (
              // CASE 2: Fetch succeeded but no providers are configured
              // User needs to go to Settings → AI Providers to connect one
              <div className="text-center py-2">
                <p className="text-xs text-[#6B7280] dark:text-[#9CA3AF] mb-2">
                  No AI provider is connected. Go to Settings → AI Providers to connect ChatGPT, Claude, or Gemini.
                </p>
                <button
                  onClick={() => {
                    setIsOpen(false);
                    navigateToIntegrations();
                  }}
                  className="text-xs text-[#1ABC9C] hover:underline font-medium"
                >
                  Configure AI Settings
                </button>
              </div>
            ) : !providersLoaded ? (
              // CASE 3: Still loading - show loading indicator
              <div className="text-center py-2">
                <p className="text-xs text-[#6B7280] dark:text-[#9CA3AF]">
                  Loading AI providers...
                </p>
              </div>
            ) : (
              <div className="flex gap-2">
                <label htmlFor="ai-chat-input" className="sr-only">
                  Message to AI Assistant
                </label>
                <textarea
                  id="ai-chat-input"
                  ref={inputRef}
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyPress={handleKeyPress}
                  onPaste={handlePaste}
                  placeholder="Ask me anything..."
                  rows={1}
                  aria-describedby="ai-chat-hint"
                  className="flex-1 px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-xl focus:ring-2 focus:ring-[#1ABC9C] focus:outline-none dark:bg-[#0A1520] dark:text-[#E0E0E0] resize-none"
                  style={{ maxHeight: '120px' }}
                />
                <span id="ai-chat-hint" className="sr-only">
                  Press Enter to send, Shift+Enter for new line
                </span>
                <button
                  onClick={() => handleSendMessage()}
                  disabled={!inputValue.trim() || isLoading}
                  aria-label={!inputValue.trim() ? "Type a message to send" : isLoading ? "Sending message..." : "Send message"}
                  className="px-4 py-3 min-h-touch min-w-touch bg-gradient-to-r from-[#2C3E50] via-[#34495E] to-[#1ABC9C] text-white rounded-xl hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2"
                >
                  <Send className="w-5 h-5" aria-hidden="true" />
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
};
