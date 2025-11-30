/**
 * Deals E2E Tests
 *
 * Tests for:
 * - create-deal: Create a new deal
 * - update-deal: Update deal fields/stage
 * - delete-deal: Soft-delete a deal
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getTestUserAuth, getAuthHeaders } from './utils/auth';
import { post, logResponse } from './utils/api';
import { createClient } from '@supabase/supabase-js';

describe('Deals API', () => {
  let accessToken: string;
  let organizationId: string;
  let createdDealId: string | null = null;

  beforeAll(async () => {
    const auth = await getTestUserAuth();
    accessToken = auth.accessToken;
    organizationId = auth.organizationId;
  });

  // Cleanup: Ensure test deal is deleted after tests
  afterAll(async () => {
    if (createdDealId) {
      try {
        const headers = getAuthHeaders(accessToken);
        await post('delete-deal', {
          dealId: createdDealId,
          organizationId
        }, headers);
        console.log(`✓ Cleanup: Deleted test deal ${createdDealId}`);
      } catch (e) {
        console.warn('Cleanup failed:', e);
      }
    }
  });

  describe('POST create-deal', () => {
    it('should return 401 without authentication', async () => {
      const response = await post('create-deal', {
        dealData: { client: 'Test' },
        organizationId
      });

      expect(response.status).toBe(401);
    });

    it('should return 400 for missing required fields', async () => {
      const headers = getAuthHeaders(accessToken);

      // Missing dealData
      const response1 = await post('create-deal', {
        organizationId
      }, headers);
      expect(response1.status).toBe(400);

      // Missing organizationId
      const response2 = await post('create-deal', {
        dealData: { client: 'Test' }
      }, headers);
      expect(response2.status).toBe(400);
    });

    it('should return 400 for missing client name', async () => {
      const headers = getAuthHeaders(accessToken);
      const response = await post('create-deal', {
        dealData: { value: 1000 },  // No client
        organizationId
      }, headers);

      expect(response.status).toBe(400);
      expect(response.data.error).toContain('Client name');
    });

    it('should create a deal with valid data', async () => {
      const headers = getAuthHeaders(accessToken);
      const uniqueClient = `E2E Test Client ${Date.now()}`;

      const response = await post('create-deal', {
        dealData: {
          client: uniqueClient,
          email: 'test@example.com',
          phone: '555-0100',
          value: 5000,
          stage: 'lead',
          notes: 'Created by e2e test'
        },
        organizationId
      }, headers);

      logResponse('create-deal', response);

      expect(response.status).toBe(200);
      expect(response.data.success).toBe(true);
      expect(response.data.deal).toBeDefined();
      expect(response.data.deal.id).toBeDefined();
      expect(response.data.deal.client).toBe(uniqueClient);
      expect(response.data.deal.value).toBe(5000);
      expect(response.data.deal.stage).toBe('lead');

      // Save for subsequent tests
      createdDealId = response.data.deal.id;
      console.log(`✓ Created deal: ${createdDealId}`);
    });

    it('should reject invalid stage values', async () => {
      const headers = getAuthHeaders(accessToken);

      const response = await post('create-deal', {
        dealData: {
          client: 'Invalid Stage Test',
          stage: 'invalid_stage_name'
        },
        organizationId
      }, headers);

      expect(response.status).toBe(400);
      expect(response.data.error).toContain('Invalid stage');
    });
  });

  describe('POST update-deal', () => {
    it('should return 401 without authentication', async () => {
      const response = await post('update-deal', {
        dealId: 'test-id',
        updates: { value: 100 },
        organizationId
      });

      expect(response.status).toBe(401);
    });

    it('should return 400 for missing required fields', async () => {
      const headers = getAuthHeaders(accessToken);

      const response = await post('update-deal', {
        dealId: 'test-id'
        // Missing updates and organizationId
      }, headers);

      expect(response.status).toBe(400);
    });

    it('should update deal stage', async () => {
      // Skip if no deal was created
      if (!createdDealId) {
        console.log('Skipping update test - no deal created');
        return;
      }

      const headers = getAuthHeaders(accessToken);
      const response = await post('update-deal', {
        dealId: createdDealId,
        updates: { stage: 'quote' },
        organizationId
      }, headers);

      logResponse('update-deal', response);

      expect(response.status).toBe(200);
      expect(response.data.deal).toBeDefined();
      expect(response.data.deal.stage).toBe('quote');
    });

    it('should update deal value', async () => {
      if (!createdDealId) return;

      const headers = getAuthHeaders(accessToken);
      const response = await post('update-deal', {
        dealId: createdDealId,
        updates: { value: 10000 },
        organizationId
      }, headers);

      expect(response.status).toBe(200);
      expect(response.data.deal.value).toBe(10000);
    });

    it('should return 404 for non-existent deal', async () => {
      const headers = getAuthHeaders(accessToken);
      const response = await post('update-deal', {
        dealId: '00000000-0000-0000-0000-000000000000',
        updates: { value: 100 },
        organizationId
      }, headers);

      expect(response.status).toBe(404);
    });

    it('should reject invalid stage on update', async () => {
      if (!createdDealId) return;

      const headers = getAuthHeaders(accessToken);
      const response = await post('update-deal', {
        dealId: createdDealId,
        updates: { stage: 'not_a_real_stage' },
        organizationId
      }, headers);

      expect(response.status).toBe(400);
      expect(response.data.error).toContain('Invalid stage');
    });
  });

  describe('POST delete-deal', () => {
    it('should return 401 without authentication', async () => {
      const response = await post('delete-deal', {
        dealId: 'test-id',
        organizationId
      });

      expect(response.status).toBe(401);
    });

    it('should return 400 for missing required fields', async () => {
      const headers = getAuthHeaders(accessToken);
      const response = await post('delete-deal', {
        dealId: 'test-id'
        // Missing organizationId
      }, headers);

      expect(response.status).toBe(400);
    });

    it('should soft-delete the test deal', async () => {
      if (!createdDealId) return;

      const headers = getAuthHeaders(accessToken);
      const response = await post('delete-deal', {
        dealId: createdDealId,
        organizationId
      }, headers);

      logResponse('delete-deal', response);

      expect(response.status).toBe(200);
      expect(response.data.success).toBe(true);
      expect(response.data.deal).toBeDefined();
      expect(response.data.deal.deleted_at).toBeDefined();

      console.log(`✓ Deleted deal: ${createdDealId}`);
      // Clear so afterAll doesn't try to delete again
      createdDealId = null;
    });

    it('should return 400 when deleting already-deleted deal', async () => {
      // Create and immediately delete a deal
      const headers = getAuthHeaders(accessToken);

      const createRes = await post('create-deal', {
        dealData: { client: 'Delete Twice Test', email: 'delete-test@example.com', phone: '555-0199', value: 100 },
        organizationId
      }, headers);

      const dealId = createRes.data.deal.id;

      // First delete
      const del1 = await post('delete-deal', { dealId, organizationId }, headers);
      expect(del1.status).toBe(200);

      // Second delete should fail
      const del2 = await post('delete-deal', { dealId, organizationId }, headers);
      expect(del2.status).toBe(400);
      expect(del2.data.code).toBe('ALREADY_DELETED');
    });
  });
});
