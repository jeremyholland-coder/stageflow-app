/**
 * AI User Profile Module - Phase 5.3 Adaptive Success Loops
 *
 * This module provides types and helpers for managing AI user profiles.
 * Profiles are used to adapt the Advisor's behavior based on user behavior patterns.
 *
 * Key features:
 * 1. AIUserProfile type definition
 * 2. Signal processing and profile updating
 * 3. Database persistence helpers
 * 4. Profile-to-prompt adaptation utilities
 *
 * IMPORTANT: This module is internal-only. Profile data is never exposed to clients.
 */

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Signal types that can be captured from user interactions
 */
export type AISignalType =
  | 'section_used'
  | 'micro_action_used'
  | 'more_detail_requested';

/**
 * Plan My Day section identifiers
 */
export type SectionId =
  | 'closest_to_close'
  | 'momentum_builders'
  | 'relationships'
  | 'workflow_boosts';

/**
 * Micro-action button identifiers
 */
export type ActionId =
  | 'draft_message'
  | 'prepare_conversation'
  | 'followup_sequence'
  | 'research_company';

/**
 * Outreach channel preference
 */
export type OutreachPreference = 'email' | 'linkedin' | 'sms' | 'none';

/**
 * Detail level preference for AI responses
 */
export type DetailLevel = 'overview' | 'balanced' | 'deep';

/**
 * Signal captured from user interaction
 */
export interface AISignal {
  type: AISignalType;
  sectionId?: SectionId;
  actionId?: ActionId;
  timestamp: string; // ISO 8601
}

/**
 * Focus bias weights - sum should always equal 1.0
 */
export interface FocusBias {
  closestToCloseWeight: number;   // 0.0 - 1.0
  momentumBuildersWeight: number; // 0.0 - 1.0
  relationshipsWeight: number;    // 0.0 - 1.0
}

/**
 * Raw signal counts for learning
 */
export interface SignalCounts {
  closest_to_close: number;
  momentum_builders: number;
  relationships: number;
  workflow_boosts: number;
  draft_message: number;
  prepare_conversation: number;
  followup_sequence: number;
  research_company: number;
  more_detail_requested: number;
}

/**
 * AI User Profile - Internal representation
 *
 * This profile is stored in the database and used to adapt AI responses.
 * It is NEVER exposed directly to clients.
 */
export interface AIUserProfile {
  userId: string;
  organizationId: string;

  // How much detail they prefer in responses
  detailLevel: DetailLevel;

  // What they tend to care about most in Plan My Day
  focusBias: FocusBias;

  // Preferred outreach channel when drafting messages
  outreachPreference: OutreachPreference;

  // How frequently they interact with the Advisor (0-100)
  advisorEngagementScore: number;

  // Raw signal counts for weighted calculations
  signalCounts: SignalCounts;

  // Last updated timestamp (ISO 8601)
  updatedAt: string;
}

// ============================================================================
// DEFAULT PROFILE
// ============================================================================

/**
 * Get a default AI user profile for new users
 */
export function getDefaultAIUserProfile(userId: string, orgId: string): AIUserProfile {
  return {
    userId,
    organizationId: orgId,
    detailLevel: 'balanced',
    focusBias: {
      closestToCloseWeight: 0.33,
      momentumBuildersWeight: 0.33,
      relationshipsWeight: 0.34,
    },
    outreachPreference: 'email',
    advisorEngagementScore: 50,
    signalCounts: {
      closest_to_close: 0,
      momentum_builders: 0,
      relationships: 0,
      workflow_boosts: 0,
      draft_message: 0,
      prepare_conversation: 0,
      followup_sequence: 0,
      research_company: 0,
      more_detail_requested: 0,
    },
    updatedAt: new Date().toISOString(),
  };
}

// ============================================================================
// SIGNAL PROCESSING
// ============================================================================

/**
 * Merge signals into an existing profile
 *
 * This function updates the profile based on behavioral signals:
 * - Section usage adjusts focusBias weights
 * - Micro-action usage tracks engagement patterns
 * - More detail requests adjust detailLevel
 *
 * The algorithm is simple and interpretable:
 * - Increment counters
 * - Recalculate normalized weights
 * - Adjust detail level based on thresholds
 */
