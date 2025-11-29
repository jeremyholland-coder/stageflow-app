import type { Handler, HandlerEvent } from '@netlify/functions';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { withTimeout, TIMEOUTS } from './lib/timeout-wrapper';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-09-30.clover',
});

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export const handler: Handler = async (event: HandlerEvent) => {
  // NOTE: Stripe webhooks are authenticated via Stripe signature verification
  // No additional authentication needed - this is the standard pattern
  // Feature flag not applicable: webhook signatures are cryptographically secure

  // Verify webhook signature
  const sig = event.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!sig || !webhookSecret) {
    console.error('Missing signature or webhook secret');
    return { statusCode: 400, body: 'Webhook configuration error' };
  }

  let stripeEvent: Stripe.Event;

  try {
    stripeEvent = stripe.webhooks.constructEvent(event.body!, sig, webhookSecret);
  } catch (err: any) {
    console.error('⚠️  Webhook signature verification failed:', err.message);
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Webhook signature verification failed' }),
    };
  }


  // CRITICAL FIX: Idempotency check - prevent duplicate webhook processing
  try {
    // Check if we've already processed this event
    const idempotencyResult = await withTimeout(
      (async () => {
        return await supabase
          .from('webhook_events')
          .select('id')
          .eq('stripe_event_id', stripeEvent.id)
          .maybeSingle();
      })(),
      TIMEOUTS.DATABASE_QUERY,
      'Webhook idempotency check'
    ) as { data: any };

    if (idempotencyResult.data) {
      return {
        statusCode: 200,
        body: JSON.stringify({ received: true, duplicate: true }),
      };
    }

    // Record this event BEFORE processing to prevent duplicates
    await withTimeout(
      (async () => {
        return await supabase.from('webhook_events').insert({
          stripe_event_id: stripeEvent.id,
          event_type: stripeEvent.type,
          processed_at: new Date().toISOString(),
        });
      })(),
      TIMEOUTS.DATABASE_QUERY,
      'Record webhook event'
    );

    // Handle subscription events
    switch (stripeEvent.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const subscription = stripeEvent.data.object as any;
        const priceId = subscription.items.data[0].price.id;

        // CRITICAL FIX: Map price IDs to plan tiers (monthly AND annual)
        const priceTierMap: Record<string, string> = {
          // Monthly prices
          [process.env.VITE_STRIPE_STARTUP_PRICE_ID!]: 'startup',
          [process.env.VITE_STRIPE_GROWTH_PRICE_ID!]: 'growth',
          [process.env.VITE_STRIPE_PRO_PRICE_ID!]: 'pro',
          // Annual prices
          [process.env.VITE_STRIPE_STARTUP_ANNUAL_PRICE_ID!]: 'startup',
          [process.env.VITE_STRIPE_GROWTH_ANNUAL_PRICE_ID!]: 'growth',
          [process.env.VITE_STRIPE_PRO_ANNUAL_PRICE_ID!]: 'pro',
        };

        const planTier = priceTierMap[priceId];

        if (!planTier) {
          console.error('❌ Unknown price ID received from Stripe:', priceId);
          throw new Error(`Unknown price ID: ${priceId}. Check VITE_STRIPE_*_PRICE_ID environment variables.`);
        }

        // CRITICAL FIX: Get organization first to link subscription
        const orgResult = await withTimeout(
          (async () => {
            return await supabase
              .from('organizations')
              .select('id')
              .eq('stripe_customer_id', subscription.customer as string)
              .single();
          })(),
          TIMEOUTS.DATABASE_QUERY,
          'Organization lookup'
        ) as { data: any; error: any };

        const { data: org, error: orgLookupError } = orgResult;

        if (orgLookupError || !org) {
          console.error('❌ Could not find organization for customer:', subscription.customer);
          throw new Error(`Organization not found for customer ${subscription.customer}`);
        }

        // Update subscription in database with organization_id
        const subResult = await withTimeout(
          (async () => {
            return await supabase
              .from('subscriptions')
              .upsert({
                stripe_subscription_id: subscription.id,
                stripe_customer_id: subscription.customer as string,
                organization_id: org.id, // CRITICAL: Link subscription to organization
                status: subscription.status,
                plan_tier: planTier,
                current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
                current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
                updated_at: new Date().toISOString(),
              }, {
                onConflict: 'stripe_subscription_id'
              })
              .select()
              .single();
          })(),
          TIMEOUTS.DATABASE_QUERY,
          'Subscription upsert'
        ) as { data: any; error: any };

        const { data: subData, error } = subResult;

        if (error) {
          console.error('Error updating subscription:', error);
          throw error;
        }

        // Update organization plan and link to subscription
        const orgUpdateResult = await withTimeout(
          (async () => {
            return await supabase
              .from('organizations')
              .update({
                plan: planTier,
                subscription_id: subData.id, // Link organization to subscription
                updated_at: new Date().toISOString(),
              })
              .eq('id', org.id);
          })(),
          TIMEOUTS.DATABASE_QUERY,
          'Organization plan update'
        ) as { error: any };

        const { error: orgError } = orgUpdateResult;

        if (orgError) {
          console.error('Error updating organization:', orgError);
          throw orgError; // This is critical - throw to ensure retry
        }

        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = stripeEvent.data.object as Stripe.Subscription;

        // Mark subscription as canceled
        const { error } = await supabase
          .from('subscriptions')
          .update({ 
            status: 'canceled',
            updated_at: new Date().toISOString(),
          })
          .eq('stripe_subscription_id', subscription.id);

        if (error) {
          console.error('Error canceling subscription:', error);
          throw error;
        }

        // Get the subscription record to find organization
        const { data: subData } = await supabase
          .from('subscriptions')
          .select('id, organization_id')
          .eq('stripe_subscription_id', subscription.id)
          .single();

        // Downgrade organization to free plan and unlink subscription
        if (subData?.organization_id) {
          const { error: orgError } = await supabase
            .from('organizations')
            .update({
              plan: 'free',
              subscription_id: null, // Unlink canceled subscription
              updated_at: new Date().toISOString(),
            })
            .eq('id', subData.organization_id);

          if (orgError) {
            console.error('Error downgrading organization:', orgError);
          }
        }

        break;
      }

      case 'invoice.payment_failed': {
        const invoice = stripeEvent.data.object as any;

        if (invoice.subscription) {
          const { error } = await supabase
            .from('subscriptions')
            .update({ 
              status: 'past_due',
              updated_at: new Date().toISOString(),
            })
            .eq('stripe_subscription_id', invoice.subscription as string);

          if (error) {
            console.error('Error marking subscription as past_due:', error);
            throw error;
          }

        }
        break;
      }

      case 'invoice.payment_succeeded': {
        const invoice = stripeEvent.data.object as any;

        if (invoice.subscription) {
          const { error } = await supabase
            .from('subscriptions')
            .update({ 
              status: 'active',
              updated_at: new Date().toISOString(),
            })
            .eq('stripe_subscription_id', invoice.subscription as string);

          if (error) {
            console.error('Error marking subscription as active:', error);
            throw error;
          }

        }
        break;
      }

      default:
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ received: true }),
    };
  } catch (error: any) {
    console.error('Error processing webhook:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Webhook processing failed' }),
    };
  }
};
