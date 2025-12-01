/**
 * Shared AI Analytics Functions
 *
 * Centralized chart calculation and keyword detection for AI endpoints.
 * Used by both ai-assistant.mts (non-streaming) and ai-assistant-stream.mts (streaming)
 * to ensure feature parity for chart visualizations.
 *
 * PHASE 5.1: Added hidden column handling and graceful stage normalization
 */

// CENTRALIZED CONFIG: Import thresholds from single source of truth
import { STAGNATION_THRESHOLDS } from '../../../src/config/pipelineConfig';

// ============================================================================
// PHASE 5.1: HIDDEN COLUMN / CUSTOM STAGE HANDLING
// ============================================================================

/**
 * Known standard pipeline stages for analytics
 * Stages not in this list are treated as "uncategorized" for analytics purposes
 */
const KNOWN_STAGES = new Set([
  'lead', 'lead_captured', 'lead_generation', 'lead_identified',
  'lead_qualification', 'lead_qualified', 'prospecting',
  'contacted', 'contact', 'initial_screening', 'qualification',
  'discovery', 'discovery_demo', 'needs_identified', 'scope_defined',
  'quote', 'proposal', 'proposal_sent', 'contract', 'contract_sent',
  'negotiation', 'approval', 'term_sheet_presented', 'verbal_commit',
  'invoice', 'invoice_sent', 'payment', 'payment_received',
  'deal_won', 'closed', 'closed_won', 'investment_closed',
  'onboarding', 'customer_onboarded', 'client_onboarding',
  'retention', 'renewal', 'renewal_upsell',
  'lost', 'deal_lost', 'passed'
]);

/**
 * Normalize a stage name for analytics purposes
 * Hidden/unknown stages map to 'uncategorized' to prevent false stagnation alerts
 *
 * @param stage - The stage name to normalize
 * @param hiddenStages - Optional set of stages that are hidden by user
 * @returns Normalized stage name
 */
export function normalizeStageForAnalytics(stage: string, hiddenStages?: Set<string>): string {
  if (!stage) return 'uncategorized';

  // If stage is explicitly hidden by user, treat as uncategorized
  if (hiddenStages && hiddenStages.has(stage)) {
    return 'uncategorized';
  }

  // Known stages pass through unchanged
  if (KNOWN_STAGES.has(stage.toLowerCase())) {
    return stage.toLowerCase();
  }

  // Unknown custom stages are normalized but not flagged as issues
  return stage.toLowerCase();
}

/**
 * Check if a deal should be considered for stagnation analysis
 * Deals in hidden or uncategorized stages are NOT flagged as stagnant
 *
 * @param deal - The deal to check
 * @param hiddenStages - Optional set of stages that are hidden by user
 * @returns Whether the deal should be analyzed for stagnation
 */
export function shouldAnalyzeForStagnation(deal: any, hiddenStages?: Set<string>): boolean {
  if (!deal || deal.status !== 'active') return false;

  const stage = deal.stage?.toLowerCase();
  if (!stage) return false;

  // Don't analyze deals in hidden stages
  if (hiddenStages && hiddenStages.has(stage)) {
    return false;
  }

  return true;
}

/**
 * Get stagnation threshold for a stage, with graceful fallback for unknown stages
 * Unknown stages get a generous default to avoid false positives
 *
 * @param stage - The stage to get threshold for
 * @returns Threshold in days
 */
export function getStagnationThresholdSafe(stage: string): number {
  const normalizedStage = stage?.toLowerCase() || '';

  // Check if stage has a defined threshold
  if ((STAGNATION_THRESHOLDS as any)[normalizedStage]) {
    return (STAGNATION_THRESHOLDS as any)[normalizedStage];
  }

  // For unknown/custom stages, use a generous default (30 days)
  // This prevents false stagnation alerts for custom pipeline configurations
  return 30;
}

// ============================================================================
// CHART CALCULATION FUNCTIONS
// ============================================================================