export function mergeSignalsIntoProfile(
  profile: AIUserProfile,
  signals: AISignal[]
): AIUserProfile {
  if (!signals || signals.length === 0) {
    return profile;
  }

  // Clone the profile to avoid mutations
  const updated: AIUserProfile = {
    ...profile,
    focusBias: { ...profile.focusBias },
    signalCounts: { ...profile.signalCounts },
    updatedAt: new Date().toISOString(),
  };

  // Process each signal
  for (const signal of signals) {
    if (signal.type === 'section_used' && signal.sectionId) {
      // Increment section counter
      updated.signalCounts[signal.sectionId] =
        (updated.signalCounts[signal.sectionId] || 0) + 1;
    } else if (signal.type === 'micro_action_used' && signal.actionId) {
      // Increment action counter
      updated.signalCounts[signal.actionId] =
        (updated.signalCounts[signal.actionId] || 0) + 1;
    } else if (signal.type === 'more_detail_requested') {
      // Increment detail request counter
      updated.signalCounts.more_detail_requested =
        (updated.signalCounts.more_detail_requested || 0) + 1;
    }
  }

  // Recalculate focus bias weights based on section usage
  const sectionTotal =
    updated.signalCounts.closest_to_close +
    updated.signalCounts.momentum_builders +
    updated.signalCounts.relationships;

  if (sectionTotal > 0) {
    // Calculate raw weights with minimum floor (0.1) to prevent any section from disappearing
    const rawClosest = Math.max(0.1, updated.signalCounts.closest_to_close / sectionTotal);
    const rawMomentum = Math.max(0.1, updated.signalCounts.momentum_builders / sectionTotal);
    const rawRelationships = Math.max(0.1, updated.signalCounts.relationships / sectionTotal);

    // Normalize to sum to 1.0
    const total = rawClosest + rawMomentum + rawRelationships;
    // SIGNAL-02 FIX: Guard against division by zero and ensure exact sum to 1.0
    if (total > 0) {
      const closestWeight = rawClosest / total;
      const momentumWeight = rawMomentum / total;
      // Ensure last weight makes total exactly 1.0 (compensate for floating point errors)
      const relationshipsWeight = 1.0 - closestWeight - momentumWeight;

      updated.focusBias.closestToCloseWeight = closestWeight;
      updated.focusBias.momentumBuildersWeight = momentumWeight;
      updated.focusBias.relationshipsWeight = Math.max(0, relationshipsWeight); // Ensure non-negative
    }
  }

  // Adjust detail level based on more_detail_requested signals
  // Thresholds: 0-2 = overview, 3-7 = balanced, 8+ = deep
  const detailRequests = updated.signalCounts.more_detail_requested;
  if (detailRequests >= 8) {
    updated.detailLevel = 'deep';
  } else if (detailRequests >= 3) {
    updated.detailLevel = 'balanced';
  } else if (detailRequests === 0 && sectionTotal > 10) {
    // User never asks for more detail and has used the system a lot = prefers brevity
    updated.detailLevel = 'overview';
  }

  // Calculate advisor engagement score (0-100)
  // Based on total interactions, capped at 100
  const totalInteractions =
    updated.signalCounts.closest_to_close +
    updated.signalCounts.momentum_builders +
    updated.signalCounts.relationships +
    updated.signalCounts.workflow_boosts +
    updated.signalCounts.draft_message +
    updated.signalCounts.prepare_conversation +
    updated.signalCounts.followup_sequence +
    updated.signalCounts.research_company;

  // Score scales: 0-10 interactions = 10-50, 10-50 = 50-80, 50+ = 80-100
  if (totalInteractions <= 10) {
    updated.advisorEngagementScore = Math.min(50, 10 + totalInteractions * 4);
  } else if (totalInteractions <= 50) {
    updated.advisorEngagementScore = Math.min(80, 50 + (totalInteractions - 10) * 0.75);
  } else {
    updated.advisorEngagementScore = Math.min(100, 80 + (totalInteractions - 50) * 0.4);
  }

  return updated;
}

