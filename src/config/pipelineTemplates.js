import {
  Users,
  FileText,
  CheckCircle,
  DollarSign,
  Package,
  TrendingUp,
  Trophy,
  AlertCircle,
  UserCheck,
  Search,
  Clipboard,
  ClipboardCheck,
  Home,
  Building,
  Briefcase,
  Send,
  CreditCard,
  RefreshCw,
  Target,
  Phone,
  Rocket,
  Activity
} from 'lucide-react';
// Stage status mappings (inlined to avoid bundling issues with shared/ directory)
// NOTE: Backend has its own copy in shared/stageStatusMap.ts - keep in sync if modifying
const WON_STAGES = new Set([
  // Core won stages
  'deal_won', 'closed_won', 'won', 'closed',
  // Real Estate pipeline
  'contract_signed', 'escrow_completed',
  // VC/Investment pipeline
  'investment_closed', 'capital_received',
  // Standard pipeline
  'payment_received', 'invoice_sent',
  // Retention/Customer success
  'retention', 'retention_renewal', 'client_retention', 'customer_retained', 'portfolio_mgmt'
]);

const LOST_STAGES = new Set([
  'lost', 'deal_lost', 'closed_lost', 'investment_lost', 'passed'
]);

/**
 * Pipeline Templates for StageFlow CRM
 *
 * Each template represents an industry-specific sales pipeline
 * with stages tailored to that industry's workflow
 */

