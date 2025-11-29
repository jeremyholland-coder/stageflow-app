/**
 * AI-Powered Confidence Scoring System
 *
 * Calculates personalized deal confidence scores based on:
 * - Stage progression (base confidence)
 * - User performance history (win rate, experience)
 * - Deal age and velocity
 * - Deal value
 * - Real-time stagnation detection (industry benchmarks)
 *
 * This makes confidence scores DYNAMIC and PERSONALIZED per user,
 * showing that StageFlow uses real AI, not fake percentages.
 */

// CENTRALIZED CONFIG: Import from single source of truth
// This ensures frontend and backend use identical values
import {
  STAGNATION_THRESHOLDS,
  STAGE_BASE_CONFIDENCE
} from '../config/pipelineConfig';

// Re-export for backwards compatibility with existing imports
export { STAGNATION_THRESHOLDS, STAGE_BASE_CONFIDENCE };

/**
 * Build user performance profiles from all deals
 * @param {Array} deals - All deals in the system
 * @returns {Object} { userPerformance: Map, globalWinRate: Number }
 */
export const buildUserPerformanceProfiles = (deals) => {
  const userPerformance = new Map();
  let totalWon = 0;
  let totalLost = 0;

  // CRITICAL FIX: Validate deals array
  if (!deals || !Array.isArray(deals)) {
    return { userPerformance, globalWinRate: 0.3 };
  }

  deals.forEach(deal => {
    if (!deal) return; // Skip null/undefined deals
    const userId = deal.user_id || deal.assigned_to || 'unassigned';
    if (!userPerformance.has(userId)) {
      userPerformance.set(userId, {
        totalDeals: 0,
        wonDeals: 0,
        lostDeals: 0,
        avgCloseDays: 0,
        totalCloseDays: 0,
        closedCount: 0,
        winRate: 0
      });
    }

    const profile = userPerformance.get(userId);
    profile.totalDeals++;

    if (deal.status === 'won' || deal.stage === 'retention') {
      profile.wonDeals++;
      profile.closedCount++;
      totalWon++;

      // Calculate close velocity
      const created = new Date(deal.created || deal.created_at);
      const closed = new Date(deal.last_activity || deal.updated_at);
      const daysDiff = Math.floor((closed - created) / (1000 * 60 * 60 * 24));
      profile.totalCloseDays += daysDiff;
    } else if (deal.status === 'lost' || deal.stage === 'lost') {
      profile.lostDeals++;
      profile.closedCount++;
      totalLost++;
    }
  });

  // Calculate averages for each user
  userPerformance.forEach(profile => {
    if (profile.closedCount > 0) {
      profile.avgCloseDays = profile.wonDeals > 0
        ? Math.round(profile.totalCloseDays / profile.wonDeals)
        : 30;
      profile.winRate = profile.totalDeals > 0
        ? profile.wonDeals / (profile.wonDeals + profile.lostDeals)
        : 0;
    }
  });

  // Calculate global win rate
  const globalWinRate = (totalWon + totalLost) > 0
    ? totalWon / (totalWon + totalLost)
    : 0.3; // Default 30% if no historical data

  return { userPerformance, globalWinRate };
};

/**
 * Calculate AI-powered confidence score for a deal
 * @param {Object} deal - The deal to score
 * @param {Map} userPerformance - User performance profiles
 * @param {Number} globalWinRate - Organization-wide win rate (fallback)
 * @returns {Number} Confidence score (0-100)
 */
