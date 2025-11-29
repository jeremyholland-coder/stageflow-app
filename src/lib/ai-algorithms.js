// AI/ML Algorithms for Deal Intelligence
// FIX PHASE 1-6: Complete refactor to support dynamic multi-pipeline system
// All algorithms now accept pipelineStages parameter for full industry customization

import { Users, FileText, Clock, DollarSign, Target, Zap, TrendingUp, XCircle } from 'lucide-react';

/**
 * PHASE 2: Helper function to get stage index from pipeline stages
 * Handles both stage objects with stage_order and fallback to array position
 */
const getStageIndex = (deal, pipelineStages) => {
  if (!pipelineStages || pipelineStages.length === 0) return 0;

  const stageIndex = pipelineStages.findIndex(s => s.id === deal.stage);
  if (stageIndex === -1) return 0; // Stage not found, assume early stage

  return stageIndex;
};

/**
 * PHASE 3: Calculate lead score with dynamic pipeline support
 * @param {Object} deal - Deal object with stage, value, last_activity, notes
 * @param {Array} pipelineStages - Dynamic pipeline stages for the organization
 * @returns {number} Score from 0-100
 */
export const calculateLeadScore = (deal, pipelineStages = []) => {
  let score = 50;

  // Value tiers - universal across all industries
  if (deal.value > 100000) score += 20;
  else if (deal.value > 50000) score += 15;
  else if (deal.value > 10000) score += 10;
  else if (deal.value < 1000) score -= 10;

  // Activity recency - universal metric
  const daysSinceActivity = Math.floor(
    (new Date() - new Date(deal.last_activity || deal.created_at || new Date())) / (1000 * 60 * 60 * 24)
  );
  if (daysSinceActivity < 3) score += 15;
  else if (daysSinceActivity < 7) score += 10;
  else if (daysSinceActivity < 14) score += 5;
  else if (daysSinceActivity > 30) score -= 15;
  else if (daysSinceActivity > 14) score -= 10;

  // Stage progression - now pipeline-aware!
  // Deals past halfway point in ANY pipeline get bonus
  if (pipelineStages && pipelineStages.length > 0) {
    const stageIndex = getStageIndex(deal, pipelineStages);
    const progressPercentage = (stageIndex / pipelineStages.length) * 100;

    if (progressPercentage >= 50) score += 10; // Past halfway
    if (progressPercentage >= 75) score += 5;  // Near completion
  }

  // Notes quality - indicates engagement
  if (deal.notes && deal.notes.length > 50) score += 5;

  return Math.max(0, Math.min(100, score));
};

/**
 * PHASE 3: Get deal health status
 */
export const getDealHealth = (deal, pipelineStages = []) => {
  const score = calculateLeadScore(deal, pipelineStages);
  if (score >= 75) return { status: 'healthy', color: 'emerald', label: 'Healthy' };
  if (score >= 50) return { status: 'moderate', color: 'amber', label: 'Needs Attention' };
  return { status: 'risk', color: 'red', label: 'At Risk' };
};

/**
 * PHASE 4: Calculate win probability with dynamic pipeline support
 * Uses stage position to determine base probability, then adjusts for deal health
 */
export const getWinProbability = (deal, pipelineStages = []) => {
  const score = calculateLeadScore(deal, pipelineStages);

  if (!pipelineStages || pipelineStages.length === 0) {
    // Fallback if no pipeline stages provided
    return score >= 75 ? 60 : score >= 50 ? 40 : 20;
  }

  // Calculate probability based on stage position in pipeline
  const stageIndex = getStageIndex(deal, pipelineStages);
  const progressPercentage = (stageIndex / pipelineStages.length) * 100;

  // Base probability increases with stage progression
  // Early stages: 10-30%, Mid stages: 40-60%, Late stages: 70-90%
  let probability = Math.floor(10 + (progressPercentage * 0.8)); // 10% + up to 80%

  // Adjust based on deal health score
  if (score >= 75) probability = Math.min(95, probability + 10);
  else if (score < 50) probability = Math.max(5, probability - 15);

  return Math.max(5, Math.min(95, probability));
};

