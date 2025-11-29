import React, { memo } from 'react';
import { ArrowRight, Brain, TrendingUp, Users, Settings } from 'lucide-react';
import { StageFlowLogoSVG } from './StageFlowLogo';

/**
 * Welcome Modal - Premium Full-Page Unveiling Experience
 * Shows 4 key value propositions before the user enters the app
 *
 * OPT-5: PERFORMANCE FIX - Memoized with React.memo
 * Prevents unnecessary re-renders when parent Dashboard updates
 */
export const WelcomeModal = memo(({ isOpen, onClose }) => {
  if (!isOpen) return null;

  const valueProps = [
    {
      icon: Brain,
      title: 'AI-Powered Pipeline',
      description: 'Intelligent deal scoring and predictive insights that help you focus on what matters most',
      gradient: 'from-purple-500 to-indigo-500',
      shadow: 'shadow-purple-500/20'
    },
    {
      icon: TrendingUp,
      title: 'Close More Deals',
      description: 'Revenue-focused tools and real-time analytics to accelerate your sales cycle and hit targets',
      gradient: 'from-teal-500 to-emerald-500',
      shadow: 'shadow-teal-500/20'
    },
    {
      icon: Users,
      title: 'Team Collaboration',
      description: 'Real-time updates, shared insights, and weekly performance feedback that keeps everyone aligned',
      gradient: 'from-blue-500 to-cyan-500',
      shadow: 'shadow-blue-500/20'
    },
    {
      icon: Settings,
      title: 'Personalized Workspace',
      description: 'Customize your pipeline, automate workflows, and tailor the experience to your sales process',
      gradient: 'from-amber-500 to-orange-500',
      shadow: 'shadow-amber-500/20'
    }
  ];

  return (
    <div className="fixed inset-0 bg-black/98 backdrop-blur-md z-[100] overflow-y-auto animate-fadeIn" data-testid="welcome-modal">
      <div className="min-h-screen flex items-center justify-center px-4 sm:px-6 md:px-8 py-12 sm:py-16 md:py-20">
        <div className="w-full max-w-5xl mx-auto animate-slideUp">
          {/* Header */}
          <div className="text-center mb-5 sm:mb-6 md:mb-7">
            {/* Logo/Icon - Larger, More Prominent Dark Glass Circle */}
            <div className="w-24 h-24 sm:w-28 sm:h-28 md:w-32 md:h-32 mx-auto mb-4 relative">
              <div className="absolute inset-0 rounded-full bg-gradient-to-br from-teal-500 to-emerald-500 opacity-10 blur-2xl animate-pulse"></div>
              <div className="relative w-full h-full rounded-full bg-gradient-to-br from-gray-900 to-black border border-teal-500/30 shadow-2xl shadow-teal-500/20 flex items-center justify-center backdrop-blur-sm p-4 sm:p-5">
                <StageFlowLogoSVG size="lg" className="w-full h-full" />
              </div>
            </div>

            {/* Title */}
            <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold text-white mb-2 sm:mb-3 tracking-tight px-4">
              Welcome to <span className="text-transparent bg-clip-text bg-gradient-to-r from-teal-400 to-emerald-400">StageFlow</span>
            </h1>

            <p className="text-sm sm:text-base md:text-lg text-gray-300 max-w-2xl mx-auto leading-relaxed px-4 sm:px-6">
              The most powerful sales pipeline platform built for modern <span className="text-transparent bg-clip-text bg-gradient-to-r from-teal-400 to-emerald-400">teams</span>
            </p>
          </div>

          {/* 4 Value Proposition Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4 mb-5 sm:mb-6">
            {valueProps.map((prop, index) => {
              const Icon = prop.icon;
              return (
                <div
                  key={index}
                  className="group bg-gradient-to-br from-gray-900 to-black border border-teal-500/30 rounded-2xl p-4 sm:p-5 hover:border-teal-500/50 transition-all duration-300 hover:scale-[1.02] shadow-xl hover:shadow-2xl"
                  style={{ animationDelay: `${index * 100}ms` }}
                >
                  {/* Icon */}
                  <div className="mb-3">
                    <div className={`w-11 h-11 sm:w-12 sm:h-12 rounded-xl bg-gradient-to-br ${prop.gradient} p-0.5 ${prop.shadow} shadow-lg`}>
                      <div className="w-full h-full bg-black/40 backdrop-blur-sm rounded-xl flex items-center justify-center">
                        <Icon className="w-7 h-7 sm:w-8 sm:h-8 text-white" strokeWidth={2.5} />
                      </div>
                    </div>
                  </div>

                  {/* Content */}
                  <h3 className="text-base sm:text-lg font-bold text-white mb-1.5">
                    {prop.title}
                  </h3>
                  <p className="text-sm text-gray-400 leading-relaxed">
                    {prop.description}
                  </p>
                </div>
              );
            })}
          </div>

          {/* CTA Section */}
          <div className="text-center">
            <button
              onClick={onClose}
              data-testid="welcome-dismiss"
              title="Close welcome screen and explore StageFlow"
              className="group px-10 py-4 sm:px-12 sm:py-5 bg-gradient-to-r from-teal-500 to-emerald-500 hover:from-teal-600 hover:to-emerald-600 text-white text-base sm:text-lg font-bold rounded-xl transition-all duration-200 inline-flex items-center justify-center gap-2 shadow-2xl shadow-teal-500/30 hover:shadow-teal-500/50 hover:scale-[1.05] active:scale-[0.98]"
            >
              <span>Let's Get Started</span>
              <ArrowRight className="w-5 h-5 sm:w-6 sm:h-6 group-hover:translate-x-1 transition-transform" />
            </button>

            <p className="text-xs sm:text-sm text-gray-500 mt-4 sm:mt-5">
              No credit card required • Start free forever
            </p>
          </div>
        </div>
      </div>
    </div>
  );
});