// ============================================================================
// DATABASE HELPERS
// ============================================================================

/**
 * Convert database JSONB to AIUserProfile
 */
function dbProfileToAIUserProfile(
  userId: string,
  orgId: string,
  dbProfile: any
): AIUserProfile {
  return {
    userId,
    organizationId: orgId,
    detailLevel: dbProfile.detailLevel || 'balanced',
    focusBias: {
      closestToCloseWeight: dbProfile.focusBias?.closestToCloseWeight ?? 0.33,
      momentumBuildersWeight: dbProfile.focusBias?.momentumBuildersWeight ?? 0.33,
      relationshipsWeight: dbProfile.focusBias?.relationshipsWeight ?? 0.34,
    },
    outreachPreference: dbProfile.outreachPreference || 'email',
    advisorEngagementScore: dbProfile.advisorEngagementScore ?? 50,
    signalCounts: {
      closest_to_close: dbProfile.signalCounts?.closest_to_close ?? 0,
      momentum_builders: dbProfile.signalCounts?.momentum_builders ?? 0,
      relationships: dbProfile.signalCounts?.relationships ?? 0,
      workflow_boosts: dbProfile.signalCounts?.workflow_boosts ?? 0,
      draft_message: dbProfile.signalCounts?.draft_message ?? 0,
      prepare_conversation: dbProfile.signalCounts?.prepare_conversation ?? 0,
      followup_sequence: dbProfile.signalCounts?.followup_sequence ?? 0,
      research_company: dbProfile.signalCounts?.research_company ?? 0,
      more_detail_requested: dbProfile.signalCounts?.more_detail_requested ?? 0,
    },
    updatedAt: dbProfile.updatedAt || new Date().toISOString(),
  };
}

/**
 * Convert AIUserProfile to database JSONB format
 */
function aiUserProfileToDbProfile(profile: AIUserProfile): any {
  return {
    detailLevel: profile.detailLevel,
    focusBias: profile.focusBias,
    outreachPreference: profile.outreachPreference,
    advisorEngagementScore: profile.advisorEngagementScore,
    signalCounts: profile.signalCounts,
    updatedAt: profile.updatedAt,
  };
}

/**
 * Get AI user profile from database
 * Returns default profile if none exists
 */
export async function getAIUserProfile(
  supabase: any,
  userId: string,
  orgId: string
): Promise<AIUserProfile> {
  try {
    const { data, error } = await supabase.rpc('get_ai_user_profile', {
      p_user_id: userId,
      p_organization_id: orgId,
    });

    if (error) {
      console.error('Error fetching AI user profile:', error);
      return getDefaultAIUserProfile(userId, orgId);
    }

    return dbProfileToAIUserProfile(userId, orgId, data);
  } catch (error) {
    console.error('Exception fetching AI user profile:', error);
    return getDefaultAIUserProfile(userId, orgId);
  }
}

/**
 * Save AI user profile to database
 */
export async function saveAIUserProfile(
  supabase: any,
  profile: AIUserProfile
): Promise<void> {
  try {
    const dbProfile = aiUserProfileToDbProfile(profile);

    const { error } = await supabase.rpc('upsert_ai_user_profile', {
      p_user_id: profile.userId,
      p_organization_id: profile.organizationId,
      p_profile: dbProfile,
    });

    if (error) {
      console.error('Error saving AI user profile:', error);
    }
  } catch (error) {
    console.error('Exception saving AI user profile:', error);
  }
}

/**
 * Update user profile from signals (convenience function)
 *
 * This is the main entry point for signal processing:
 * 1. Fetches existing profile (or creates default)
 * 2. Merges new signals
 * 3. Persists updated profile
 */