/**
 * PHASE 6: Get next best action - now pipeline-aware with stage-specific actions
 */
export const getNextBestAction = (deal, pipelineStages = []) => {
  const daysSinceActivity = Math.floor(
    (new Date() - new Date(deal.last_activity || deal.created_at || new Date())) / (1000 * 60 * 60 * 24)
  );

  // Universal rules based on activity recency
  if (daysSinceActivity > 14) {
    return { icon: 'AlertCircle', text: 'Follow up urgently - no activity in 14+ days', priority: 'high' };
  }
  if (daysSinceActivity > 7) {
    return { icon: 'Clock', text: 'Schedule follow-up call this week', priority: 'medium' };
  }

  // Stage-specific actions - comprehensive mapping for ALL pipeline templates
  const stageActions = {
    // Legacy default stages
    lead: { icon: 'FileText', text: 'Send proposal or quote', priority: 'high' },
    quote: { icon: 'Clock', text: 'Follow up on quote review', priority: 'medium' },
    approval: { icon: 'CheckCircle', text: 'Check approval status', priority: 'high' },
    invoice: { icon: 'DollarSign', text: 'Confirm invoice received', priority: 'high' },
    onboarding: { icon: 'Users', text: 'Schedule onboarding call', priority: 'medium' },
    delivery: { icon: 'Zap', text: 'Ensure delivery on schedule', priority: 'medium' },
    retention: { icon: 'TrendingUp', text: 'Schedule check-in for upsell', priority: 'low' },
    lost: { icon: 'XCircle', text: 'Document lessons learned', priority: 'low' },

    // New default pipeline
    lead_captured: { icon: 'Users', text: 'Qualify lead and schedule call', priority: 'high' },
    lead_qualified: { icon: 'Phone', text: 'Make initial contact', priority: 'high' },
    contacted: { icon: 'Search', text: 'Conduct needs assessment', priority: 'high' },
    needs_identified: { icon: 'FileText', text: 'Prepare and send proposal', priority: 'high' },
    proposal_sent: { icon: 'Clock', text: 'Follow up on proposal review', priority: 'medium' },
    negotiation: { icon: 'CheckCircle', text: 'Address objections and finalize terms', priority: 'high' },
    deal_won: { icon: 'Trophy', text: 'Celebrate and prepare for delivery!', priority: 'low' },
    deal_lost: { icon: 'XCircle', text: 'Document feedback for future', priority: 'low' },
    invoice_sent: { icon: 'DollarSign', text: 'Confirm invoice received and payment timeline', priority: 'high' },
    payment_received: { icon: 'CheckCircle2', text: 'Begin onboarding process', priority: 'high' },
    customer_onboarded: { icon: 'Package', text: 'Check customer satisfaction', priority: 'medium' },

    // Healthcare pipeline
    lead_generation: { icon: 'Users', text: 'Qualify healthcare provider', priority: 'high' },
    lead_qualification: { icon: 'UserCheck', text: 'Verify compliance requirements', priority: 'high' },
    discovery: { icon: 'Search', text: 'Conduct clinical needs assessment', priority: 'high' },
    scope_defined: { icon: 'ClipboardCheck', text: 'Finalize scope and compliance docs', priority: 'high' },
    contract_sent: { icon: 'Send', text: 'Follow up on contract review', priority: 'high' },
    client_onboarding: { icon: 'Package', text: 'Complete compliance training', priority: 'medium' },
    renewal_upsell: { icon: 'RefreshCw', text: 'Identify expansion opportunities', priority: 'medium' },

    // VC/PE pipeline
    deal_sourced: { icon: 'Users', text: 'Conduct initial screening', priority: 'high' },
    initial_screening: { icon: 'UserCheck', text: 'Request financials and deck', priority: 'high' },
    due_diligence: { icon: 'Clipboard', text: 'Complete diligence checklist', priority: 'high' },
    term_sheet_presented: { icon: 'FileText', text: 'Negotiate terms', priority: 'high' },
    investment_closed: { icon: 'Trophy', text: 'Execute closing documents', priority: 'high' },
    capital_call_sent: { icon: 'Send', text: 'Track capital commitments', priority: 'high' },
    capital_received: { icon: 'DollarSign', text: 'Confirm wire received', priority: 'high' },
    portfolio_mgmt: { icon: 'TrendingUp', text: 'Schedule board meeting', priority: 'medium' },

    // Real Estate pipeline
    qualification: { icon: 'UserCheck', text: 'Verify financing pre-approval', priority: 'high' },
    property_showing: { icon: 'Home', text: 'Schedule additional showings', priority: 'medium' },
    contract_signed: { icon: 'Trophy', text: 'Coordinate inspection', priority: 'high' },
    closing_statement_sent: { icon: 'Send', text: 'Review closing disclosures', priority: 'high' },
    escrow_completed: { icon: 'DollarSign', text: 'Confirm funds cleared', priority: 'high' },
    client_followup: { icon: 'RefreshCw', text: 'Request referrals', priority: 'low' },

    // Professional Services pipeline
    lead_identified: { icon: 'Users', text: 'Research client organization', priority: 'high' },
    lead_qualified: { icon: 'UserCheck', text: 'Schedule discovery call', priority: 'high' },

    // SaaS pipeline
    prospecting: { icon: 'Target', text: 'Research company and pain points', priority: 'high' },
    qualification: { icon: 'UserCheck', text: 'Qualify budget and authority', priority: 'high' },
    contact: { icon: 'Phone', text: 'Make outreach attempt', priority: 'high' },
    proposal: { icon: 'FileText', text: 'Customize demo for their use case', priority: 'high' },
    closed: { icon: 'Trophy', text: 'Send welcome email and onboarding', priority: 'high' },
    adoption: { icon: 'Activity', text: 'Check usage metrics', priority: 'medium' },
    renewal: { icon: 'RefreshCw', text: 'Present renewal terms', priority: 'medium' }
  };

  // Return stage-specific action or intelligent fallback
  if (stageActions[deal.stage]) {
    return stageActions[deal.stage];
  }

  // Intelligent fallback based on stage position
  if (pipelineStages && pipelineStages.length > 0) {
    const stageIndex = getStageIndex(deal, pipelineStages);
    const progressPercentage = (stageIndex / pipelineStages.length) * 100;

    if (progressPercentage < 25) {
      return { icon: 'Users', text: 'Build relationship and qualify needs', priority: 'high' };
    } else if (progressPercentage < 50) {
      return { icon: 'FileText', text: 'Present solution and value proposition', priority: 'high' };
    } else if (progressPercentage < 75) {
      return { icon: 'CheckCircle', text: 'Address concerns and finalize agreement', priority: 'high' };
    } else {
      return { icon: 'Trophy', text: 'Ensure smooth delivery and satisfaction', priority: 'medium' };
    }
  }

  return { icon: 'Lightbulb', text: 'Update deal with latest progress', priority: 'low' };
};

/**
 * PHASE 5: Predict close date based on pipeline stages remaining
 * Assumes average of 7 days per stage (configurable per industry)
 */
export const getPredictedCloseDate = (deal, pipelineStages = [], daysPerStage = 7) => {
  if (!pipelineStages || pipelineStages.length === 0) {
    // Fallback: assume 30 days
    const closeDate = new Date();
    closeDate.setDate(closeDate.getDate() + 30);
    return closeDate;
  }

  const stageIndex = getStageIndex(deal, pipelineStages);
  const stagesRemaining = pipelineStages.length - stageIndex - 1;
  const daysToClose = Math.max(0, stagesRemaining * daysPerStage);

  const closeDate = new Date();
  closeDate.setDate(closeDate.getDate() + daysToClose);
  return closeDate;
};