// Calculate weekly trends for chart visualization
export function calculateWeeklyTrends(deals: any[]): any[] {
  if (!deals || deals.length === 0) {
    return [];
  }

  const now = new Date();
  const weeks = [];

  for (let i = 3; i >= 0; i--) {
    const weekStart = new Date(now);
    weekStart.setDate(weekStart.getDate() - (i * 7 + 7));
    weekStart.setHours(0, 0, 0, 0);

    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 7);

    const weekLabel = `Week ${4 - i}`;

    const added = deals.filter(d => {
      const created = new Date(d.created || d.created_at);
      return created >= weekStart && created < weekEnd;
    }).length;

    const closed = deals.filter(d => {
      if (d.status !== 'won') return false;
      const lastActivity = new Date(d.last_activity || d.updated_at || d.created);
      return lastActivity >= weekStart && lastActivity < weekEnd;
    }).length;

    const lost = deals.filter(d => {
      if (d.status !== 'lost') return false;
      const lastActivity = new Date(d.last_activity || d.updated_at || d.created);
      return lastActivity >= weekStart && lastActivity < weekEnd;
    }).length;

    weeks.push({ week: weekLabel, added, closed, lost });
  }

  return weeks;
}

// Calculate pipeline flow by stage
export function calculatePipelineFlow(deals: any[]): any[] {
  if (!deals || deals.length === 0) {
    return [];
  }

  const stageOrder = [
    'lead', 'lead_captured', 'contacted', 'discovery',
    'proposal_sent', 'negotiation', 'verbal_commit', 'contract_sent'
  ];

  const stageNames: { [key: string]: string } = {
    'lead': 'Lead',
    'lead_captured': 'Captured',
    'contacted': 'Contacted',
    'discovery': 'Discovery',
    'proposal_sent': 'Proposal',
    'negotiation': 'Negotiation',
    'verbal_commit': 'Verbal Commit',
    'contract_sent': 'Contract Sent'
  };

  const activeDeals = deals.filter(d => d.status === 'active');

  const byStage = activeDeals.reduce((acc: any, deal: any) => {
    const stage = deal.stage || 'lead';
    if (!acc[stage]) {
      acc[stage] = { count: 0, value: 0 };
    }
    acc[stage].count++;
    acc[stage].value += Number(deal.value || 0);
    return acc;
  }, {});

  return stageOrder
    .filter(stage => byStage[stage])
    .map(stage => ({
      stage: stageNames[stage] || stage,
      count: byStage[stage].count,
      value: byStage[stage].value
    }));
}

// Calculate at-risk deals by severity
// PHASE 5.1: Updated to use safe threshold function for custom/hidden stages
export function calculateAtRiskDeals(deals: any[], hiddenStages?: Set<string>): any[] {
  if (!deals || deals.length === 0) {
    return [];
  }

  const now = new Date();

  // Filter to active deals that should be analyzed (excludes hidden stages)
  const activeDeals = deals.filter(d => shouldAnalyzeForStagnation(d, hiddenStages));

  const atRisk = activeDeals.map(d => {
    const created = new Date(d.created || d.created_at);
    const daysSinceCreated = Math.floor((now.getTime() - created.getTime()) / (1000 * 60 * 60 * 24));
    // PHASE 5.1: Use safe threshold that handles unknown/custom stages gracefully
    const threshold = getStagnationThresholdSafe(d.stage);
    const daysOverdue = daysSinceCreated - threshold;
    return { ...d, daysSinceCreated, daysOverdue };
  }).filter(d => d.daysOverdue > 0);

  const critical = atRisk.filter(d => d.daysOverdue > 14);
  const warning = atRisk.filter(d => d.daysOverdue > 7 && d.daysOverdue <= 14);
  const attention = atRisk.filter(d => d.daysOverdue <= 7);

  return [
    { category: 'Critical', count: critical.length, value: critical.reduce((sum, d) => sum + Number(d.value || 0), 0) },
    { category: 'Warning', count: warning.length, value: warning.reduce((sum, d) => sum + Number(d.value || 0), 0) },
    { category: 'Attention', count: attention.length, value: attention.reduce((sum, d) => sum + Number(d.value || 0), 0) }
  ];
}

