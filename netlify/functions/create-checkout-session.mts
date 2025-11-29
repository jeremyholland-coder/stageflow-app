import type { Handler, HandlerEvent, HandlerContext } from '@netlify/functions';
import Stripe from 'stripe';
import { withTimeout, TIMEOUTS, safeJsonParse } from './lib/timeout-wrapper';
import { shouldUseNewAuth } from './lib/feature-flags';
import { requireAuth, requireOrgAccess, createAuthErrorResponse } from './lib/auth-middleware';
import { requirePermission, PERMISSIONS } from './lib/rbac';
import { getCorsHeaders } from './lib/cookie-auth';

// CRITICAL FIX: Validate Stripe API key exists before initialization
if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error('STRIPE_SECRET_KEY environment variable is not configured');
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2025-09-30.clover',
});

const handler: Handler = async (event: HandlerEvent, context: HandlerContext) => {
  // v1.7.98: CORS headers with origin validation (no wildcard with credentials)
  const jsonHeaders = getCorsHeaders(event.headers);

  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: jsonHeaders,
      body: ''
    };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: jsonHeaders,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    // CRITICAL FIX v1.7.58: Use HttpOnly cookie authentication (Phase 3)
    // PROBLEM: Function was checking for Authorization header, but frontend sends HttpOnly cookies
    // SOLUTION: Use requireAuth() middleware like all other authenticated functions
    // This fixes 401 "Authentication required" errors on Stripe checkout
    const user = await requireAuth(new Request(
      `https://example.com${event.path}`,
      {
        method: event.httpMethod,
        headers: new Headers(event.headers as Record<string, string>)
      }
    ));

    console.log('[STRIPE CHECKOUT] Authenticated user:', user.email);

    // Initialize Supabase client with service role for organization lookup
    const { createClient } = await import('@supabase/supabase-js');
    const { getSupabaseConfig } = await import('./lib/validate-config');

    const config = getSupabaseConfig();
    const supabase = createClient(
      config.url,
      config.serviceRoleKey || config.anonKey
    );

    // CRITICAL FIX: Safe JSON parsing
    const body = safeJsonParse(event.body || '{}', {}) as { priceId?: string; organizationId?: string; tier?: string; billingInterval?: string };
    if (!body) {
      return {
        statusCode: 400,
        headers: jsonHeaders,
        body: JSON.stringify({ error: 'Invalid JSON in request body' })
      };
    }
    const { priceId, organizationId, tier, billingInterval } = body;

    // SECURITY: Feature-flagged RBAC for billing access
    // Phase 4: Gradually enable role-based billing controls
    if (shouldUseNewAuth('create-checkout-session', user.id)) {
      try {
        // NEW AUTH PATH: Verify org membership and billing permissions
        // FIX v1.7.58: Pass actual event headers (includes HttpOnly cookies)
        const request = new Request('https://dummy.com', {
          method: 'POST',
          headers: new Headers(event.headers as Record<string, string>)
        });

        const { user: authUser, member } = await requireOrgAccess(request, organizationId);

        // Require MANAGE_BILLING permission (owner/admin only)
        requirePermission(member.role, PERMISSIONS.MANAGE_BILLING);

        // User is authorized to manage billing for this organization
      } catch (authError: any) {
        // CRITICAL FIX: Convert Response to HandlerResponse format
        // createAuthErrorResponse returns a Response object, but Netlify needs { statusCode, headers, body }
        const response = createAuthErrorResponse(authError);
        const responseBody = await response.text();
        return {
          statusCode: response.status,
          headers: jsonHeaders,
          body: responseBody
        };
      }
    }
    // LEGACY AUTH PATH: No role check - any team member can initiate billing (VULNERABLE)

    // FIX: Map tier + interval to priceId if not provided
    let finalPriceId = priceId;
    if (!finalPriceId && tier && billingInterval) {
      const priceMap: Record<string, Record<string, string>> = {
        startup: {
          monthly: process.env.VITE_STRIPE_STARTUP_PRICE_ID!,
          annual: process.env.VITE_STRIPE_STARTUP_ANNUAL_PRICE_ID!
        },
        growth: {
          monthly: process.env.VITE_STRIPE_GROWTH_PRICE_ID!,
          annual: process.env.VITE_STRIPE_GROWTH_ANNUAL_PRICE_ID!
        },
        pro: {
          monthly: process.env.VITE_STRIPE_PRO_PRICE_ID!,
          annual: process.env.VITE_STRIPE_PRO_ANNUAL_PRICE_ID!
        }
      };
      finalPriceId = priceMap[tier]?.[billingInterval];
    }

    if (!organizationId) {
      console.error('❌ No organizationId provided in request');
      return {
        statusCode: 400,
        headers: jsonHeaders,
        body: JSON.stringify({
          error: 'Organization ID is required. Please refresh the page and try again.',
          received: { tier, billingInterval, organizationId }
        })
      };
    }

    if (!finalPriceId) {
      console.error('❌ Could not determine price ID', { tier, billingInterval });
      return {
        statusCode: 400,
        headers: jsonHeaders,
        body: JSON.stringify({
          error: 'Invalid pricing tier or billing interval',
          received: { tier, billingInterval, organizationId }
        })
      };
    }

    // CRITICAL FIX: Add timeout to organization lookup
    const orgResult = await withTimeout(
      (async () => {
        return await supabase
          .from('organizations')
          .select('*')
          .eq('id', organizationId)
          .single();
      })(),
      TIMEOUTS.DATABASE_QUERY,
      'Organization lookup'
    ) as { data: any; error: any };

    const { data: org, error: orgError } = orgResult;

    if (orgError || !org) {
      console.error('❌ Organization lookup failed:', {
        organizationId,
        error: orgError?.message,
        code: orgError?.code
      });
      return {
        statusCode: 404,
        headers: jsonHeaders,
        body: JSON.stringify({
          error: 'Organization not found',
          details: 'Your workspace could not be found. Please contact support if this persists.',
          organizationId
        })
      };
    }

    let customerId = org.stripe_customer_id;

    if (!customerId) {
      // CRITICAL FIX: Add timeout to Stripe customer creation
      const customer = await withTimeout(
        stripe.customers.create({
          email: user.email,
          metadata: {
            organization_id: organizationId,
            user_id: user.id
          }
        }),
        TIMEOUTS.STRIPE_API,
        'Stripe customer creation'
      );
      customerId = customer.id;

      // CRITICAL FIX: Add timeout to customer ID update
      await withTimeout(
        (async () => {
          return await supabase
            .from('organizations')
            .update({ stripe_customer_id: customerId })
            .eq('id', organizationId);
        })(),
        TIMEOUTS.DATABASE_QUERY,
        'Save Stripe customer ID'
      );
    }

    // FIX: Use dynamic URLs for local testing and production
    const origin = event.headers.origin || event.headers.referer?.replace(/\/$/, '') || 'https://stageflow.startupstage.com';

    // CRITICAL FIX: Add timeout to Stripe checkout session creation
    const session = await withTimeout(
      stripe.checkout.sessions.create({
        customer: customerId,
        line_items: [{ price: finalPriceId, quantity: 1 }],
        mode: 'subscription',
        success_url: `${origin}/dashboard?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${origin}/settings?tab=billing`,
        metadata: {
          organization_id: organizationId,
          user_id: user.id
        }
      }),
      TIMEOUTS.STRIPE_API,
      'Stripe checkout session creation'
    );

    return {
      statusCode: 200,
      headers: jsonHeaders,
      body: JSON.stringify({
        sessionId: session.id,
        url: session.url
      })
    };

  } catch (error: any) {
    // FIX v1.7.63 - E3: Deep diagnostic logging for Stripe checkout failures
    console.error('❌ Error creating checkout session:', error);
    console.error('Error type:', error.constructor.name);
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);

    // Log Stripe-specific error details if available
    if (error.type) {
      console.error('Stripe error type:', error.type);
      console.error('Stripe error code:', error.code);
      console.error('Stripe error param:', error.param);
      console.error('Stripe error decline_code:', error.decline_code);
    }

    // Log request context for debugging
    console.error('Failed checkout context:', {
      hasStripeKey: !!process.env.STRIPE_SECRET_KEY,
      stripeKeyLength: process.env.STRIPE_SECRET_KEY?.length || 0,
      requestBody: JSON.stringify(error.requestBody || 'N/A'),
      timestamp: new Date().toISOString()
    });

    return {
      statusCode: 500,
      headers: jsonHeaders,
      body: JSON.stringify({
        error: 'Failed to create checkout session',
        details: error.message,
        type: error.type || 'unknown',
        code: error.code || 'unknown'
      })
    };
  }
};

export { handler };