export async function updateUserProfileFromSignals(
  supabase: any,
  userId: string,
  orgId: string,
  signals: AISignal[]
): Promise<AIUserProfile> {
  // Skip if no signals
  if (!signals || signals.length === 0) {
    return await getAIUserProfile(supabase, userId, orgId);
  }

  try {
    // Fetch existing profile
    const existingProfile = await getAIUserProfile(supabase, userId, orgId);

    // Merge signals
    const updatedProfile = mergeSignalsIntoProfile(existingProfile, signals);

    // Save updated profile (fire and forget for performance)
    // SIGNAL-01 FIX: Ensure save errors are properly logged and never reject uncaught
    saveAIUserProfile(supabase, updatedProfile)
      .then(() => {
        console.debug('[AI Profile] Profile saved successfully for user:', userId);
      })
      .catch((err) => {
        // Log with sufficient context for debugging but don't block main flow
        console.error('[AI Profile] Background profile save failed for user:', userId, 'org:', orgId, 'error:', err?.message || err);
      });

    return updatedProfile;
  } catch (error) {
    console.error('Error updating profile from signals:', error);
    return getDefaultAIUserProfile(userId, orgId);
  }
}

// ============================================================================
// PROMPT ADAPTATION UTILITIES
// ============================================================================

/**
 * Build profile context for AI system prompt
 *
 * Returns a structured object that can be included in the AI context
 * to guide response adaptation WITHOUT exposing raw behavioral data.
 */
export function buildProfileContext(profile: AIUserProfile): {
  detail_level: string;
  focus_bias: {
    closest_to_close: number;
    momentum_builders: number;
    relationships: number;
  };
  outreach_preference: string;
  adaptation_instructions: string[];
} {
  const instructions: string[] = [];

  // Detail level instructions
  switch (profile.detailLevel) {
    case 'overview':
      instructions.push('This user prefers concise overviews. Keep responses to 2-3 short paragraphs max.');
      instructions.push('Use 3-5 bullet points for lists. Be brief and actionable.');
      break;
    case 'deep':
      instructions.push('This user appreciates detailed explanations. Provide thorough context.');
      instructions.push('Include reasoning and nuance, but keep it skimmable with clear structure.');
      break;
    default:
      // balanced - no special instruction needed
      break;
  }

  // Focus bias instructions (only if there's a clear preference)
  const { closestToCloseWeight, momentumBuildersWeight, relationshipsWeight } = profile.focusBias;

  if (closestToCloseWeight > 0.45) {
    instructions.push('This user often prioritizes deals closest to closing. Ensure Closest to Close suggestions are clear and actionable.');
  }

  if (relationshipsWeight > 0.45) {
    instructions.push('This user values relationship development. Include meaningful relationship touchpoints and nurturing suggestions.');
  }

  if (momentumBuildersWeight > 0.45) {
    instructions.push('This user focuses on pipeline building. Provide rich momentum-building and outreach suggestions.');
  }

  // Outreach preference instructions
  if (profile.outreachPreference === 'linkedin') {
    instructions.push('When drafting messages, offer LinkedIn-style versions first, then email alternatives.');
  } else if (profile.outreachPreference === 'sms') {
    instructions.push('When drafting messages, consider SMS-friendly brevity where appropriate.');
  }

  return {
    detail_level: profile.detailLevel,
    focus_bias: {
      closest_to_close: Math.round(closestToCloseWeight * 100) / 100,
      momentum_builders: Math.round(momentumBuildersWeight * 100) / 100,
      relationships: Math.round(relationshipsWeight * 100) / 100,
    },
    outreach_preference: profile.outreachPreference,
    adaptation_instructions: instructions,
  };
}

/**
 * Build adaptation snippet for system prompt
 *
 * Returns a ready-to-use string that can be appended to the AI system prompt.
 * This provides natural language guidance without exposing raw metrics.
 */
export function buildAdaptationPromptSnippet(profile: AIUserProfile): string {
  const context = buildProfileContext(profile);

  if (context.adaptation_instructions.length === 0) {
    return ''; // No adaptation needed for balanced/default users
  }

  const instructions = context.adaptation_instructions
    .map((inst) => `- ${inst}`)
    .join('\n');

  return `
**PERSONALIZATION CONTEXT:**
${instructions}

Do NOT explicitly mention these adaptations to the user. Apply them naturally and subtly.`;
}