// Calculate revenue forecast
export function calculateRevenueForecast(deals: any[]): any[] {
  if (!deals || deals.length === 0) {
    return [];
  }

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const daysPassed = now.getDate();
  const daysRemaining = daysInMonth - daysPassed;

  const currentRevenue = deals
    .filter(d => {
      if (d.status !== 'won') return false;
      const wonDate = new Date(d.last_activity || d.updated_at || d.created);
      return wonDate >= monthStart && wonDate <= now;
    })
    .reduce((sum, d) => sum + Number(d.value || 0), 0);

  const pipelineValue = deals
    .filter(d => d.status === 'active')
    .reduce((sum, d) => {
      const value = Number(d.value || 0);
      const confidence = d.confidence || 30;
      return sum + (value * (confidence / 100));
    }, 0);

  const conservativeForecast = currentRevenue + (pipelineValue * 0.3);
  const bestEstimate = currentRevenue + (pipelineValue * 0.5);
  const aggressiveForecast = currentRevenue + (pipelineValue * 0.7);

  return [
    { category: 'Closed', value: Math.round(currentRevenue), color: '#10B981' },
    { category: 'Conservative', value: Math.round(conservativeForecast - currentRevenue), color: '#F59E0B' },
    { category: 'Best Case', value: Math.round(bestEstimate - currentRevenue), color: '#3B82F6' },
    { category: 'Aggressive', value: Math.round(aggressiveForecast - currentRevenue), color: '#8B5CF6' }
  ];
}

// Calculate ICP analysis
export function calculateICPAnalysis(deals: any[]): any[] {
  if (!deals || deals.length === 0) {
    return [];
  }

  const wonDeals = deals.filter(d => d.status === 'won');
  if (wonDeals.length === 0) {
    return [];
  }

  const dealSizes = wonDeals.map(d => Number(d.value || 0)).filter(v => v > 0);
  const avgDealSize = dealSizes.reduce((a, b) => a + b, 0) / dealSizes.length;

  const small = wonDeals.filter(d => Number(d.value || 0) < avgDealSize * 0.5).length;
  const medium = wonDeals.filter(d => {
    const val = Number(d.value || 0);
    return val >= avgDealSize * 0.5 && val <= avgDealSize * 1.5;
  }).length;
  const large = wonDeals.filter(d => Number(d.value || 0) > avgDealSize * 1.5).length;

  return [
    { segment: 'Small Deals', count: small, percentage: Math.round((small / wonDeals.length) * 100) },
    { segment: 'Medium Deals', count: medium, percentage: Math.round((medium / wonDeals.length) * 100) },
    { segment: 'Large Deals', count: large, percentage: Math.round((large / wonDeals.length) * 100) }
  ];
}

// Calculate velocity analysis
export function calculateVelocityAnalysis(deals: any[]): any[] {
  if (!deals || deals.length === 0) {
    return [];
  }

  const now = new Date();
  const stageVelocity: { [key: string]: { totalDays: number; count: number } } = {};

  deals.filter(d => d.status === 'active').forEach(deal => {
    const created = new Date(deal.created || deal.created_at);
    const age = Math.floor((now.getTime() - created.getTime()) / (1000 * 60 * 60 * 24));

    if (!stageVelocity[deal.stage]) {
      stageVelocity[deal.stage] = { totalDays: 0, count: 0 };
    }
    stageVelocity[deal.stage].totalDays += age;
    stageVelocity[deal.stage].count++;
  });

  return Object.keys(stageVelocity).map(stage => ({
    stage: stage.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
    avgDays: Math.round(stageVelocity[stage].totalDays / stageVelocity[stage].count),
    count: stageVelocity[stage].count
  })).sort((a, b) => b.avgDays - a.avgDays).slice(0, 6);
}

