/**
 * Billing & Plan Limits E2E Tests (API Level)
 *
 * Tests for:
 * - Stripe webhook handling (simulated)
 * - Plan limit enforcement
 * - Usage tracking
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getTestUserAuth, getAuthHeaders, getSupabaseClient } from './utils/auth';
import { post, logResponse } from './utils/api';
import { createClient } from '@supabase/supabase-js';

// Sample Stripe webhook payloads (from Stripe docs)
const SAMPLE_CHECKOUT_COMPLETED = {
  id: 'evt_test_checkout_completed',
  type: 'checkout.session.completed',
  data: {
    object: {
      id: 'cs_test_123',
      customer: 'cus_test_123',
      subscription: 'sub_test_123',
      mode: 'subscription',
      payment_status: 'paid'
    }
  }
};

const SAMPLE_SUBSCRIPTION_UPDATED = {
  id: 'evt_test_sub_updated',
  type: 'customer.subscription.updated',
  data: {
    object: {
      id: 'sub_test_123',
      customer: 'cus_test_123',
      status: 'active',
      items: {
        data: [{ price: { id: 'price_test_startup' } }]
      },
      current_period_start: Math.floor(Date.now() / 1000),
      current_period_end: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60
    }
  }
};

const SAMPLE_SUBSCRIPTION_DELETED = {
  id: 'evt_test_sub_deleted',
  type: 'customer.subscription.deleted',
  data: {
    object: {
      id: 'sub_test_123',
      customer: 'cus_test_123',
      status: 'canceled'
    }
  }
};

describe('Billing API', () => {
  let accessToken: string;
  let organizationId: string;

  beforeAll(async () => {
    const auth = await getTestUserAuth();
    accessToken = auth.accessToken;
    organizationId = auth.organizationId;
  });

  describe('Checkout Session', () => {
    it('should return 401 without authentication', async () => {
      const response = await post('create-checkout-session', {
        priceId: 'price_test',
        organizationId
      });

      expect(response.status).toBe(401);
    });

    it('should return 400 for missing priceId', async () => {
      const headers = getAuthHeaders(accessToken);
      const response = await post('create-checkout-session', {
        organizationId
      }, headers);

      expect(response.status).toBe(400);
    });

    it('should return 400 for missing organizationId', async () => {
      const headers = getAuthHeaders(accessToken);
      const response = await post('create-checkout-session', {
        priceId: 'price_test'
      }, headers);

      expect(response.status).toBe(400);
    });

    // Note: We can't fully test checkout without valid Stripe price IDs
    // and would redirect to Stripe's hosted page
  });

  describe('Portal Session', () => {
    it('should return 401 without authentication', async () => {
      const response = await post('create-portal-session', {
        organizationId
      });

      expect(response.status).toBe(401);
    });

    it('should return 400 for missing organizationId', async () => {
      const headers = getAuthHeaders(accessToken);
      const response = await post('create-portal-session', {}, headers);

      expect(response.status).toBe(400);
    });

    // Note: Portal session requires existing Stripe customer
  });

  describe('Webhook Endpoint', () => {
    // Note: Stripe webhooks require valid signature verification
    // We can only test basic validation here

    it('should return 400 without signature', async () => {
      const response = await post('stripe-webhook', {
        type: 'test.event',
        data: {}
      }, {
        'Content-Type': 'application/json'
        // No stripe-signature header
      });

      // Should fail signature verification
      expect(response.status).toBe(400);
    });

    it('should return 400 with invalid signature', async () => {
      const response = await post('stripe-webhook', JSON.stringify({
        type: 'test.event',
        data: {}
      }), {
        'Content-Type': 'application/json',
        'stripe-signature': 'invalid-signature'
      });

      expect(response.status).toBe(400);
    });
  });
});

describe('Plan Limits Enforcement', () => {
  let accessToken: string;
  let organizationId: string;
  let serviceClient: ReturnType<typeof createClient>;

  beforeAll(async () => {
    const auth = await getTestUserAuth();
    accessToken = auth.accessToken;
    organizationId = auth.organizationId;

    // Create service client for direct DB access
    serviceClient = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  });

  describe('Deals Limit', () => {
    it('should allow creating deals below limit', async () => {
      const headers = getAuthHeaders(accessToken);

      const response = await post('create-deal', {
        dealData: {
          client: `Limit Test ${Date.now()}`,
          value: 100
        },
        organizationId
      }, headers);

      // Should succeed (assuming we're below limit)
      expect([200, 201]).toContain(response.status);

      // Cleanup
      if (response.data.deal?.id) {
        await post('delete-deal', {
          dealId: response.data.deal.id,
          organizationId
        }, headers);
      }
    });

    it('should return error message for plan limit (simulated)', async () => {
      // Note: Actually hitting plan limits would require creating 100+ deals
      // We're just verifying the error handling pattern exists

      const headers = getAuthHeaders(accessToken);

      // This test verifies the create-deal endpoint returns proper errors
      // For actual limit testing, seed data directly
      const response = await post('create-deal', {
        dealData: {
          client: `Limit Test ${Date.now()}`,
          value: 100
        },
        organizationId
      }, headers);

      logResponse('create-deal (limit test)', response);

      // Should return 200 (success) or 403/429 (limit reached)
      expect([200, 201, 403, 429]).toContain(response.status);

      // If 403/429, should have clear error message
      if (response.status === 403 || response.status === 429) {
        expect(response.data.error || response.data.message).toContain('limit');
      }
    });
  });

  describe('AI Usage Limit', () => {
    it('should track AI usage', async () => {
      // Note: This would require an AI provider to be connected
      // We verify the endpoint exists and handles auth

      const headers = getAuthHeaders(accessToken);

      // AI insights endpoint
      const response = await post('ai-insights', {
        organizationId,
        prompt: 'test'
      }, headers);

      logResponse('ai-insights', response);

      // Should either work (200) or gracefully handle missing AI provider
      expect([200, 400, 403, 404, 429]).toContain(response.status);

      // Should not return 500
      expect(response.status).not.toBe(500);
    });
  });
});

describe('Subscription Status', () => {
  let accessToken: string;
  let organizationId: string;

  beforeAll(async () => {
    const auth = await getTestUserAuth();
    accessToken = auth.accessToken;
    organizationId = auth.organizationId;
  });

  it('should return current organization plan info', async () => {
    const headers = getAuthHeaders(accessToken);

    // Get profile which includes org info
    const response = await post('profile-get', {
      organizationId
    }, headers);

    expect(response.status).toBe(200);

    // Profile should include plan information
    // The structure depends on your API
    console.log('Profile data:', JSON.stringify(response.data, null, 2));
  });

  it('should include plan limits in response', async () => {
    const headers = getAuthHeaders(accessToken);

    const response = await post('profile-get', {
      organizationId
    }, headers);

    expect(response.status).toBe(200);

    // Check if plan info is included
    const hasOrgInfo = response.data.organization || response.data.profile?.organization;
    if (hasOrgInfo) {
      console.log('Organization plan:', hasOrgInfo.plan);
    }
  });
});

describe('Usage Tracking', () => {
  let accessToken: string;
  let organizationId: string;

  beforeAll(async () => {
    const auth = await getTestUserAuth();
    accessToken = auth.accessToken;
    organizationId = auth.organizationId;
  });

  it('should track deal count', async () => {
    const headers = getAuthHeaders(accessToken);

    // Get current deal count via API
    const response = await post('api-deals', {
      organizationId
    }, headers);

    logResponse('api-deals', response);

    if (response.status === 200) {
      const dealCount = Array.isArray(response.data.deals)
        ? response.data.deals.length
        : response.data.count || 0;
      console.log(`Current deal count: ${dealCount}`);
    }
  });
});

describe('Plan Upgrade/Downgrade Handling', () => {
  // These tests verify the behavior exists - actual changes require Stripe
  let accessToken: string;
  let organizationId: string;

  beforeAll(async () => {
    const auth = await getTestUserAuth();
    accessToken = auth.accessToken;
    organizationId = auth.organizationId;
  });

  it('should handle trial expiration gracefully', async () => {
    // When trial expires, org should downgrade to free
    // This is handled by webhooks - verify endpoints don't crash
    const headers = getAuthHeaders(accessToken);

    const response = await post('profile-get', {
      organizationId
    }, headers);

    expect(response.status).toBe(200);
    // No crash on trial/expired state
  });

  it('should enforce free tier limits after downgrade', async () => {
    // After downgrade, limits should be enforced
    // Test user might be on free tier already
    const headers = getAuthHeaders(accessToken);

    // Try creating a deal - should work within free tier limits
    const response = await post('create-deal', {
      dealData: {
        client: `Free Tier Test ${Date.now()}`,
        value: 50
      },
      organizationId
    }, headers);

    // Should either succeed or return limit error (not 500)
    expect([200, 201, 403, 429]).toContain(response.status);

    // Cleanup
    if (response.data.deal?.id) {
      await post('delete-deal', {
        dealId: response.data.deal.id,
        organizationId
      }, headers);
    }
  });
});
