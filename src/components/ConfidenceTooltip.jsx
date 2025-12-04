import React, { useState } from 'react';
import { Info, TrendingUp, Calendar, DollarSign, Sparkles, X } from 'lucide-react';

/**
 * Confidence Score Tooltip & Modal
 * Shows how confidence scores are calculated
 * With AI enhancement note
 */
export const ConfidenceTooltip = ({ deal, confidenceScore }) => {
  const [showModal, setShowModal] = useState(false);
  const [showTooltip, setShowTooltip] = useState(false);

  // Calculate breakdown
  const breakdown = calculateConfidenceBreakdown(deal, confidenceScore);

  return (
    <>
      {/* Hover Tooltip */}
      <div 
        className="relative inline-block"
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
      >
        <button
          onClick={() => setShowModal(true)}
          className="p-1 hover:bg-[#1ABC9C]/10 rounded-full transition-colors group"
          title="How is this calculated?"
        >
          <Info className="w-3.5 h-3.5 text-[#9CA3AF] group-hover:text-[#1ABC9C] transition-colors" />
        </button>

        {/* Quick Tooltip */}
        {showTooltip && (
          <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 w-64 z-50 animate-fadeIn">
            <div className="bg-[#1A1A1A] text-white text-xs rounded-lg p-3 shadow-2xl">
              <p className="font-semibold mb-2">Confidence Score</p>
              <p className="text-[#E0E0E0]/80">
                Based on deal stage, age, and value. Click for detailed breakdown.
              </p>
              <div className="absolute -bottom-1 left-1/2 transform -translate-x-1/2 w-2 h-2 bg-[#1A1A1A] rotate-45" />
            </div>
          </div>
        )}
      </div>

      {/* Detailed Modal */}
      {showModal && (
        <div className="fixed inset-0 modal-backdrop-apple flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-[#0D1F2D] rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            {/* Header */}
            <div className="sticky top-0 bg-white dark:bg-[#0D1F2D] border-b border-[#E0E0E0] dark:border-gray-700 p-6 flex items-center justify-between z-10">
              <div>
                <h2 className="text-2xl font-bold text-[#1A1A1A] dark:text-[#E0E0E0] flex items-center gap-2">
                  <TrendingUp className="w-6 h-6 text-[#1ABC9C]" />
                  Confidence Score Breakdown
                </h2>
                <p className="text-sm text-[#6B7280] dark:text-[#9CA3AF] mt-1">
                  How we calculate deal confidence
                </p>
              </div>
              <button 
                onClick={() => setShowModal(false)} 
                className="text-[#9CA3AF] hover:text-[#1A1A1A] dark:hover:text-white"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            {/* Content */}
            <div className="p-6 space-y-6">
              {/* Current Score */}
              <div className="bg-gradient-to-br from-[#2C3E50]/10 via-[#34495E]/10 to-[#1ABC9C]/10 rounded-xl p-6">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-medium text-[#61788A] dark:text-[#ABCAE2]">
                    Current Confidence
                  </span>
                  <span className="text-4xl font-bold bg-gradient-to-r from-[#2C3E50] via-[#34495E] to-[#1ABC9C] bg-clip-text text-transparent">
                    {confidenceScore}%
                  </span>
                </div>
                <div className="w-full h-3 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                  <div
                    className="h-full transition-all duration-500 bg-gradient-to-r from-[#2C3E50] via-[#34495E] to-[#1ABC9C]"
                    style={{ width: `${confidenceScore}%` }}
                  />
                </div>
              </div>

              {/* Breakdown */}
              <div className="space-y-4">
                <h3 className="text-lg font-bold text-[#1A1A1A] dark:text-[#E0E0E0]">
                  Score Components
                </h3>

                {/* Stage Score */}
                <div className="p-4 bg-[#F9FAFB] dark:bg-[#121212] rounded-lg">
                  <div className="flex items-start gap-3 mb-2">
                    <div className="p-2 bg-[#2563eb]/10 rounded-lg">
                      <TrendingUp className="w-5 h-5 text-[#2563eb]" />
                    </div>
                    <div className="flex-1">
                      <h4 className="font-semibold text-[#1A1A1A] dark:text-[#E0E0E0]">
                        Deal Stage: {breakdown.stage.score}%
                      </h4>
                      <p className="text-sm text-[#61788A] dark:text-[#ABCAE2] mt-1">
                        {breakdown.stage.reason}
                      </p>
                    </div>
                  </div>
                  <div className="ml-14 text-xs text-[#9CA3AF]">
                    Early stages (20-40%) → Mid stages (50-70%) → Final stages (80-100%)
                  </div>
                </div>

                {/* Age Score */}
                <div className="p-4 bg-[#F9FAFB] dark:bg-[#121212] rounded-lg">
                  <div className="flex items-start gap-3 mb-2">
                    <div className="p-2 bg-[#F39C12]/10 rounded-lg">
                      <Calendar className="w-5 h-5 text-[#F39C12]" />
                    </div>
                    <div className="flex-1">
                      <h4 className="font-semibold text-[#1A1A1A] dark:text-[#E0E0E0]">
                        Deal Age: {breakdown.age.modifier >= 0 ? '+' : ''}{breakdown.age.modifier}%
                      </h4>
                      <p className="text-sm text-[#61788A] dark:text-[#ABCAE2] mt-1">
                        {breakdown.age.reason}
                      </p>
                    </div>
                  </div>
                  <div className="ml-14 text-xs text-[#9CA3AF]">
                    Penalties: &gt;90 days (-20%), &gt;60 days (-10%), &gt;30 days (-5%)
                  </div>
                </div>

                {/* Value Score */}
                <div className="p-4 bg-[#F9FAFB] dark:bg-[#121212] rounded-lg">
                  <div className="flex items-start gap-3 mb-2">
                    <div className="p-2 bg-[#27AE60]/10 rounded-lg">
                      <DollarSign className="w-5 h-5 text-[#27AE60]" />
                    </div>
                    <div className="flex-1">
                      <h4 className="font-semibold text-[#1A1A1A] dark:text-[#E0E0E0]">
                        Deal Value: {breakdown.value.modifier >= 0 ? '+' : ''}{breakdown.value.modifier}%
                      </h4>
                      <p className="text-sm text-[#61788A] dark:text-[#ABCAE2] mt-1">
                        {breakdown.value.reason}
                      </p>
                    </div>
                  </div>
                  <div className="ml-14 text-xs text-[#9CA3AF]">
                    Bonuses: &gt;$50k (+5%), &gt;$10k (+3%)
                  </div>
                </div>
              </div>

              {/* AI Enhancement Note */}
              <div className="bg-gradient-to-br from-purple-50 to-blue-50 dark:from-purple-900/20 dark:to-blue-900/20 border-2 border-purple-200 dark:border-purple-800 rounded-xl p-6">
                <div className="flex items-start gap-3">
                  <div className="p-2 bg-purple-500/10 rounded-lg">
                    <Sparkles className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                  </div>
                  <div className="flex-1">
                    <h4 className="font-bold text-[#1A1A1A] dark:text-[#E0E0E0] mb-2">
                      AI Enhancement Available
                    </h4>
                    <p className="text-sm text-[#61788A] dark:text-[#ABCAE2] mb-3">
                      These base confidence scores provide reliable deal insights. When you connect an AI provider (ChatGPT, Claude, or Gemini), confidence calculations become <span className="font-semibold text-purple-600 dark:text-purple-400">dynamic and adaptive</span>.
                    </p>
                    <p className="text-sm text-[#61788A] dark:text-[#ABCAE2]">
                      <span className="font-semibold">The more deals you process, the smarter it gets.</span> AI learns from your historical win/loss patterns, stage conversion rates, and customer interactions to provide increasingly accurate predictions over time.
                    </p>
                  </div>
                </div>
              </div>

              {/* Formula */}
              <div className="border-t border-[#E0E0E0] dark:border-gray-700 pt-4">
                <h4 className="text-sm font-semibold text-[#61788A] dark:text-[#ABCAE2] mb-2">
                  Base Formula
                </h4>
                <code className="block p-3 bg-[#1A1A1A] dark:bg-black text-[#1ABC9C] text-xs rounded-lg font-mono">
                  confidence = stage_base + age_modifier + value_modifier
                </code>
                <p className="text-xs text-[#9CA3AF] mt-2">
                  Clamped between 0-100%
                </p>
              </div>
            </div>

            {/* Footer */}
            <div className="sticky bottom-0 bg-white dark:bg-[#0D1F2D] border-t border-[#E0E0E0] dark:border-gray-700 p-6">
              <button
                onClick={() => setShowModal(false)}
                className="w-full bg-[#1ABC9C] hover:bg-[#16A085] text-white px-6 py-3 rounded-lg font-semibold transition"
              >
                Got it!
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

/**
 * Calculate detailed confidence breakdown
 */
function calculateConfidenceBreakdown(deal, finalScore) {
  // FIX H2: COMPREHENSIVE stage scoring covering ALL pipeline templates
  // Fixed duplicate keys - each stage appears only once
  const stageScores = {
    // Legacy default stages
    lead: 30, quote: 50, approval: 65, invoice: 80,
    onboarding: 90, delivery: 95, retention: 100, lost: 0,

    // New default pipeline
    lead_captured: 25, lead_qualified: 35, contacted: 40, needs_identified: 50,
    proposal_sent: 60, negotiation: 70, deal_won: 100, deal_lost: 0,
    invoice_sent: 85, payment_received: 95, customer_onboarded: 98,

    // Healthcare pipeline
    lead_generation: 25, lead_qualification: 35, discovery: 45, scope_defined: 55,
    contract_sent: 65, client_onboarding: 90, renewal_upsell: 100,

    // VC/PE pipeline
    deal_sourced: 20, initial_screening: 35, due_diligence: 50, term_sheet_presented: 65,
    investment_closed: 100, capital_call_sent: 85, capital_received: 95, portfolio_mgmt: 100,

    // Real Estate pipeline
    qualification: 35, property_showing: 50, contract_signed: 100,
    closing_statement_sent: 85, escrow_completed: 95, client_followup: 100,

    // Professional Services pipeline
    lead_identified: 25,

    // SaaS pipeline
    prospecting: 20, contact: 35, proposal: 60,
    closed: 100, adoption: 95, renewal: 100
  };

  const stageScore = stageScores[deal.stage] || 30; // FIX H2: Lower default from 70% to 30%
  
  // Age modifier
  const daysOld = Math.floor(
    (new Date() - new Date(deal.created || deal.created_at)) / (1000 * 60 * 60 * 24)
  );
  
  let ageModifier = 0;
  let ageReason = `Deal is ${daysOld} days old - no age penalty applied`;
  
  if (daysOld > 90) {
    ageModifier = -20;
    ageReason = `Deal is ${daysOld} days old - significant age penalty applied`;
  } else if (daysOld > 60) {
    ageModifier = -10;
    ageReason = `Deal is ${daysOld} days old - moderate age penalty applied`;
  } else if (daysOld > 30) {
    ageModifier = -5;
    ageReason = `Deal is ${daysOld} days old - minor age penalty applied`;
  }
  
  // Value modifier
  let valueModifier = 0;
  const dealValue = Number(deal.value) || 0;
  let valueReason = `Deal value $${dealValue.toLocaleString()} - standard scoring`;

  if (dealValue > 50000) {
    valueModifier = 5;
    valueReason = `High-value deal ($${dealValue.toLocaleString()}) - bonus applied`;
  } else if (dealValue > 10000) {
    valueModifier = 3;
    valueReason = `Mid-value deal ($${dealValue.toLocaleString()}) - small bonus applied`;
  }
  
  return {
    stage: {
      score: stageScore,
      reason: `Deal is in "${deal.stage}" stage`,
      stages: 'Lead: 30% → Quote: 50% → Approval: 65% → Invoice: 80% → Delivery: 95% → Retention: 100%'
    },
    age: {
      modifier: ageModifier,
      reason: ageReason
    },
    value: {
      modifier: valueModifier,
      reason: valueReason
    }
  };
}