// Calculate goal progress (requires supabase client for DB access)
export async function calculateGoalProgress(
  deals: any[],
  organizationId: string,
  supabase: any
): Promise<any[]> {
  if (!deals || deals.length === 0) {
    return [];
  }

  try {
    const now = new Date();

    const { data: targets, error: targetError } = await supabase
      .from('user_targets')
      .select('monthly_revenue_target, quarterly_revenue_target, annual_revenue_target')
      .eq('organization_id', organizationId)
      .limit(1)
      .maybeSingle();

    if (targetError || !targets) {
      // No targets configured - return empty (not an error, just no data)
      return [];
    }

    const monthlyTarget = targets?.monthly_revenue_target || 0;
    const quarterlyTarget = targets?.quarterly_revenue_target || 0;
    const annualTarget = targets?.annual_revenue_target || 0;

    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthRevenue = deals
      .filter(d => {
        if (d.status !== 'won') return false;
        const wonDate = new Date(d.last_activity || d.updated_at || d.created);
        return wonDate >= monthStart;
      })
      .reduce((sum, d) => sum + Number(d.value || 0), 0);

    const currentQuarter = Math.floor(now.getMonth() / 3);
    const quarterStart = new Date(now.getFullYear(), currentQuarter * 3, 1);
    const quarterRevenue = deals
      .filter(d => {
        if (d.status !== 'won') return false;
        const wonDate = new Date(d.last_activity || d.updated_at || d.created);
        return wonDate >= quarterStart;
      })
      .reduce((sum, d) => sum + Number(d.value || 0), 0);

    const yearStart = new Date(now.getFullYear(), 0, 1);
    const yearRevenue = deals
      .filter(d => {
        if (d.status !== 'won') return false;
        const wonDate = new Date(d.last_activity || d.updated_at || d.created);
        return wonDate >= yearStart;
      })
      .reduce((sum, d) => sum + Number(d.value || 0), 0);

    const results = [];

    if (monthlyTarget > 0) {
      results.push({
        period: 'Monthly',
        current: monthRevenue,
        target: monthlyTarget,
        percentage: Math.round((monthRevenue / monthlyTarget) * 100)
      });
    }

    if (quarterlyTarget > 0) {
      results.push({
        period: 'Quarterly',
        current: quarterRevenue,
        target: quarterlyTarget,
        percentage: Math.round((quarterRevenue / quarterlyTarget) * 100)
      });
    }

    if (annualTarget > 0) {
      results.push({
        period: 'Annual',
        current: yearRevenue,
        target: annualTarget,
        percentage: Math.round((yearRevenue / annualTarget) * 100)
      });
    }

    return results;
  } catch (error) {
    console.error('Error calculating goal progress:', error);
    return [];
  }
}

// ============================================================================
// TASK TYPE CLASSIFICATION (Phase 3 + Phase 18 - Task-Aware Model Selection)
// ============================================================================

// PHASE 18: Expanded task types for intelligent provider routing
export type TaskType = 'text_analysis' | 'chart_insight' | 'coaching' | 'image_suitable' | 'planning' | 'general';

// ============================================================================
// PHASE 17: STAGEFLOW AI RESPONSE SCHEMA v1
// ============================================================================

/**
 * Structured AI response schema for rich UI rendering
 * Used for Plan My Day, pipeline analysis, forecasts, etc.
 */
export type AIResponseType = 'plan_my_day' | 'pipeline_analysis' | 'trend_insight' | 'forecast' | 'text';

export interface AIChecklistItem {
  id: string;
  task: string;
  completed: boolean;
  priority?: 'high' | 'medium' | 'low';
  dealId?: string;
  dealName?: string;
}

export interface AIMetric {
  label: string;
  value: string | number;
  delta?: string;
  trend?: 'up' | 'down' | 'flat';
}

export interface AIVisual {
  type: 'chart' | 'progress_bar' | 'scorecard' | 'checklist_card';
  data: any;
}

export interface AIStructuredResponse {
  response_type: AIResponseType;
  summary: string;
  checklist?: AIChecklistItem[];
  metrics?: AIMetric[];
  visual?: AIVisual;
}

/**
 * Detect if a message is requesting a Plan My Day response
 */
