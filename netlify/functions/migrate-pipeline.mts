/**
 * Migrate Pipeline Template
 *
 * PHASE 14 FIX: Backend endpoint for pipeline template migration with HttpOnly cookie auth
 * Handles:
 * - Mapping all existing deal stages to the new pipeline template
 * - Updating organization's pipeline_template setting
 *
 * SECURITY: Uses service role to bypass RLS, validates user membership
 */

import type { Handler, HandlerEvent, HandlerContext } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import { parseCookies, COOKIE_NAMES, getCorsHeaders } from './lib/cookie-auth';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Stage mappings for pipeline migration (from pipelineTemplates.js)
const STAGE_MAPPINGS: Record<string, Record<string, string>> = {
  to_healthcare: {
    lead_captured: 'lead_generation', lead_qualified: 'lead_qualification', contacted: 'lead_generation',
    needs_identified: 'discovery', proposal_sent: 'proposal_sent', negotiation: 'negotiation',
    deal_won: 'deal_won', deal_lost: 'deal_lost', invoice_sent: 'invoice_sent',
    payment_received: 'payment_received', customer_onboarded: 'client_onboarding', retention: 'renewal_upsell',
    lead: 'lead_generation', quote: 'proposal_sent', approval: 'negotiation', invoice: 'invoice_sent',
    onboarding: 'client_onboarding', delivery: 'payment_received', lost: 'deal_lost',
    deal_sourced: 'lead_generation', initial_screening: 'lead_qualification', due_diligence: 'discovery',
    term_sheet_presented: 'proposal_sent', investment_closed: 'deal_won', capital_call_sent: 'invoice_sent',
    capital_received: 'payment_received', portfolio_mgmt: 'renewal_upsell',
    qualification: 'lead_qualification', property_showing: 'discovery', contract_signed: 'deal_won',
    closing_statement_sent: 'invoice_sent', escrow_completed: 'payment_received', client_followup: 'renewal_upsell',
    lead_identified: 'lead_generation', scope_defined: 'scope_defined', contract_sent: 'contract_sent',
    renewal_upsell: 'renewal_upsell', prospecting: 'lead_generation', contact: 'lead_generation',
    proposal: 'proposal_sent', closed: 'deal_won', adoption: 'client_onboarding', renewal: 'renewal_upsell'
  },
  to_vc_pe: {
    lead_captured: 'deal_sourced', lead_qualified: 'initial_screening', contacted: 'deal_sourced',
    needs_identified: 'due_diligence', proposal_sent: 'term_sheet_presented', negotiation: 'negotiation',
    deal_won: 'investment_closed', deal_lost: 'investment_closed', invoice_sent: 'capital_call_sent',
    payment_received: 'capital_received', customer_onboarded: 'portfolio_mgmt', retention: 'portfolio_mgmt',
    lead: 'deal_sourced', quote: 'term_sheet_presented', approval: 'negotiation', invoice: 'capital_call_sent',
    onboarding: 'portfolio_mgmt', delivery: 'capital_received', lost: 'investment_closed'
  },
  to_real_estate: {
    lead_captured: 'lead_captured', lead_qualified: 'qualification', contacted: 'lead_captured',
    needs_identified: 'property_showing', proposal_sent: 'property_showing', negotiation: 'negotiation',
    deal_won: 'contract_signed', deal_lost: 'deal_lost', invoice_sent: 'closing_statement_sent',
    payment_received: 'escrow_completed', customer_onboarded: 'client_followup', retention: 'client_followup',
    lead: 'lead_captured', quote: 'property_showing', approval: 'negotiation', invoice: 'closing_statement_sent',
    onboarding: 'client_followup', delivery: 'escrow_completed', lost: 'deal_lost'
  },
  to_professional_services: {
    lead_captured: 'lead_identified', lead_qualified: 'lead_qualified', contacted: 'lead_identified',
    needs_identified: 'discovery', proposal_sent: 'proposal_sent', negotiation: 'negotiation',
    deal_won: 'deal_won', deal_lost: 'deal_lost', invoice_sent: 'invoice_sent',
    payment_received: 'payment_received', customer_onboarded: 'client_onboarding', retention: 'renewal_upsell',
    lead: 'lead_identified', quote: 'proposal_sent', approval: 'negotiation', invoice: 'invoice_sent',
    onboarding: 'client_onboarding', delivery: 'payment_received', lost: 'deal_lost'
  },
  to_saas: {
    lead_captured: 'prospecting', lead_qualified: 'qualification', contacted: 'contact',
    needs_identified: 'discovery', proposal_sent: 'proposal', negotiation: 'negotiation',
    deal_won: 'closed', deal_lost: 'closed', invoice_sent: 'closed',
    payment_received: 'onboarding', customer_onboarded: 'onboarding', retention: 'renewal',
    lead: 'prospecting', quote: 'proposal', approval: 'negotiation', invoice: 'closed',
    onboarding: 'onboarding', delivery: 'adoption', lost: 'closed'
  },
  to_default: {
    lead: 'lead_captured', quote: 'proposal_sent', approval: 'negotiation', invoice: 'invoice_sent',
    onboarding: 'customer_onboarded', delivery: 'payment_received',
    lead_generation: 'lead_captured', lead_qualification: 'lead_qualified', discovery: 'needs_identified',
    scope_defined: 'needs_identified', contract_sent: 'proposal_sent', client_onboarding: 'customer_onboarded',
    renewal_upsell: 'retention', deal_sourced: 'lead_captured', initial_screening: 'lead_qualified',
    due_diligence: 'needs_identified', term_sheet_presented: 'proposal_sent', investment_closed: 'deal_won',
    capital_call_sent: 'invoice_sent', capital_received: 'payment_received', portfolio_mgmt: 'retention',
    qualification: 'lead_qualified', property_showing: 'needs_identified', contract_signed: 'deal_won',
    closing_statement_sent: 'invoice_sent', escrow_completed: 'payment_received', client_followup: 'retention',
    lead_identified: 'lead_captured', prospecting: 'lead_captured', contact: 'contacted',
    proposal: 'proposal_sent', closed: 'deal_won', adoption: 'customer_onboarded', renewal: 'retention'
  }
};

