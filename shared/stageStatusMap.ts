// Canonical stage → status mapping shared by frontend and backend
// Won stages - automatically set status to 'won'
export const WON_STAGES = new Set([
  // Core won stages (both frontend and backend)
  'deal_won',
  'closed_won',
  'won',
  'closed',
  // Real Estate pipeline won stages
  'contract_signed',
  'escrow_completed',
  // VC/Investment pipeline won stages
  'investment_closed',
  'capital_received',
  // Standard pipeline won stages
  'payment_received',
  'invoice_sent',
  // Retention/Customer success stages
  'retention',
  'retention_renewal',
  'client_retention',
  'customer_retained',
  'portfolio_mgmt'
]);

// Lost stages - automatically set status to 'lost'
export const LOST_STAGES = new Set([
  'lost',
  'deal_lost',
  'closed_lost',
  'investment_lost',
  'passed'
]);

/**
 * Get the appropriate status for a given stage.
 * Returns 'won' | 'lost' | 'active'
 */
export const getStatusForStage = (stageId: string): 'won' | 'lost' | 'active' => {
  if (WON_STAGES.has(stageId)) return 'won';
  if (LOST_STAGES.has(stageId)) return 'lost';
  return 'active';
};