export const PIPELINE_TEMPLATES = {
  healthcare: {
    id: 'healthcare',
    name: 'Healthcare Sales',
    description: 'Optimized for medical device, pharma, and healthcare services sales',
    stages: [
      { id: 'lead_generation', name: 'Lead Generation', icon: Users, color: '#3A86FF' },
      { id: 'lead_qualification', name: 'Lead Qualification', icon: UserCheck, color: '#1ABC9C' },
      { id: 'discovery', name: 'Discovery', icon: Search, color: '#8B5CF6' },
      { id: 'scope_defined', name: 'Scope Defined', icon: ClipboardCheck, color: '#F39C12' },
      { id: 'proposal_sent', name: 'Proposal Sent', icon: FileText, color: '#3A86FF' },
      { id: 'contract_sent', name: 'Contract Sent', icon: Send, color: '#8B5CF6' },
      { id: 'negotiation', name: 'Negotiation / Commitment', icon: CheckCircle, color: '#F39C12' },
      { id: 'deal_won', name: 'Deal Won', icon: Trophy, color: '#27AE60' },
      { id: 'deal_lost', name: 'Deal Lost', icon: AlertCircle, color: '#E74C3C' },
      { id: 'invoice_sent', name: 'Invoice Sent', icon: Send, color: '#1ABC9C' },
      { id: 'payment_received', name: 'Payment Received', icon: DollarSign, color: '#27AE60' },
      { id: 'client_onboarding', name: 'Client Onboarding / Support', icon: Package, color: '#8B5CF6' },
      { id: 'renewal_upsell', name: 'Renewal / Upsell Opportunity', icon: RefreshCw, color: '#3A86FF' }
    ]
  },

  vc_pe: {
    id: 'vc_pe',
    name: 'Venture Capital & PE',
    description: 'Deal flow management for venture capital and private equity firms',
    stages: [
      { id: 'deal_sourced', name: 'Deal Sourced', icon: Users, color: '#3A86FF' },
      { id: 'initial_screening', name: 'Initial Screening', icon: UserCheck, color: '#1ABC9C' },
      { id: 'due_diligence', name: 'Due Diligence', icon: Clipboard, color: '#8B5CF6' },
      { id: 'term_sheet_presented', name: 'Term Sheet Presented', icon: FileText, color: '#F39C12' },
      { id: 'negotiation', name: 'Negotiation / Commitment', icon: CheckCircle, color: '#3A86FF' },
      { id: 'investment_closed', name: 'Investment Closed', icon: Trophy, color: '#27AE60' },
      { id: 'capital_call_sent', name: 'Capital Call Sent', icon: Send, color: '#1ABC9C' },
      { id: 'capital_received', name: 'Capital Received', icon: DollarSign, color: '#27AE60' },
      { id: 'portfolio_mgmt', name: 'Portfolio Management / Reporting', icon: TrendingUp, color: '#8B5CF6' }
    ]
  },

  real_estate: {
    id: 'real_estate',
    name: 'Real Estate Sales',
    description: 'Property sales pipeline for real estate agents and brokerages',
    stages: [
      { id: 'lead_captured', name: 'Lead Captured', icon: Users, color: '#3A86FF' },
      { id: 'qualification', name: 'Qualification & Needs Assessment', icon: UserCheck, color: '#1ABC9C' },
      { id: 'property_showing', name: 'Property Showing / Offer Made', icon: Home, color: '#8B5CF6' },
      { id: 'negotiation', name: 'Negotiation', icon: CheckCircle, color: '#F39C12' },
      { id: 'contract_signed', name: 'Contract Signed', icon: Trophy, color: '#27AE60' },
      { id: 'deal_lost', name: 'Deal Lost', icon: AlertCircle, color: '#E74C3C' },
      { id: 'closing_statement_sent', name: 'Closing Statement Sent', icon: Send, color: '#1ABC9C' },
      { id: 'escrow_completed', name: 'Payment / Escrow Completed', icon: DollarSign, color: '#27AE60' },
      { id: 'client_followup', name: 'Client Follow-Up / Referral', icon: RefreshCw, color: '#8B5CF6' }
    ]
  },

  professional_services: {
    id: 'professional_services',
    name: 'Professional Services',
    description: 'Consulting, legal, accounting, and agency services pipeline',
    stages: [
      { id: 'lead_identified', name: 'Lead Identified', icon: Users, color: '#3A86FF' },
      { id: 'lead_qualified', name: 'Lead Qualified', icon: UserCheck, color: '#1ABC9C' },
      { id: 'discovery', name: 'Discovery', icon: Search, color: '#8B5CF6' },
      { id: 'scope_defined', name: 'Scope Defined', icon: ClipboardCheck, color: '#F39C12' },
      { id: 'proposal_sent', name: 'Proposal Sent', icon: FileText, color: '#3A86FF' },
      { id: 'contract_sent', name: 'Contract Sent', icon: Send, color: '#8B5CF6' },
      { id: 'negotiation', name: 'Negotiation / Commitment', icon: CheckCircle, color: '#F39C12' },
      { id: 'contract_signed', name: 'Contract Signed', icon: Trophy, color: '#27AE60' },
      { id: 'deal_won', name: 'Deal Won', icon: Trophy, color: '#27AE60' },
      { id: 'deal_lost', name: 'Deal Lost', icon: AlertCircle, color: '#E74C3C' },
      { id: 'invoice_sent', name: 'Invoice Sent', icon: Send, color: '#1ABC9C' },
      { id: 'payment_received', name: 'Payment Received', icon: DollarSign, color: '#27AE60' },
      { id: 'client_onboarding', name: 'Client Onboarding / Support', icon: Package, color: '#8B5CF6' },
      { id: 'renewal_upsell', name: 'Renewal / Upsell Opportunity', icon: RefreshCw, color: '#3A86FF' }
    ]
  },

  saas: {
    id: 'saas',
    name: 'SaaS Sales',
    description: 'Modern SaaS sales and post-sale pipeline for subscription businesses',
    stages: [
      { id: 'prospecting', name: 'Prospecting', icon: Target, color: '#3A86FF' },
      { id: 'qualification', name: 'Qualification', icon: UserCheck, color: '#1ABC9C' },
      { id: 'contact', name: 'Contact', icon: Phone, color: '#8B5CF6' },
      { id: 'discovery', name: 'Discovery', icon: Search, color: '#F39C12' },
      { id: 'proposal', name: 'Proposal', icon: FileText, color: '#3A86FF' },
      { id: 'negotiation', name: 'Negotiation', icon: CheckCircle, color: '#8B5CF6' },
      { id: 'closed', name: 'Closed', icon: Trophy, color: '#27AE60' },
      { id: 'onboarding', name: 'Onboarding', icon: Package, color: '#1ABC9C' },
      { id: 'adoption', name: 'Adoption', icon: Activity, color: '#8B5CF6' },
      { id: 'renewal', name: 'Renewal', icon: RefreshCw, color: '#3A86FF' }
    ]
  },

  // Default/StageFlow universal pipeline for SMB founders
  default: {
    id: 'default',
    name: 'StageFlow Default',
    description: 'Universal pipeline optimized for founders and small business owners',
    stages: [
      { id: 'lead_captured', name: 'Lead Captured', icon: Users, color: '#3A86FF' },
      { id: 'lead_qualified', name: 'Lead Qualified', icon: UserCheck, color: '#1ABC9C' },
      { id: 'contacted', name: 'Contacted / Outreach', icon: Send, color: '#8B5CF6' },
      { id: 'needs_identified', name: 'Needs Identified', icon: Search, color: '#F39C12' },
      { id: 'proposal_sent', name: 'Proposal Sent', icon: FileText, color: '#3A86FF' },
      { id: 'negotiation', name: 'Negotiation / Review', icon: CheckCircle, color: '#8B5CF6' },
      { id: 'deal_won', name: 'Deal Closed - Won', icon: Trophy, color: '#27AE60' },
      { id: 'deal_lost', name: 'Deal Closed - Lost', icon: AlertCircle, color: '#E74C3C' },
      { id: 'invoice_sent', name: 'Invoice Sent', icon: Send, color: '#1ABC9C' },
      { id: 'payment_received', name: 'Payment Received', icon: DollarSign, color: '#27AE60' },
      { id: 'customer_onboarded', name: 'Onboarding/Delivery', icon: Package, color: '#8B5CF6' },
      { id: 'retention', name: 'Retention / Renewal', icon: RefreshCw, color: '#3A86FF' }
    ]
  }
};

