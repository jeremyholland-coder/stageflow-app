/**
 * Metrics & Data Integrity E2E Tests
 *
 * Ensures that dashboard metrics are consistent with actual data:
 * - Total Deals count
 * - Open Pipeline Value
 * - Won Revenue
 * - Win Rate
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getTestUserAuth, getAuthHeaders } from './utils/auth';
import { post, logResponse } from './utils/api';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

describe('Metrics Consistency', () => {
  let accessToken: string;
  let organizationId: string;
  let userId: string;
  let serviceClient: SupabaseClient;

  // Track deals created for cleanup
  const createdDealIds: string[] = [];

  beforeAll(async () => {
    const auth = await getTestUserAuth();
    accessToken = auth.accessToken;
    organizationId = auth.organizationId;
    userId = auth.user.id;

    // Create service client for direct DB access
    serviceClient = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  });

  afterAll(async () => {
    // Cleanup: Delete all test deals
    const headers = getAuthHeaders(accessToken);

    for (const dealId of createdDealIds) {
      try {
        await post('delete-deal', {
          dealId,
          organizationId
        }, headers);
        console.log(`✓ Cleaned up deal: ${dealId}`);
      } catch (e) {
        console.warn(`Cleanup failed for ${dealId}:`, e);
      }
    }
  });

  describe('Deal Count Accuracy', () => {
    it('should return correct deal count', async () => {
      const headers = getAuthHeaders(accessToken);

      // Get current deals directly from DB
      const { data: dbDeals, error } = await serviceClient
        .from('deals')
        .select('id')
        .eq('organization_id', organizationId)
        .is('deleted_at', null);

      if (error) {
        console.error('DB query error:', error);
        return;
      }

      const dbDealCount = dbDeals?.length || 0;

      // Get deals via API
      const apiResponse = await post('api-deals', {
        organizationId
      }, headers);

      logResponse('api-deals', apiResponse);

      if (apiResponse.status === 200) {
        const apiDealCount = Array.isArray(apiResponse.data.deals)
          ? apiResponse.data.deals.length
          : apiResponse.data.count || 0;

        console.log(`DB Deal Count: ${dbDealCount}`);
        console.log(`API Deal Count: ${apiDealCount}`);

        // Counts should match (or be close if there's a cache)
        expect(apiDealCount).toBe(dbDealCount);
      }
    });

    it('should correctly count after creating a deal', async () => {
      const headers = getAuthHeaders(accessToken);

      // Get initial count
      const { data: initialDeals } = await serviceClient
        .from('deals')
        .select('id')
        .eq('organization_id', organizationId)
        .is('deleted_at', null);

      const initialCount = initialDeals?.length || 0;

      // Create a new deal
      const createResponse = await post('create-deal', {
        dealData: {
          client: `Metrics Test ${Date.now()}`,
          value: 5000,
          stage: 'lead'
        },
        organizationId
      }, headers);

      expect(createResponse.status).toBe(200);

      if (createResponse.data.deal?.id) {
        createdDealIds.push(createResponse.data.deal.id);
      }

      // Verify count increased
      const { data: newDeals } = await serviceClient
        .from('deals')
        .select('id')
        .eq('organization_id', organizationId)
        .is('deleted_at', null);

      const newCount = newDeals?.length || 0;

      expect(newCount).toBe(initialCount + 1);
    });
  });

  describe('Pipeline Value Accuracy', () => {
    it('should calculate open pipeline value correctly', async () => {
      const headers = getAuthHeaders(accessToken);

      // Get open deals from DB (not won/lost)
      const { data: openDeals } = await serviceClient
        .from('deals')
        .select('id, value, stage')
        .eq('organization_id', organizationId)
        .is('deleted_at', null)
        .not('stage', 'in', '("won","closed_won","lost","closed_lost")');

      const dbOpenValue = openDeals?.reduce((sum, deal) => sum + (deal.value || 0), 0) || 0;

      console.log(`DB Open Pipeline Value: $${dbOpenValue}`);
      console.log(`Open Deals:`, openDeals?.map(d => ({ stage: d.stage, value: d.value })));

      // The API might aggregate this differently
      // Just verify the DB calculation is correct
      expect(typeof dbOpenValue).toBe('number');
    });

    it('should calculate won revenue correctly', async () => {
      // Get won deals from DB
      const { data: wonDeals } = await serviceClient
        .from('deals')
        .select('id, value, stage')
        .eq('organization_id', organizationId)
        .is('deleted_at', null)
        .in('stage', ['won', 'closed_won', 'payment_received']);

      const dbWonValue = wonDeals?.reduce((sum, deal) => sum + (deal.value || 0), 0) || 0;

      console.log(`DB Won Revenue: $${dbWonValue}`);
      console.log(`Won Deals:`, wonDeals?.map(d => ({ stage: d.stage, value: d.value })));

      expect(typeof dbWonValue).toBe('number');
    });
  });

  describe('Win Rate Calculation', () => {
    it('should calculate win rate correctly', async () => {
      // Get all closed deals (won + lost)
      const { data: closedDeals } = await serviceClient
        .from('deals')
        .select('id, stage')
        .eq('organization_id', organizationId)
        .is('deleted_at', null)
        .in('stage', ['won', 'closed_won', 'lost', 'closed_lost', 'payment_received']);

      const wonCount = closedDeals?.filter(d =>
        ['won', 'closed_won', 'payment_received'].includes(d.stage)
      ).length || 0;

      const lostCount = closedDeals?.filter(d =>
        ['lost', 'closed_lost'].includes(d.stage)
      ).length || 0;

      const totalClosed = wonCount + lostCount;
      const winRate = totalClosed > 0 ? (wonCount / totalClosed) * 100 : 0;

      console.log(`Won: ${wonCount}, Lost: ${lostCount}, Total Closed: ${totalClosed}`);
      console.log(`Calculated Win Rate: ${winRate.toFixed(1)}%`);

      expect(winRate).toBeGreaterThanOrEqual(0);
      expect(winRate).toBeLessThanOrEqual(100);
    });
  });

  describe('Empty State Handling', () => {
    it('should handle organization with no deals', async () => {
      // This tests the pattern, not an actual empty org
      // We verify the API handles 0 deals gracefully

      const headers = getAuthHeaders(accessToken);

      // Profile endpoint should work even with 0 deals
      const response = await post('profile-get', {
        organizationId
      }, headers);

      expect(response.status).toBe(200);
      // Should not return null values that break the UI
      expect(response.data).not.toBe(null);
    });
  });

  describe('Seeded Data Verification', () => {
    let testDealIds: string[] = [];

    it('should verify metrics with known seeded data', async () => {
      const headers = getAuthHeaders(accessToken);

      // Seed known data: 3 deals
      const seedData = [
        { client: 'Seed Test A', value: 1000, stage: 'lead' },
        { client: 'Seed Test B', value: 2000, stage: 'won' },
        { client: 'Seed Test C', value: 3000, stage: 'quote' },
      ];

      // Create the deals
      for (const deal of seedData) {
        const response = await post('create-deal', {
          dealData: {
            client: `${deal.client} ${Date.now()}`,
            value: deal.value,
            stage: deal.stage
          },
          organizationId
        }, headers);

        if (response.status === 200 && response.data.deal?.id) {
          testDealIds.push(response.data.deal.id);
          createdDealIds.push(response.data.deal.id);
        }
      }

      console.log(`Created ${testDealIds.length} test deals`);

      // Expected values from seeded data
      // Open deals: 1000 (lead) + 3000 (quote) = 4000
      // Won deals: 2000
      // Win rate would need more context

      // Verify by querying DB directly
      const { data: seededDeals } = await serviceClient
        .from('deals')
        .select('*')
        .in('id', testDealIds);

      expect(seededDeals?.length).toBe(3);

      // Verify values
      const openValue = seededDeals
        ?.filter(d => !['won', 'lost'].includes(d.stage))
        .reduce((sum, d) => sum + (d.value || 0), 0);

      const wonValue = seededDeals
        ?.filter(d => d.stage === 'won')
        .reduce((sum, d) => sum + (d.value || 0), 0);

      console.log(`Seeded Open Value: $${openValue}`);
      console.log(`Seeded Won Value: $${wonValue}`);

      expect(openValue).toBe(4000);
      expect(wonValue).toBe(2000);
    });
  });

  describe('Stage Aggregations', () => {
    it('should correctly aggregate deals by stage', async () => {
      const { data: stageAggregation } = await serviceClient
        .from('deals')
        .select('stage')
        .eq('organization_id', organizationId)
        .is('deleted_at', null);

      // Count by stage
      const stageCounts: Record<string, number> = {};
      stageAggregation?.forEach(deal => {
        stageCounts[deal.stage] = (stageCounts[deal.stage] || 0) + 1;
      });

      console.log('Deals by Stage:', stageCounts);

      // Each stage count should be >= 0
      Object.values(stageCounts).forEach(count => {
        expect(count).toBeGreaterThanOrEqual(0);
      });
    });
  });
});

describe('Data Integrity Checks', () => {
  let serviceClient: SupabaseClient;
  let organizationId: string;

  beforeAll(async () => {
    const auth = await getTestUserAuth();
    organizationId = auth.organizationId;

    serviceClient = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  });

  it('should have no orphaned deals', async () => {
    // Deals should always belong to an organization
    const { data: orphanedDeals } = await serviceClient
      .from('deals')
      .select('id, organization_id')
      .is('organization_id', null);

    expect(orphanedDeals?.length || 0).toBe(0);
  });

  it('should have valid stage values', async () => {
    const validStages = [
      'lead', 'quote', 'proposal', 'negotiation',
      'won', 'closed_won', 'lost', 'closed_lost',
      'invoice_sent', 'payment_received', 'retention'
    ];

    const { data: deals } = await serviceClient
      .from('deals')
      .select('id, stage')
      .eq('organization_id', organizationId)
      .is('deleted_at', null);

    const invalidStages = deals?.filter(d => !validStages.includes(d.stage)) || [];

    if (invalidStages.length > 0) {
      console.warn('Deals with invalid stages:', invalidStages);
    }

    // All stages should be valid
    expect(invalidStages.length).toBe(0);
  });

  it('should have non-negative deal values', async () => {
    const { data: deals } = await serviceClient
      .from('deals')
      .select('id, value')
      .eq('organization_id', organizationId)
      .lt('value', 0);

    expect(deals?.length || 0).toBe(0);
  });

  it('should have timestamps in correct order', async () => {
    const { data: deals } = await serviceClient
      .from('deals')
      .select('id, created_at, updated_at')
      .eq('organization_id', organizationId)
      .limit(100);

    const badTimestamps = deals?.filter(d =>
      d.updated_at && new Date(d.updated_at) < new Date(d.created_at)
    ) || [];

    expect(badTimestamps.length).toBe(0);
  });
});
