import React from 'react';
import { Inbox, Bot, Key, Webhook } from 'lucide-react';

export const EmptyState = ({ type = 'deals', onAction }) => {
  const states = {
    deals: { icon: Inbox, title: 'No deals yet', description: 'Start by adding your first deal to the pipeline', actionText: 'Create Your First Deal', gradient: 'from-[#2C3E50] to-[#1ABC9C]', useGradientButton: false },
    ai_providers: { icon: Bot, title: 'No AI providers configured', description: 'Connect an AI provider to unlock insights', actionText: 'Configure AI Provider', gradient: 'from-[#3A86FF] to-[#9D4EDD]', useGradientButton: true },
    api_keys: { icon: Key, title: 'No API keys created', description: 'Generate API keys to integrate with other tools', actionText: 'Generate API Key', gradient: 'from-[#F39C12] to-[#E74C3C]', useGradientButton: true },
    webhooks: { icon: Webhook, title: 'No webhooks configured', description: 'Set up webhooks for real-time notifications', actionText: 'Create Webhook', gradient: 'from-[#16A085] to-[#1ABC9C]', useGradientButton: true }
  };

  const config = states[type] || states.deals;
  const Icon = config.icon;

  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 animate-fadeIn">
      {/* POLISH: Add bounce animation to icon circle */}
      <div className={`w-24 h-24 bg-gradient-to-br ${config.gradient} rounded-full flex items-center justify-center mb-6 opacity-90 animate-bounce-subtle`}>
        <Icon className="w-12 h-12 text-white" />
      </div>
      <h3 className="text-title-1 text-[#1A1A1A] dark:text-[#E0E0E0] mb-3 text-center animate-slideUp">{config.title}</h3>
      <p className="text-body text-[#6B7280] dark:text-[#9CA3AF] text-center max-w-md mb-8 animate-slideUp animation-delay-100">{config.description}</p>
      {onAction && (
        <button
          onClick={onAction}
          className={`${config.useGradientButton
            ? `bg-gradient-to-br ${config.gradient} text-white`
            : `bg-[#1ABC9C] hover:bg-[#16A085] text-white`
          } px-6 py-3 min-h-touch rounded-lg font-semibold hover:shadow-lg hover:scale-105 transition-all transform animate-slideUp animation-delay-200`}
          title={config.actionText}
          aria-label={config.actionText}
        >
          {config.actionText}
        </button>
      )}
      <div className="mt-8 flex items-center gap-2 text-sm text-[#9CA3AF] animate-slideUp animation-delay-300">
        <span className="w-2 h-2 bg-[#9CA3AF] rounded-full animate-pulse"></span>
        <span>Let's get started!</span>
      </div>

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes slideUp {
          from {
            opacity: 0;
            transform: translateY(10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        @keyframes bounce-subtle {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-8px); }
        }
        .animate-fadeIn {
          animation: fadeIn 0.5s ease-out;
        }
        .animate-slideUp {
          animation: slideUp 0.6s ease-out forwards;
          opacity: 0;
        }
        .animate-bounce-subtle {
          animation: bounce-subtle 2s ease-in-out infinite;
        }
        .animation-delay-100 {
          animation-delay: 0.1s;
        }
        .animation-delay-200 {
          animation-delay: 0.2s;
        }
        .animation-delay-300 {
          animation-delay: 0.3s;
        }
      `}</style>
    </div>
  );
};

export const EmptyDeals = ({ onAction }) => <EmptyState type="deals" onAction={onAction} />;
export const EmptyAIProviders = ({ onAction }) => <EmptyState type="ai_providers" onAction={onAction} />;
export const EmptyAPIKeys = ({ onAction }) => <EmptyState type="api_keys" onAction={onAction} />;
export const EmptyWebhooks = ({ onAction }) => <EmptyState type="webhooks" onAction={onAction} />;