/**
 * Stage Mapping for Deal Preservation
 *
 * Maps stages between different pipelines to preserve deals when switching
 * Format: { fromStage: toStage }
 */
export const STAGE_MAPPINGS = {
  // Any pipeline → Healthcare
  to_healthcare: {
    // From new default
    lead_captured: 'lead_generation',
    lead_qualified: 'lead_qualification',
    contacted: 'lead_generation',
    needs_identified: 'discovery',
    proposal_sent: 'proposal_sent',
    negotiation: 'negotiation',
    deal_won: 'deal_won',
    deal_lost: 'deal_lost',
    invoice_sent: 'invoice_sent',
    payment_received: 'payment_received',
    customer_onboarded: 'client_onboarding',
    retention: 'renewal_upsell',
    // From legacy default
    lead: 'lead_generation',
    quote: 'proposal_sent',
    approval: 'negotiation',
    invoice: 'invoice_sent',
    onboarding: 'client_onboarding',
    delivery: 'payment_received',
    lost: 'deal_lost',
    // From VC/PE
    deal_sourced: 'lead_generation',
    initial_screening: 'lead_qualification',
    due_diligence: 'discovery',
    term_sheet_presented: 'proposal_sent',
    investment_closed: 'deal_won',
    capital_call_sent: 'invoice_sent',
    capital_received: 'payment_received',
    portfolio_mgmt: 'renewal_upsell',
    // From Real Estate
    lead_captured: 'lead_generation',
    qualification: 'lead_qualification',
    property_showing: 'discovery',
    contract_signed: 'deal_won',
    closing_statement_sent: 'invoice_sent',
    escrow_completed: 'payment_received',
    client_followup: 'renewal_upsell',
    // From Professional Services
    lead_identified: 'lead_generation',
    lead_qualified: 'lead_qualification',
    scope_defined: 'scope_defined',
    contract_sent: 'contract_sent',
    deal_won: 'deal_won',
    deal_lost: 'deal_lost',
    renewal_upsell: 'renewal_upsell',
    // From SaaS
    prospecting: 'lead_generation',
    qualification: 'lead_qualification',
    contact: 'lead_generation',
    proposal: 'proposal_sent',
    closed: 'deal_won',
    adoption: 'client_onboarding',
    renewal: 'renewal_upsell'
  },

  // Any pipeline → VC/PE
  to_vc_pe: {
    // From new default
    lead_captured: 'deal_sourced',
    lead_qualified: 'initial_screening',
    contacted: 'deal_sourced',
    needs_identified: 'due_diligence',
    proposal_sent: 'term_sheet_presented',
    negotiation: 'negotiation',
    deal_won: 'investment_closed',
    deal_lost: 'investment_closed',
    invoice_sent: 'capital_call_sent',
    payment_received: 'capital_received',
    customer_onboarded: 'portfolio_mgmt',
    retention: 'portfolio_mgmt',
    // From legacy default
    lead: 'deal_sourced',
    quote: 'term_sheet_presented',
    approval: 'negotiation',
    invoice: 'capital_call_sent',
    onboarding: 'portfolio_mgmt',
    delivery: 'capital_received',
    lost: 'investment_closed',
    // From Healthcare
    lead_generation: 'deal_sourced',
    lead_qualification: 'initial_screening',
    discovery: 'due_diligence',
    scope_defined: 'term_sheet_presented',
    proposal_sent: 'term_sheet_presented',
    contract_sent: 'term_sheet_presented',
    deal_won: 'investment_closed',
    deal_lost: 'investment_closed',
    invoice_sent: 'capital_call_sent',
    payment_received: 'capital_received',
    client_onboarding: 'portfolio_mgmt',
    renewal_upsell: 'portfolio_mgmt',
    // From Real Estate
    lead_captured: 'deal_sourced',
    qualification: 'initial_screening',
    property_showing: 'due_diligence',
    contract_signed: 'investment_closed',
    closing_statement_sent: 'capital_call_sent',
    escrow_completed: 'capital_received',
    client_followup: 'portfolio_mgmt',
    // From Professional Services
    lead_identified: 'deal_sourced',
    lead_qualified: 'initial_screening',
    // From SaaS
    prospecting: 'deal_sourced',
    qualification: 'initial_screening',
    contact: 'deal_sourced',
    proposal: 'term_sheet_presented',
    closed: 'investment_closed',
    adoption: 'portfolio_mgmt',
    renewal: 'portfolio_mgmt'
  },

  // Any pipeline → Real Estate
  to_real_estate: {
    // From new default
    lead_captured: 'lead_captured',
    lead_qualified: 'qualification',
    contacted: 'lead_captured',
    needs_identified: 'property_showing',
    proposal_sent: 'property_showing',
    negotiation: 'negotiation',
    deal_won: 'contract_signed',
    deal_lost: 'deal_lost',
    invoice_sent: 'closing_statement_sent',
    payment_received: 'escrow_completed',
    customer_onboarded: 'client_followup',
    retention: 'client_followup',
    // From legacy default
    lead: 'lead_captured',
    quote: 'property_showing',
    approval: 'negotiation',
    invoice: 'closing_statement_sent',
    onboarding: 'client_followup',
    delivery: 'escrow_completed',
    lost: 'deal_lost',
    // From Healthcare
    lead_generation: 'lead_captured',
    lead_qualification: 'qualification',
    discovery: 'property_showing',
    scope_defined: 'property_showing',
    proposal_sent: 'property_showing',
    contract_sent: 'negotiation',
    deal_won: 'contract_signed',
    deal_lost: 'deal_lost',
    invoice_sent: 'closing_statement_sent',
    payment_received: 'escrow_completed',
    client_onboarding: 'client_followup',
    renewal_upsell: 'client_followup',
    // From VC/PE
    deal_sourced: 'lead_captured',
    initial_screening: 'qualification',
    due_diligence: 'property_showing',
    term_sheet_presented: 'property_showing',
    investment_closed: 'contract_signed',
    capital_call_sent: 'closing_statement_sent',
    capital_received: 'escrow_completed',
    portfolio_mgmt: 'client_followup',
    // From Professional Services
    lead_identified: 'lead_captured',
    lead_qualified: 'qualification',
    // From SaaS
    prospecting: 'lead_captured',
    qualification: 'qualification',
    contact: 'lead_captured',
    proposal: 'property_showing',
    closed: 'contract_signed',
    adoption: 'client_followup',
    renewal: 'client_followup'
  },

  // Any pipeline → Professional Services
  to_professional_services: {
    // From new default
    lead_captured: 'lead_identified',
    lead_qualified: 'lead_qualified',
    contacted: 'lead_identified',
    needs_identified: 'discovery',
    proposal_sent: 'proposal_sent',
    negotiation: 'negotiation',
    deal_won: 'deal_won',
    deal_lost: 'deal_lost',
    invoice_sent: 'invoice_sent',
    payment_received: 'payment_received',
    customer_onboarded: 'client_onboarding',
    retention: 'renewal_upsell',
    // From legacy default
    lead: 'lead_identified',
    quote: 'proposal_sent',
    approval: 'negotiation',
    invoice: 'invoice_sent',
    onboarding: 'client_onboarding',
    delivery: 'payment_received',
    lost: 'deal_lost',
    // From Healthcare
    lead_generation: 'lead_identified',
    lead_qualification: 'lead_qualified',
    discovery: 'discovery',
    scope_defined: 'scope_defined',
    contract_sent: 'contract_sent',
    client_onboarding: 'client_onboarding',
    renewal_upsell: 'renewal_upsell',
    // From VC/PE
    deal_sourced: 'lead_identified',
    initial_screening: 'lead_qualified',
    due_diligence: 'discovery',
    term_sheet_presented: 'proposal_sent',
    investment_closed: 'deal_won',
    capital_call_sent: 'invoice_sent',
    capital_received: 'payment_received',
    portfolio_mgmt: 'renewal_upsell',
    // From Real Estate
    lead_captured: 'lead_identified',
    qualification: 'lead_qualified',
    property_showing: 'discovery',
    contract_signed: 'deal_won',
    closing_statement_sent: 'invoice_sent',
    escrow_completed: 'payment_received',
    client_followup: 'renewal_upsell',
    // From SaaS
    prospecting: 'lead_identified',
    qualification: 'lead_qualified',
    contact: 'lead_identified',
    proposal: 'proposal_sent',
    closed: 'deal_won',
    adoption: 'client_onboarding',
    renewal: 'renewal_upsell'
  },

  // Any pipeline → SaaS
  to_saas: {
    // From new default
    lead_captured: 'prospecting',
    lead_qualified: 'qualification',
    contacted: 'contact',
    needs_identified: 'discovery',
    proposal_sent: 'proposal',
    negotiation: 'negotiation',
    deal_won: 'closed',
    deal_lost: 'closed',
    invoice_sent: 'closed',
    payment_received: 'onboarding',
    customer_onboarded: 'onboarding',
    retention: 'renewal',
    // From legacy default
    lead: 'prospecting',
    quote: 'proposal',
    approval: 'negotiation',
    invoice: 'closed',
    onboarding: 'onboarding',
    delivery: 'adoption',
    lost: 'closed',
    // From Healthcare
    lead_generation: 'prospecting',
    lead_qualification: 'qualification',
    discovery: 'discovery',
    scope_defined: 'discovery',
    proposal_sent: 'proposal',
    contract_sent: 'negotiation',
    deal_won: 'closed',
    deal_lost: 'closed',
    invoice_sent: 'closed',
    payment_received: 'onboarding',
    client_onboarding: 'onboarding',
    renewal_upsell: 'renewal',
    // From VC/PE
    deal_sourced: 'prospecting',
    initial_screening: 'qualification',
    due_diligence: 'discovery',
    term_sheet_presented: 'proposal',
    investment_closed: 'closed',
    capital_call_sent: 'closed',
    capital_received: 'onboarding',
    portfolio_mgmt: 'adoption',
    // From Real Estate
    lead_captured: 'prospecting',
    qualification: 'qualification',
    property_showing: 'discovery',
    contract_signed: 'closed',
    closing_statement_sent: 'closed',
    escrow_completed: 'onboarding',
    client_followup: 'renewal',
    // From Professional Services
    lead_identified: 'prospecting',
    lead_qualified: 'qualification',
    scope_defined: 'discovery',
    contract_sent: 'negotiation'
  },

  // Any pipeline → Default
  to_default: {
    // Legacy mappings (old default stages)
    lead: 'lead_captured',
    quote: 'proposal_sent',
    approval: 'negotiation',
    invoice: 'invoice_sent',
    onboarding: 'customer_onboarded',
    delivery: 'payment_received',
    // From Healthcare
    lead_generation: 'lead_captured',
    lead_qualification: 'lead_qualified',
    discovery: 'needs_identified',
    scope_defined: 'needs_identified',
    contract_sent: 'proposal_sent',
    client_onboarding: 'customer_onboarded',
    renewal_upsell: 'retention',
    // From VC/PE
    deal_sourced: 'lead_captured',
    initial_screening: 'lead_qualified',
    due_diligence: 'needs_identified',
    term_sheet_presented: 'proposal_sent',
    investment_closed: 'deal_won',
    capital_call_sent: 'invoice_sent',
    capital_received: 'payment_received',
    portfolio_mgmt: 'retention',
    // From Real Estate
    qualification: 'lead_qualified',
    property_showing: 'needs_identified',
    contract_signed: 'deal_won',
    closing_statement_sent: 'invoice_sent',
    escrow_completed: 'payment_received',
    client_followup: 'retention',
    // From Professional Services
    lead_identified: 'lead_captured',
    // From SaaS
    prospecting: 'lead_captured',
    qualification: 'lead_qualified',
    contact: 'contacted',
    proposal: 'proposal_sent',
    closed: 'deal_won',
    adoption: 'customer_onboarded',
    renewal: 'retention'
  }
};

