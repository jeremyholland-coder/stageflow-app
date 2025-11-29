import React from 'react';
import { X, Check, Zap, TrendingUp, Users, Calendar, FileText, Settings, Sparkles } from 'lucide-react';
import { onboardingStorage } from '../lib/onboardingStorage';

/**
 * Onboarding Completion Modal - Premium UI
 * Beautiful celebration screen when user completes onboarding
 */
export const OnboardingCompletionModal = ({ isOpen, userId, onClose, onExploreMore }) => {
  if (!isOpen) return null;

  // Handler to close modal
  const handleClose = () => {
    onClose();
  };

  const nextSteps = [
    {
      icon: Zap,
      title: 'AI-Powered Insights',
      description: 'Get intelligent deal scoring',
      action: () => onExploreMore('integrations')
    },
    {
      icon: TrendingUp,
      title: 'Analytics Dashboard',
      description: 'Track pipeline performance',
      action: () => onExploreMore('analytics')
    },
    {
      icon: Users,
      title: 'Team Collaboration',
      description: 'Invite teammates',
      action: () => onExploreMore('settings')
    },
    {
      icon: Calendar,
      title: 'Automation & Workflows',
      description: 'Automate repetitive tasks',
      action: () => onExploreMore('integrations')
    },
    {
      icon: FileText,
      title: 'Reports & Exports',
      description: 'Generate custom reports',
      action: () => onExploreMore('analytics')
    },
    {
      icon: Settings,
      title: 'Advanced Settings',
      description: 'Customize your workspace',
      action: () => onExploreMore('settings')
    }
  ];

  return (
    <div className="fixed inset-0 bg-black/95 backdrop-blur-sm z-[100] flex items-center justify-center p-4 animate-fadeIn" data-testid="onboarding-completion-modal">
      <div className="bg-gradient-to-br from-gray-900 to-black border border-teal-500/30 rounded-2xl max-w-3xl w-full shadow-2xl animate-slideUp overflow-hidden relative">

        {/* Close button */}
        <button
          onClick={handleClose}
          className="absolute top-4 right-4 p-2 hover:bg-white/10 rounded-lg transition-colors text-white/70 hover:text-white z-10"
          aria-label="Close completion modal"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="relative p-12">
          {/* Success Icon */}
          <div className="w-24 h-24 mx-auto mb-6 relative">
            <div className="rounded-full bg-teal-500/20 ring-4 ring-teal-500/10 w-full h-full flex items-center justify-center">
              <Check className="w-12 h-12 text-teal-400 animate-pulse" strokeWidth={3} />
            </div>
          </div>

          {/* Header */}
          <div className="text-center mb-10">
            <h2 className="text-4xl font-bold text-white mb-3 flex items-center justify-center gap-2">
              Congratulations! <Sparkles className="w-8 h-8 text-teal-400" />
            </h2>
            <p className="text-lg text-gray-300 max-w-xl mx-auto mb-2">
              You've completed the onboarding tour! You're all set to start closing deals.
            </p>
            <p className="text-base text-teal-400 font-medium">
              💬 Please share your feedback using the feedback tab below!
            </p>
          </div>

          {/* Feature Grid */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-10">
            {nextSteps.map((step, idx) => {
              const Icon = step.icon;
              return (
                <button
                  key={idx}
                  onClick={step.action}
                  className="group bg-gray-800/50 hover:bg-gray-800 border border-gray-700 hover:border-gray-600 rounded-xl p-4 text-left transition-all duration-200 hover:scale-[1.02]"
                >
                  <div className="flex items-start gap-3">
                    <div className="flex-shrink-0 w-10 h-10 bg-teal-500/20 border border-teal-500/30 rounded-lg flex items-center justify-center group-hover:scale-110 transition-transform">
                      <Icon className="w-5 h-5 text-teal-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className="font-semibold text-white text-sm mb-0.5 group-hover:text-teal-400 transition-colors">
                        {step.title}
                      </h4>
                      <p className="text-xs text-gray-400 group-hover:text-gray-300 transition-colors">
                        {step.description}
                      </p>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Actions */}
          <div className="flex flex-col sm:flex-row gap-3">
            <button
              onClick={handleClose}
              data-testid="onboarding-done"
              title="Close onboarding and start using StageFlow"
              className="flex-1 px-6 py-4 bg-teal-500 hover:bg-teal-600 text-white rounded-xl font-semibold shadow-lg shadow-teal-500/20 hover:shadow-teal-500/40 transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
            >
              Start Using StageFlow
            </button>
            <button
              onClick={() => {
                // CRITICAL FIX: Use unified storage clearState
                if (userId) {
                  onboardingStorage.clearState(userId);
                  window.location.reload();
                }
              }}
              data-testid="onboarding-replay"
              className="px-6 py-4 border border-gray-700 text-gray-400 hover:text-white hover:bg-gray-800/50 hover:border-gray-600 rounded-xl font-semibold transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
            >
              Replay Tour
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