export function isPlanMyDayRequest(message: string): boolean {
  const messageLower = message.toLowerCase();
  return (
    messageLower.includes('plan my day') ||
    messageLower.includes('daily action plan') ||
    messageLower.includes('personalized daily') ||
    (messageLower.includes('plan') && messageLower.includes('day') && messageLower.includes('section'))
  );
}

/**
 * Parse AI text response into structured checklist items
 * Extracts action items from Plan My Day response sections
 *
 * PHASE 20: Enhanced to handle unstructured text and always generate checklist
 * Detects: JSON blocks, Markdown checklists (- [ ]), bullets (•), numbered lists,
 * section markers, and action verbs
 */
export function parseChecklistFromResponse(responseText: string, deals: any[]): AIChecklistItem[] {
  const checklist: AIChecklistItem[] = [];

  // PHASE 20: First, try to extract JSON block if present
  const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[1]);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (item.task || item.action || item.title) {
            checklist.push({
              id: `task-${Date.now()}-${checklist.length}`,
              task: (item.task || item.action || item.title).substring(0, 200),
              completed: false,
              priority: item.priority || 'medium',
              dealId: item.dealId,
              dealName: item.dealName
            });
          }
        }
        if (checklist.length > 0) return checklist.slice(0, 10);
      }
    } catch {
      // JSON parsing failed, continue with text parsing
    }
  }

  const lines = responseText.split('\n');

  let currentSection = '';
  let priorityMap: { [key: string]: 'high' | 'medium' | 'low' } = {
    'closest to close': 'high',
    'momentum builders': 'medium',
    'momentum': 'medium',
    'relationship nurture': 'low',
    'relationship': 'low',
    'touchpoint': 'low',
    'pipeline hygiene': 'low',
    'workflow': 'low',
    'insight': 'medium',
    'next actions': 'high',
    'priority': 'high',
    'urgent': 'high',
    'today': 'high'
  };

  // PHASE 20: Enhanced section detection
  const sectionMarkers = [
    'section', 'closest to close', 'momentum', 'relationship', 'pipeline hygiene',
    'next actions', 'priority', 'today', 'touchpoint', 'workflow', 'insight'
  ];

  for (const line of lines) {
    const trimmedLine = line.trim();
    if (!trimmedLine) continue;

    // Detect section headers
    const lineLower = trimmedLine.toLowerCase();
    if (sectionMarkers.some(marker => lineLower.includes(marker))) {
      for (const [key, priority] of Object.entries(priorityMap)) {
        if (lineLower.includes(key)) {
          currentSection = key;
          break;
        }
      }
      continue;
    }

    // PHASE 20: Enhanced task patterns to catch more formats
    const taskPatterns = [
      /^[-•*]\s*\[\s*\]\s*(.+)$/,  // Markdown checklist - [ ]
      /^[-•*]\s*\[[xX]\]\s*(.+)$/,  // Completed markdown checklist - [x]
      /^[-•*]\s*(.+)$/,  // Regular bullet points
      /^\d+[\.\)]\s*(.+)$/,  // Numbered lists
      /^(?:Follow up|Contact|Review|Schedule|Send|Prepare|Check|Update|Create|Call|Email|Reach out|Connect|Draft|Finalize|Close|Negotiate|Present|Demo|Meet)\s+(.+)/i,  // Action verbs
      /^(?:→|▶|➤|►|⚡|🎯|✅|❌|⏰|📞|📧)\s*(.+)$/,  // Emoji/arrow indicators
      /^(?:ACTION|TODO|TASK|NEXT|DO):\s*(.+)/i  // Explicit markers
    ];

    for (const pattern of taskPatterns) {
      const match = trimmedLine.match(pattern);
      if (match) {
        let taskText = match[1] || trimmedLine;

        // Clean up task text
        taskText = taskText
          .replace(/^\*\*(.+)\*\*$/, '$1')  // Remove bold markers
          .replace(/^_(.+)_$/, '$1')  // Remove italic markers
          .trim();

        // Skip if it's just a header or too short
        if (taskText.length < 5 || taskText.endsWith(':')) continue;

        // Try to match with a deal
        let matchedDeal = null;
        for (const deal of deals) {
          const dealClient = deal.client || deal.name || deal.company || '';
          if (dealClient && taskText.toLowerCase().includes(dealClient.toLowerCase())) {
            matchedDeal = deal;
            break;
          }
        }

        checklist.push({
          id: `task-${Date.now()}-${checklist.length}`,
          task: taskText.substring(0, 200),
          completed: false,
          priority: priorityMap[currentSection] || 'medium',
          dealId: matchedDeal?.id,
          dealName: matchedDeal?.client || matchedDeal?.name || matchedDeal?.company
        });
        break;
      }
    }
  }

  // PHASE 20: If no checklist items found, generate minimum viable checklist from paragraphs
  // This ensures checklist always renders even with fully unstructured text
  if (checklist.length === 0 && deals.length > 0) {
    // Fallback: Create tasks from deal context
    const activeDeals = deals.filter(d => d.status === 'active').slice(0, 5);

    // Group by priority (closing stages = high, early stages = low)
    const closingStages = ['negotiation', 'verbal_commit', 'contract_sent', 'proposal_sent', 'proposal'];
    const earlyStages = ['lead', 'lead_captured', 'contacted', 'discovery'];

    for (const deal of activeDeals) {
      const dealName = deal.client || deal.name || 'Deal';
      const stageLower = (deal.stage || '').toLowerCase();

      let priority: 'high' | 'medium' | 'low' = 'medium';
      let task = `Review ${dealName}`;

      if (closingStages.some(s => stageLower.includes(s))) {
        priority = 'high';
        task = `Follow up with ${dealName} to close`;
      } else if (earlyStages.some(s => stageLower.includes(s))) {
        priority = 'low';
        task = `Nurture relationship with ${dealName}`;
      }

      checklist.push({
        id: `fallback-${Date.now()}-${checklist.length}`,
        task,
        completed: false,
        priority,
        dealId: deal.id,
        dealName
      });
    }
  }

  // Limit to 10 most important items
  return checklist.slice(0, 10);
}