/**
 * Get the appropriate stage mapping when switching pipelines
 * @param {string} toPipelineId - Target pipeline ID
 * @returns {Object} Mapping object
 */
export const getStageMapping = (toPipelineId) => {
  const mappingKey = `to_${toPipelineId}`;
  return STAGE_MAPPINGS[mappingKey] || STAGE_MAPPINGS.to_default;
};

/**
 * Map a stage from one pipeline to another
 * @param {string} currentStage - Current stage ID
 * @param {string} toPipelineId - Target pipeline ID
 * @returns {string} Mapped stage ID
 */
export const mapStage = (currentStage, toPipelineId) => {
  const mapping = getStageMapping(toPipelineId);
  return mapping[currentStage] || currentStage;
};

// FIX C9: Centralized stage status definitions (shared with backend)
export const STAGE_STATUS_MAP = {
  WON_STAGES,
  LOST_STAGES
};

/**
 * Get the appropriate status for a given stage
 * @param {string} stageId - The stage ID
 * @returns {string} - 'won', 'lost', or 'active'
 */
export const getStatusForStage = (stageId) => {
  if (WON_STAGES.has(stageId)) return 'won';
  if (LOST_STAGES.has(stageId)) return 'lost';
  return 'active';
};

/**
 * Check if a stage is a "won" stage
 */
export const isWonStage = (stageId) => STAGE_STATUS_MAP.WON_STAGES.has(stageId);

/**
 * Check if a stage is a "lost" stage
 */
export const isLostStage = (stageId) => STAGE_STATUS_MAP.LOST_STAGES.has(stageId);

export default PIPELINE_TEMPLATES;
