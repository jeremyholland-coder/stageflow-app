import React, { useState, useRef, useEffect } from 'react';
import { Bot, X, Send, Sparkles, TrendingUp, Target, Zap, Loader2, AlertCircle, Settings, ChevronDown } from 'lucide-react';
import { useApp } from './AppShell';
import { supabase } from '../lib/supabase';
import { AIMessageRenderer } from './AIMessageRenderer';
import { api } from '../lib/api-client';

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
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const { user, organization, addNotification, navigateToIntegrations } = useApp();

  // Load available AI providers
  useEffect(() => {
    fetchProviders();
  }, [user, organization]);

  const fetchProviders = async () => {
    if (!user || !organization) return;

    try {
      const { data, error } = await supabase
        .from('ai_providers')
        .select('*')
        .eq('organization_id', organization.id)
        .eq('active', true)
        .order('created_at', { ascending: false });

      if (error) throw error;
      
      setProviders(data || []);
      
      // Auto-select first provider if none selected
      if (data && data.length > 0 && !selectedProvider) {
        setSelectedProvider(data[0]);
      }
    } catch (error) {
      console.error('Failed to fetch AI providers:', error);
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

    if (providers.length === 0) {
      addNotification('Please configure an AI provider in Integrations → AI Settings', 'error');
      return;
    }

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

      const assistantMessage = {
        id: Date.now() + 1,
        type: 'assistant',
        content: data.response,
        timestamp: new Date(),
        suggestions: data.suggestions || [],
        provider: data.provider || 'AI'
      };

      setMessages(prev => [...prev, assistantMessage]);
    } catch (err) {
      console.error('AI Assistant error:', err);

      // NEXT-LEVEL: Use enhanced error properties from api-client
      const isTimeout = err.code === 'TIMEOUT' || err.status === 408;

      if (isTimeout) {
        setError('Request timed out. Please try again.');
      } else {
        setError(err.userMessage || 'Sorry, I encountered an error. Please try again.');
      }

      const errorMessage = {
        id: Date.now() + 1,
        type: 'assistant',
        content: isTimeout
          ? "The request timed out. Please try again."
          : providers.length === 0
            ? "I'm having trouble connecting. Please configure your AI provider in Integrations → AI Settings."
            : (err.userMessage || "I encountered an error processing your request. Please try again or check your AI provider settings."),
        timestamp: new Date()
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
          className="fixed bottom-6 right-6 w-14 h-14 bg-gradient-to-r from-[#2C3E50] via-[#34495E] to-[#1ABC9C] text-white rounded-full shadow-2xl hover:shadow-3xl hover:scale-110 transition-all duration-300 flex items-center justify-center z-50 group"
        >
          <AIStarIcon className="w-7 h-7 group-hover:rotate-12 transition-transform" />
          <div className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full animate-pulse" />
        </button>
      )}

      {/* Chat Panel - Mobile Responsive */}
      {isOpen && (
        <div className="fixed bottom-0 right-0 md:bottom-6 md:right-6 w-full h-full md:w-96 md:h-[600px] bg-white dark:bg-[#0D1F2D] md:rounded-2xl shadow-2xl border-t md:border border-gray-200 dark:border-gray-700 flex flex-col z-50 overflow-hidden animate-slide-up max-h-screen">
          {/* Header */}
          <div className="bg-gradient-to-r from-[#2C3E50] via-[#34495E] to-[#1ABC9C] p-4 flex items-center justify-between text-white">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-white/20 backdrop-blur-sm rounded-full flex items-center justify-center">
                <AIStarIcon className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-bold">AI Assistant</h3>
                <p className="text-xs text-white/80">
                  {selectedProvider ? getProviderDisplayName(selectedProvider.provider_type) : `${providers.length} models`}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {providers.length > 1 && (
                <button
                  onClick={() => setShowSettings(!showSettings)}
                  className="p-2 hover:bg-white/20 rounded-lg transition"
                  title="Switch AI Model"
                >
                  <Settings className="w-5 h-5" />
                </button>
              )}
              <button
                onClick={() => setIsOpen(false)}
                className="p-2 hover:bg-white/20 rounded-lg transition"
              >
                <X className="w-5 h-5" />
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
          <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50 dark:bg-[#0A1520]">
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

            {error && (
              <div className="flex items-start gap-2 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
              </div>
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
            {providers.length === 0 ? (
              <div className="text-center py-2">
                <p className="text-xs text-[#6B7280] dark:text-[#9CA3AF] mb-2">
                  No AI providers configured
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
            ) : (
              <div className="flex gap-2">
                <textarea
                  ref={inputRef}
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyPress={handleKeyPress}
                  onPaste={handlePaste}
                  placeholder="Ask me anything..."
                  rows={1}
                  className="flex-1 px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-xl focus:ring-2 focus:ring-[#1ABC9C] dark:bg-[#0A1520] dark:text-[#E0E0E0] resize-none"
                  style={{ maxHeight: '120px' }}
                />
                <button
                  onClick={() => handleSendMessage()}
                  disabled={!inputValue.trim() || isLoading}
                  title={!inputValue.trim() ? "Type a message to send" : isLoading ? "Please wait..." : "Send message"}
                  className="px-4 py-3 bg-gradient-to-r from-[#2C3E50] via-[#34495E] to-[#1ABC9C] text-white rounded-xl hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                >
                  <Send className="w-5 h-5" />
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
};
