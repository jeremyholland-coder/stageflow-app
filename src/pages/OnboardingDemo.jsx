import React, { useState } from 'react';
import { WelcomeModal } from '../components/WelcomeModal';
import { OnboardingGoalSelection } from '../components/OnboardingGoalSelection';
import { OnboardingChecklist } from '../components/OnboardingChecklist';
import { OnboardingCompletionModal } from '../components/OnboardingCompletionModal';

/**
 * DEMO PAGE - Test Onboarding Flow Without Auth
 * Access at: http://localhost:8888/onboarding-demo
 */
export default function OnboardingDemo() {
  const [showWelcome, setShowWelcome] = useState(true);
  const [showGoalSelection, setShowGoalSelection] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [selectedGoal, setSelectedGoal] = useState(null);

  const handleWelcomeClose = () => {
    setShowWelcome(false);
    setShowGoalSelection(true);
  };

  const handleGoalSelected = (goal) => {
    setSelectedGoal(goal);
    setShowGoalSelection(false);
    setShowOnboarding(true);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 to-black">
      {/* Welcome Modal */}
      <WelcomeModal
        isOpen={showWelcome}
        onClose={handleWelcomeClose}
      />

      {/* Goal Selection */}
      {showGoalSelection && (
        <OnboardingGoalSelection
          onGoalSelected={handleGoalSelected}
          onClose={() => setShowGoalSelection(false)}
        />
      )}

      {/* Mock Dashboard Background */}
      <div className="p-8">
        <div className="max-w-7xl mx-auto">
          <h1 className="text-3xl font-bold text-white mb-8">Your Pipeline</h1>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {['Lead', 'Qualified', 'Proposal', 'Won'].map((stage) => (
              <div key={stage} className="bg-gray-800/50 border border-gray-700 rounded-xl p-6 min-h-96">
                <h3 className="text-gray-400 mb-4">{stage}</h3>
                {stage === 'Lead' && (
                  <div className="bg-gray-900 border border-gray-700 rounded-lg p-4">
                    <div className="text-white font-semibold">Sample Deal</div>
                    <div className="text-gray-400 text-sm">$5,000</div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Onboarding Checklist */}
      {showOnboarding && (
        <OnboardingChecklist
          userGoal={selectedGoal}
        />
      )}

      {/* Reset Button */}
      <div className="fixed bottom-6 left-6 z-50">
        <button
          onClick={() => {
            setShowWelcome(true);
            setShowGoalSelection(false);
            setShowOnboarding(false);
            setSelectedGoal(null);
          }}
          className="bg-gray-800 hover:bg-gray-700 text-white font-semibold py-3 px-6 rounded-xl border border-gray-600 shadow-lg transition-all"
        >
          🔄 Reset Demo
        </button>
      </div>
    </div>
  );
}
