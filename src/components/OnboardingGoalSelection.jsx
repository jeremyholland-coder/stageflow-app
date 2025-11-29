import React, { useState } from 'react';
import { Target, Zap, TrendingUp, Users, ArrowRight } from 'lucide-react';

/**
 * Onboarding Goal Selection - Premium UI
 * Matches the beautiful design system from the Update Available modal
 */
export const OnboardingGoalSelection = ({ isOpen, onGoalSelected }) => {
  const [selectedGoal, setSelectedGoal] = useState(null);

  if (!isOpen) return null;

  const goals = [
    {
      id: 'deals',
      title: 'Manage Deals',
      description: 'Track and close more sales opportunities',
      icon: Target,
      color: '#1ABC9C'
    },
    {
      id: 'automation',
      title: 'Automate Workflows',
      description: 'Save time with intelligent automation',
      icon: Zap,
      color: '#F39C12'
    },
    {
      id: 'analytics',
      title: 'Track Performance',
      description: 'Gain insights with powerful analytics',
      icon: TrendingUp,
      color: '#3498DB'
    },
    {
      id: 'team',
      title: 'Collaborate with Team',
      description: 'Work together more effectively',
      icon: Users,
      color: '#9B59B6'
    }
  ];

  const handleGoalSelect = (goalId) => {
    setSelectedGoal(goalId);
  };

  const handleContinue = () => {
    if (selectedGoal && onGoalSelected) {
      onGoalSelected(selectedGoal);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/95 backdrop-blur-sm z-[100] flex items-center justify-center p-4 animate-fadeIn" data-testid="onboarding-goal-modal">
      <div className="bg-gradient-to-br from-gray-900 to-black border border-teal-500/30 rounded-2xl max-w-3xl w-full shadow-2xl animate-slideUp overflow-hidden">
        <div className="relative p-12">
          {/* Header */}
          <div className="text-center mb-10">
            <h1 className="text-4xl font-bold text-white mb-3 tracking-tight">
              What's your main goal?
            </h1>
            <p className="text-lg text-white/60">
              Choose one so we can personalize your experience
            </p>
          </div>

          {/* Goal Cards Grid */}
          <div className="grid grid-cols-2 gap-4 mb-10">
            {goals.map((goal, index) => {
              const Icon = goal.icon;
              const isSelected = selectedGoal === goal.id;

              return (
                <button
                  key={goal.id}
                  onClick={() => handleGoalSelect(goal.id)}
                  data-testid={`goal-${goal.id}`}
                  className={`group relative bg-gray-800/50 border rounded-xl p-6 transition-all duration-200 hover:scale-[1.02] text-left ${
                    isSelected
                      ? 'border-teal-500 bg-teal-500/10 shadow-lg shadow-teal-500/20'
                      : 'border-gray-700 hover:border-gray-600 hover:bg-gray-800'
                  }`}
                  style={{ animationDelay: `${index * 100}ms` }}
                >
                  {/* Selection indicator */}
                  {isSelected && (
                    <div className="absolute top-4 right-4 w-6 h-6 bg-teal-500 rounded-full flex items-center justify-center animate-in zoom-in duration-300">
                      <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                  )}

                  {/* Icon - Clean Apple-style design without glow */}
                  <div className="w-14 h-14 mb-4 relative">
                    <div
                      className="w-full h-full border-2 rounded-xl flex items-center justify-center backdrop-blur-sm group-hover:scale-110 transition-transform"
                      style={{
                        borderColor: `${goal.color}40`,
                        backgroundColor: `${goal.color}20`
                      }}
                    >
                      <Icon className="w-7 h-7 text-white drop-shadow-lg" strokeWidth={2.5} />
                    </div>
                  </div>

                  {/* Content */}
                  <h3 className="text-lg font-bold text-white mb-1.5">
                    {goal.title}
                  </h3>
                  <p className="text-sm text-gray-400 group-hover:text-gray-300 transition-colors">
                    {goal.description}
                  </p>
                </button>
              );
            })}
          </div>

          {/* Actions */}
          <div className="flex flex-col gap-3">
            <button
              onClick={handleContinue}
              disabled={!selectedGoal}
              className={`group w-full py-4 rounded-xl font-semibold text-lg transition-all duration-200 inline-flex items-center justify-center gap-3 ${
                selectedGoal
                  ? 'bg-teal-500 hover:bg-teal-600 text-white shadow-lg shadow-teal-500/20 hover:shadow-teal-500/40 hover:scale-[1.02] active:scale-[0.98]'
                  : 'bg-gray-800/50 text-gray-600 cursor-not-allowed'
              }`}
            >
              <span>Continue</span>
              {selectedGoal && (
                <ArrowRight className="w-5 h-5" />
              )}
            </button>

            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => onGoalSelected('default')}
                data-testid="goal-default"
                className="py-3 border border-teal-500/30 text-teal-400 hover:text-teal-300 hover:border-teal-500/50 hover:bg-teal-500/10 rounded-xl font-medium transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
              >
                See Everything
              </button>
              <button
                onClick={() => onGoalSelected('skip')}
                data-testid="goal-skip"
                className="py-3 border border-gray-700 text-gray-400 hover:text-white hover:border-gray-600 hover:bg-gray-800/50 rounded-xl font-medium transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
              >
                Skip for now
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
