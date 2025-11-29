import type { Handler, HandlerEvent, HandlerContext } from '@netlify/functions';
import Stripe from 'stripe';
import { shouldUseNewAuth } from './lib/feature-flags';
import { requireAuth, requireOrgAccess, createAuthErrorResponse } from './lib/auth-middleware';
import { requirePermission, PERMISSIONS } from './lib/rbac';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-09-30.clover',
});

const handler: Handler = async (event: HandlerEvent, context: HandlerContext) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    // CRITICAL FIX v1.7.84: Use HttpOnly cookie authentication (Phase 3)
    // PROBLEM: Function was using Authorization header, but frontend sends HttpOnly cookies
    // SOLUTION: Use requireAuth() middleware like create-checkout-session
    // This fixes billing portal access for subscribed users
    const user = await requireAuth(new Request(
      `https://example.com${event.path}`,
      {
        method: event.httpMethod,
        headers: new Headers(event.headers as Record<string, string>)
      }
    ));

    console.log('[STRIPE PORTAL] Authenticated user:', user.email);

    const { createClient } = await import('@supabase/supabase-js');
    const { getSupabaseConfig } = await import('./lib/validate-config');

    // FIX: Use service role key to bypass RLS for organization lookup
    const config = getSupabaseConfig();
    const supabase = createClient(
      config.url,
      config.serviceRoleKey || config.anonKey
    );

    const body = JSON.parse(event.body || '{}');
    const { organizationId } = body;

    if (!organizationId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing organizationId' })
      };
    }

    // SECURITY: Feature-flagged RBAC for billing portal access
    // Phase 4: Gradually enable centralized role-based billing controls
    if (shouldUseNewAuth('create-portal-session', user.id)) {
      try {
        // NEW AUTH PATH: Use centralized RBAC system
        // FIX v1.7.84: Pass actual event headers (includes HttpOnly cookies)
        const request = new Request('https://dummy.com', {
          method: 'POST',
          headers: new Headers(event.headers as Record<string, string>)
        });

        const { user: authUser, member } = await requireOrgAccess(request, organizationId);

        // Require MANAGE_BILLING permission (owner/admin only)
        requirePermission(member.role, PERMISSIONS.MANAGE_BILLING);

        // User is authorized to access billing portal
      } catch (authError) {
        return createAuthErrorResponse(authError);
      }
    } else {
      // LEGACY AUTH PATH: Inline role check (will be removed after migration)
      // SECURITY FIX: Verify user is a member of the organization before allowing billing access
      // MIGRATION FIX: Changed from user_workspaces to team_members (v1.7.22)
      const { data: membership, error: memberError } = await supabase
        .from('team_members')
        .select('role')
        .eq('user_id', user.id)
        .eq('organization_id', organizationId)
        .single();

      if (memberError || !membership) {
        return {
          statusCode: 403,
          body: JSON.stringify({ error: 'Access denied: You are not a member of this organization' })
        };
      }

      // SECURITY: Only owners and admins can access billing
      if (membership.role !== 'owner' && membership.role !== 'admin') {
        return {
          statusCode: 403,
          body: JSON.stringify({ error: 'Access denied: Only organization owners and admins can manage billing' })
        };
      }
    }

    const { data: org, error: orgError } = await supabase
      .from('organizations')
      .select('stripe_customer_id')
      .eq('id', organizationId)
      .single();

    if (orgError || !org || !org.stripe_customer_id) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'No Stripe customer found' })
      };
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: org.stripe_customer_id,
      return_url: 'https://stageflow.startupstage.com/settings?tab=billing',
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        url: session.url
      })
    };

  } catch (error: any) {
    console.error('Error creating portal session:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Failed to create portal session',
        details: error.message
      })
    };
  }
};

export { handler };