function mapStage(currentStage: string, toPipelineId: string): string {
  const mappingKey = `to_${toPipelineId}`;
  const mapping = STAGE_MAPPINGS[mappingKey] || STAGE_MAPPINGS.to_default;
  return mapping[currentStage] || currentStage;
}

export const handler: Handler = async (event: HandlerEvent, _context: HandlerContext) => {
  const corsHeaders = getCorsHeaders(event.headers);

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    console.log('[Migrate Pipeline] Request received');

    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Server configuration error' })
      };
    }

    // Get access token from HttpOnly cookie
    const cookieHeader = event.headers.cookie || event.headers.Cookie || '';
    const cookies = parseCookies(cookieHeader);
    const accessToken = cookies[COOKIE_NAMES.ACCESS_TOKEN];

    if (!accessToken) {
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Not authenticated' })
      };
    }

    // Parse request body
    const body = JSON.parse(event.body || '{}');
    const { organization_id, template_id } = body;

    if (!organization_id || !template_id) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Missing organization_id or template_id' })
      };
    }

    // Validate template_id
    const validTemplates = ['healthcare', 'vc_pe', 'real_estate', 'professional_services', 'saas', 'default'];
    if (!validTemplates.includes(template_id)) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Invalid template_id', validTemplates })
      };
    }

    // Authenticate user
    const supabaseAuth = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${accessToken}` } }
    });

    const { data: { user }, error: userError } = await supabaseAuth.auth.getUser(accessToken);
    if (userError || !user) {
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Invalid session' })
      };
    }

    // Use service role client
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Verify user is admin/owner of organization
    const { data: membership } = await supabase
      .from('team_members')
      .select('role')
      .eq('user_id', user.id)
      .eq('organization_id', organization_id)
      .maybeSingle();

    if (!membership || !['owner', 'admin'].includes(membership.role)) {
      return {
        statusCode: 403,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Only owners and admins can migrate pipelines' })
      };
    }

    // Step 1: Get all deals for this organization
    const { data: deals, error: dealsError } = await supabase
      .from('deals')
      .select('id, stage')
      .eq('organization_id', organization_id)
      .is('deleted_at', null);

    if (dealsError) {
      console.error('[Migrate Pipeline] Error fetching deals:', dealsError);
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Failed to fetch deals', details: dealsError.message })
      };
    }

    // Step 2: Map each deal's stage to the new pipeline
    const dealUpdates = (deals || []).map(deal => ({
      id: deal.id,
      stage: mapStage(deal.stage, template_id),
      last_activity: new Date().toISOString()
    }));

    // Step 3: Update all deals in batch
    let dealsUpdated = 0;
    if (dealUpdates.length > 0) {
      const { error: updateError } = await supabase
        .from('deals')
        .upsert(dealUpdates, { onConflict: 'id' });

      if (updateError) {
        console.error('[Migrate Pipeline] Error updating deals:', updateError);
        return {
          statusCode: 500,
          headers: corsHeaders,
          body: JSON.stringify({ error: 'Failed to migrate deals', details: updateError.message })
        };
      }
      dealsUpdated = dealUpdates.length;
    }

    // Step 4: Update organization's pipeline template
    const { error: orgError } = await supabase
      .from('organizations')
      .update({ pipeline_template: template_id })
      .eq('id', organization_id);

    if (orgError) {
      console.error('[Migrate Pipeline] Error updating organization:', orgError);
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Failed to update organization', details: orgError.message })
      };
    }

    console.log('[Migrate Pipeline] Success:', { organization_id, template_id, dealsUpdated });

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        template_id,
        deals_migrated: dealsUpdated
      })
    };

  } catch (error: any) {
    console.error('[Migrate Pipeline] Exception:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Internal server error', details: error.message })
    };
  }
};