/**
 * Calculate metrics from deals for Plan My Day response
 */
export function calculatePlanMyDayMetrics(deals: any[]): AIMetric[] {
  const activeDeals = deals.filter(d => d.status === 'active');
  const closingDeals = activeDeals.filter(d =>
    ['negotiation', 'verbal_commit', 'contract_sent'].includes(d.stage?.toLowerCase())
  );
  const totalPipelineValue = activeDeals.reduce((sum, d) => sum + Number(d.value || 0), 0);
  const closingValue = closingDeals.reduce((sum, d) => sum + Number(d.value || 0), 0);

  return [
    {
      label: 'Deals Near Close',
      value: closingDeals.length,
      trend: closingDeals.length > 0 ? 'up' : 'flat'
    },
    {
      label: 'Closing Value',
      value: `$${closingValue.toLocaleString()}`,
      trend: 'up'
    },
    {
      label: 'Active Pipeline',
      value: `$${totalPipelineValue.toLocaleString()}`,
      trend: 'flat'
    }
  ];
}

/**
 * Build structured response for Plan My Day
 */
export function buildPlanMyDayResponse(
  aiTextResponse: string,
  deals: any[]
): AIStructuredResponse {
  const checklist = parseChecklistFromResponse(aiTextResponse, deals);
  const metrics = calculatePlanMyDayMetrics(deals);

  // Extract first paragraph as summary
  const summaryMatch = aiTextResponse.match(/^[^.!?]*[.!?]/);
  const summary = summaryMatch
    ? summaryMatch[0].trim()
    : 'Here\'s your personalized action plan for today.';

  return {
    response_type: 'plan_my_day',
    summary,
    checklist,
    metrics,
    visual: {
      type: 'checklist_card',
      data: { itemCount: checklist.length }
    }
  };
}