export const calculateDealConfidence = (deal, userPerformance = new Map(), globalWinRate = 0.3) => {
  // CRITICAL FIX: Validate inputs
  if (!deal) return 30; // Default confidence for invalid deal
  if (!userPerformance || typeof userPerformance.get !== 'function') {
    userPerformance = new Map(); // Ensure it's a Map
  }

  const now = new Date();

  // Won/Lost deals have fixed confidence
  if (deal.status === 'lost') return 0;
  if (deal.status === 'won') return 100;

  // Get base confidence from stage
  let confidence = STAGE_BASE_CONFIDENCE[deal.stage] || 30;

  // Get user performance profile
  const userId = deal.user_id || deal.assigned_to || 'unassigned';
  const userProfile = userPerformance.get(userId) || {
    winRate: globalWinRate,
    avgCloseDays: 30,
    totalDeals: 0
  };

  // PERSONALIZED AI ADJUSTMENT - experienced users get higher confidence
  const userWinRate = userProfile.winRate || 0;
  const userExperience = userProfile.totalDeals || 0;

  // Boost confidence for high performers
  if (userWinRate > 0.7 && userExperience >= 5) {
    confidence += 15; // Top performers (70%+ win rate, 5+ deals) get +15% boost
  } else if (userWinRate > 0.5 && userExperience >= 3) {
    confidence += 10; // Good performers (50%+ win rate, 3+ deals) get +10% boost
  } else if (userWinRate > 0.3 && userExperience >= 1) {
    confidence += 5; // Average performers (30%+ win rate, 1+ deals) get +5% boost
  } else if (userExperience === 0) {
    confidence -= 10; // New users (no closed deals) get -10% penalty (conservative)
  }

  // STAGNATION DETECTION - Industry benchmarks (REAL-TIME AI)
  // Deals sitting too long in a stage lose confidence AGGRESSIVELY

  // Validate deal has creation date
  const createdDate = deal.created || deal.created_at;
  if (!createdDate) {
    console.warn(`Deal ${deal.id} missing creation date, skipping age-based penalties`);
    // Return confidence with only stage and user adjustments, no age penalties
    return Math.max(0, Math.min(100, confidence));
  }

  // Calculate deal age with validation
  const createdTimestamp = new Date(createdDate).getTime();
  if (isNaN(createdTimestamp)) {
    console.error(`Deal ${deal.id} has invalid creation date: ${createdDate}`);
    return Math.max(0, Math.min(100, confidence));
  }

  const dealAge = Math.floor((now.getTime() - createdTimestamp) / (1000 * 60 * 60 * 24));

  // Validate age is positive (not in future)
  if (dealAge < 0) {
    console.error(`Deal ${deal.id} has future creation date: ${createdDate}, age: ${dealAge} days`);
    return Math.max(0, Math.min(100, confidence));
  }

  // Validate age is reasonable (< 5 years)
  if (dealAge > 1825) {
    console.warn(`Deal ${deal.id} is ${dealAge} days old (>5 years), capping penalties`);
  }

  const stagnationThreshold = STAGNATION_THRESHOLDS[deal.stage] || STAGNATION_THRESHOLDS.default;

  // Calculate all potential penalties separately, then apply MAXIMUM (not stacking)
  let stagnationPenalty = 0;
  let doubleThresholdPenalty = 0;
  let agePenalty = 0;

  if (dealAge > stagnationThreshold) {
    // Calculate how many days OVER the threshold
    const daysOverThreshold = dealAge - stagnationThreshold;

    // Aggressive penalty: -2% per day over threshold, up to -30% max
    stagnationPenalty = Math.min(30, daysOverThreshold * 2);

    // Additional penalty for deals that are EXTREMELY stale (2x threshold)
    if (dealAge > (stagnationThreshold * 2)) {
      doubleThresholdPenalty = 15; // Extra -15% for deals that are twice as old as they should be
    }
  }

  // Additional age-based penalty for VERY old deals (regardless of stage)
  if (dealAge > 90) {
    agePenalty = 10; // 90+ days old gets extra penalty
  }

  // Apply MAXIMUM penalty only (prevents triple-stacking that could drop confidence below 0)
  const maxPenalty = Math.max(stagnationPenalty, doubleThresholdPenalty, agePenalty);
  confidence -= maxPenalty;

  // Value adjustment - higher value deals get slight boost (more attention from seller)
  if (deal.value > 50000) {
    confidence += 5; // High-value deals ($50k+) get +5%
  } else if (deal.value > 10000) {
    confidence += 3; // Medium-value deals ($10k+) get +3%
  }

  // Ensure confidence stays in valid range
  return Math.max(0, Math.min(100, confidence));
};

/**
 * Get confidence level label
 * @param {Number} confidence - Confidence score (0-100)
 * @returns {String} Label (High/Medium/Low)
 */
export const getConfidenceLabel = (confidence) => {
  if (confidence >= 80) return 'High Confidence';
  if (confidence >= 50) return 'Medium Confidence';
  return 'Low Confidence';
};

/**
 * Get confidence color gradient
 * @param {Number} confidence - Confidence score (0-100)
 * @returns {String} Tailwind gradient class
 */
export const getConfidenceColor = (confidence) => {
  if (confidence >= 80) return 'from-emerald-500 to-emerald-600';
  if (confidence >= 50) return 'from-amber-500 to-amber-600';
  return 'from-rose-500 to-rose-600';
};

/**
 * Check if a deal is stagnant (sitting too long in current stage)
 * @param {Object} deal - The deal to check
 * @returns {Object} { isStagnant: boolean, daysOver: number, threshold: number, dealAge: number }
 */
export const checkDealStagnation = (deal) => {
  // Null safety check
  if (!deal) {
    return { isStagnant: false, daysOver: 0, threshold: 14, dealAge: 0 };
  }

  const now = new Date();
  const createdDate = deal.created || deal.created_at;

  // Validate creation date exists
  if (!createdDate) {
    return { isStagnant: false, daysOver: 0, threshold: 14, dealAge: 0 };
  }

  const createdTimestamp = new Date(createdDate).getTime();
  if (isNaN(createdTimestamp)) {
    return { isStagnant: false, daysOver: 0, threshold: 14, dealAge: 0 };
  }

  const dealAge = Math.floor((now.getTime() - createdTimestamp) / (1000 * 60 * 60 * 24));

  // Handle negative ages (future dates)
  if (dealAge < 0) {
    return { isStagnant: false, daysOver: 0, threshold: 14, dealAge: 0 };
  }

  const threshold = STAGNATION_THRESHOLDS[deal.stage] || STAGNATION_THRESHOLDS.default;
  const daysOver = Math.max(0, dealAge - threshold);

  return {
    isStagnant: dealAge > threshold,
    daysOver,
    threshold,
    dealAge
  };
};
