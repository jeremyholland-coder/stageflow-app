/**
 * One-time manual fix for orphaned deals with status mismatch
 * Fixes deals that have valid stages but incorrect status (won/lost)
 * causing them to be invisible in the Kanban board
 */

import { createClient } from '@supabase/supabase-js';
import { shouldUseNewAuth } from './lib/feature-flags';
import { requireAuth, createAuthErrorResponse } from './lib/auth-middleware';

export const handler = async (event: any) => {
  // Only allow POST requests
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  // SECURITY: Feature-flagged authentication migration
  // Phase 4 Batch 7: Add authentication to admin fix function
  if (shouldUseNewAuth('fix-orphaned-status')) {
    try {
      // NEW AUTH PATH: Require authentication for admin operations
      const authHeader = event.headers.authorization || event.headers.Authorization;
      if (!authHeader) {
        return {
          statusCode: 401,
          body: JSON.stringify({ error: 'Authentication required' })
        };
      }

      const request = new Request('https://dummy.com', {
        method: 'POST',
        headers: { 'Authorization': authHeader }
      });

      await requireAuth(request);
    } catch (authError) {
      const errorResponse = createAuthErrorResponse(authError);
      return {
        statusCode: errorResponse.status,
        body: await errorResponse.text()
      };
    }
  }
  // LEGACY AUTH PATH: No authentication (CRITICAL VULNERABILITY - admin function exposed)

  try {
    const supabaseUrl = process.env.VITE_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Missing Supabase credentials');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Won/lost stages that should have status='won' or status='lost'
    const wonStages = [
      'retention', 'closed_won', 'invoice_sent', 'payment_received',
      'deal_won', 'client_retention', 'customer_retained',
      'portfolio_mgmt', 'capital_received'
    ];

    const lostStages = ['lost', 'deal_lost', 'investment_lost'];

    // Find deals with status mismatch
    const { data: brokenDeals, error: fetchError } = await supabase
      .from('deals')
      .select('id, client, stage, status, value, organization_id')
      .not('stage', 'in', `(${[...wonStages, ...lostStages].join(',')})`)
      .in('status', ['won', 'lost']);

    if (fetchError) {
      throw fetchError;
    }

    if (!brokenDeals || brokenDeals.length === 0) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          success: true,
          message: 'No broken deals found',
          fixed: 0
        })
      };
    }

    // Fix each broken deal
    const updates = brokenDeals.map(deal =>
      supabase
        .from('deals')
        .update({
          status: 'active',
          last_activity: new Date().toISOString()
        })
        .eq('id', deal.id)
    );

    await Promise.all(updates);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        success: true,
        message: `Fixed ${brokenDeals.length} deal(s) with status mismatch`,
        fixed: brokenDeals.length,
        deals: brokenDeals.map(d => ({
          id: d.id,
          client: d.client,
          stage: d.stage,
          oldStatus: d.status,
          newStatus: 'active'
        }))
      })
    };

  } catch (error: any) {
    console.error('Error fixing orphaned deals:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Failed to fix orphaned deals',
        details: error.message
      })
    };
  }
};