/**
 * Determine the task type from user message and quick action ID
 * Used for task-aware AI provider/model selection
 *
 * PHASE 18: Enhanced with planning detection for intelligent provider routing
 * Priority order for task matching: quick action > image > planning > chart > coaching > analysis > general
 *
 * @param message - User's message text
 * @param quickActionId - Optional quick action identifier
 * @returns TaskType classification for the request
 */
export function determineTaskType(message: string, quickActionId?: string): TaskType {
  const messageLower = message.toLowerCase();

  // Quick action-based classification (most reliable)
  if (quickActionId) {
    // Planning quick action → planning (ChatGPT primary)
    if (quickActionId === 'plan_my_day') {
      return 'planning';
    }

    // Chart/analytics quick actions → chart_insight
    const chartActions = [
      'weekly_trends', 'pipeline_flow', 'at_risk', 'revenue_forecast',
      'goal_progress', 'velocity_booster', 'icp_analyzer', 'momentum_insights', 'flow_forecast'
    ];
    if (chartActions.includes(quickActionId)) {
      return 'chart_insight';
    }

    // Coaching quick actions → coaching (Claude primary)
    const coachingActions = [
      'deal_doctor', 'qualifier_coach', 'retention_master'
    ];
    if (coachingActions.includes(quickActionId)) {
      return 'coaching';
    }
  }

  // Message-based classification (fallback heuristics)

  // Image/visual request detection → image_suitable (Grok/Gemini primary)
  const imageKeywords = [
    'image', 'graphic', 'slide', 'deck', 'presentation',
    'visual summary', 'infographic', 'diagram', 'picture'
  ];
  if (imageKeywords.some(keyword => messageLower.includes(keyword))) {
    return 'image_suitable';
  }

  // PHASE 18: Planning detection → planning (ChatGPT primary)
  // Plan My Day, daily actions, task prioritization
  const planningKeywords = [
    'plan my day', 'daily action', 'what should i do today',
    'priorities for today', 'my tasks', 'agenda', 'schedule',
    'what to focus on', 'daily plan', 'action plan'
  ];
  if (planningKeywords.some(keyword => messageLower.includes(keyword))) {
    return 'planning';
  }

  // Chart/analytics detection → chart_insight (ChatGPT/Gemini)
  const chartKeywords = [
    'chart', 'graph', 'trend', 'forecast', 'pipeline flow',
    'velocity', 'at risk', 'goal progress', 'weekly', 'monthly',
    'distribution', 'breakdown', 'metrics', 'analytics', 'icp'
  ];
  if (chartKeywords.some(keyword => messageLower.includes(keyword))) {
    return 'chart_insight';
  }

  // Coaching detection → coaching (Claude primary)
  const coachingKeywords = [
    'coach', 'teach', 'help me', 'improve', 'how do i', 'strategy',
    'qualification', 'discovery', 'negotiate', 'close', 'objection',
    'stuck deal', 'stalled', 'blocked', 'advice', 'tips', 'best practice',
    'guidance', 'mentor', 'recommend'
  ];
  if (coachingKeywords.some(keyword => messageLower.includes(keyword))) {
    return 'coaching';
  }

  // Analysis detection → text_analysis (ChatGPT primary)
  const analysisKeywords = [
    'analyze', 'analysis', 'review', 'assess', 'evaluate',
    'summary', 'insight', 'pipeline', 'deals'
  ];
  if (analysisKeywords.some(keyword => messageLower.includes(keyword))) {
    return 'text_analysis';
  }

  // Default to general (ChatGPT as default brain)
  return 'general';
}

// ============================================================================
// CHART TYPE DETECTION
// ============================================================================

export interface ChartDetectionResult {
  chartType: string | null;
  chartTitle: string | null;
}

/**
 * Detect chart type from user message keywords
 * Returns chartType and chartTitle if a chart-related query is detected
 */
export function detectChartType(message: string): ChartDetectionResult {
  const messageLower = message.toLowerCase();

  // Weekly trends detection
  if (messageLower.includes('weekly trend') ||
      (messageLower.includes('week') && (messageLower.includes('trend') || messageLower.includes('deal')))) {
    return { chartType: 'weekly_trends', chartTitle: 'Weekly Deal Activity' };
  }

  // Pipeline flow detection
  if (messageLower.includes('pipeline flow') ||
      messageLower.includes('pipeline movement') ||
      messageLower.includes('pipeline distribution') ||
      (messageLower.includes('stage') && messageLower.includes('value'))) {
    return { chartType: 'pipeline_flow', chartTitle: 'Pipeline by Stage' };
  }

  // Goal progress detection (enhanced)
  if ((messageLower.includes('goal') && (messageLower.includes('progress') || messageLower.includes('track') || messageLower.includes('target') || messageLower.includes('achieve'))) ||
      (messageLower.includes('progress') && (messageLower.includes('toward') || messageLower.includes('to') || messageLower.includes('goal') || messageLower.includes('target'))) ||
      (messageLower.includes('revenue') && (messageLower.includes('goal') || messageLower.includes('target') || messageLower.includes('quota'))) ||
      (messageLower.includes('monthly') && messageLower.includes('target')) ||
      (messageLower.includes('quarterly') && messageLower.includes('target')) ||
      (messageLower.includes('annual') && messageLower.includes('target'))) {
    return { chartType: 'goal_progress', chartTitle: 'Revenue Goal Progress' };
  }

  // Probability/chance detection
  if (messageLower.includes('probability') ||
      messageLower.includes('chance') ||
      messageLower.includes('likelihood') ||
      (messageLower.includes('hit') && (messageLower.includes('goal') || messageLower.includes('target'))) ||
      (messageLower.includes('achieve') && (messageLower.includes('goal') || messageLower.includes('target'))) ||
      (messageLower.includes('reach') && (messageLower.includes('goal') || messageLower.includes('target')))) {
    return { chartType: 'goal_progress', chartTitle: 'Goal Achievement Probability' };
  }

  // At-risk deals detection
  if (messageLower.includes('at risk') ||
      messageLower.includes('stagnant') ||
      messageLower.includes('stuck')) {
    return { chartType: 'at_risk_deals', chartTitle: 'At-Risk Deals' };
  }

  // Revenue forecast detection
  if (messageLower.includes('forecast') && messageLower.includes('revenue')) {
    return { chartType: 'revenue_forecast', chartTitle: 'Revenue Forecast' };
  }

  // ICP analysis detection
  if (messageLower.includes('ideal customer') ||
      messageLower.includes('icp') ||
      messageLower.includes('customer profile')) {
    return { chartType: 'icp_analysis', chartTitle: 'Ideal Customer Profile' };
  }

  // Velocity analysis detection
  if (messageLower.includes('velocity') ||
      (messageLower.includes('faster') && messageLower.includes('pipeline'))) {
    return { chartType: 'velocity_analysis', chartTitle: 'Pipeline Velocity' };
  }

  return { chartType: null, chartTitle: null };
}

// ============================================================================
// CHART DATA CALCULATOR
// ============================================================================

/**
 * Calculate chart data based on detected chart type
 * Returns null if no chart type or deals data
 *
 * PHASE 5.1: Added hiddenStages parameter for graceful handling of hidden columns
 */
export async function calculateChartData(
  chartType: string | null,
  deals: any[],
  organizationId: string,
  supabase: any,
  hiddenStages?: Set<string>
): Promise<any[] | null> {
  if (!chartType || !deals || deals.length === 0) {
    return null;
  }

  switch (chartType) {
    case 'weekly_trends':
      return calculateWeeklyTrends(deals);
    case 'pipeline_flow':
      return calculatePipelineFlow(deals);
    case 'goal_progress':
      return await calculateGoalProgress(deals, organizationId, supabase);
    case 'at_risk_deals':
      // PHASE 5.1: Pass hiddenStages to exclude hidden columns from stagnation analysis
      return calculateAtRiskDeals(deals, hiddenStages);
    case 'revenue_forecast':
      return calculateRevenueForecast(deals);
    case 'icp_analysis':
      return calculateICPAnalysis(deals);
    case 'velocity_analysis':
      return calculateVelocityAnalysis(deals);
    default:
      return null;
  }
}
