/**
 * AI Providers E2E Tests
 *
 * Tests for:
 * - get-ai-providers: List AI providers for organization
 * - remove-ai-provider: Deactivate an AI provider
 *
 * Note: save-ai-provider requires actual API keys, so we test
 * read operations and removal of test/seeded providers.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { getTestUserAuth, getAuthHeaders } from './utils/auth';
import { post, logResponse } from './utils/api';

describe('AI Providers API', () => {
  let accessToken: string;
  let organizationId: string;

  beforeAll(async () => {
    const auth = await getTestUserAuth();
    accessToken = auth.accessToken;
    organizationId = auth.organizationId;
  });

  describe('POST get-ai-providers', () => {
    it('should return 401 without authentication', async () => {
      const response = await post('get-ai-providers', {
        organization_id: organizationId
      });

      expect(response.status).toBe(401);
    });

    it('should return providers list for authenticated user', async () => {
      const headers = getAuthHeaders(accessToken);
      const response = await post('get-ai-providers', {
        organization_id: organizationId
      }, headers);

      logResponse('get-ai-providers', response);

      expect(response.status).toBe(200);
      expect(response.data.success).toBe(true);
      expect(Array.isArray(response.data.providers)).toBe(true);
      expect(response.data.organizationId).toBe(organizationId);

      // If providers exist, verify structure
      if (response.data.providers.length > 0) {
        const provider = response.data.providers[0];
        expect(provider.id).toBeDefined();
        expect(provider.provider_type).toBeDefined();
        expect(typeof provider.active).toBe('boolean');
      }
    });

    it('should only return active providers', async () => {
      const headers = getAuthHeaders(accessToken);
      const response = await post('get-ai-providers', {
        organization_id: organizationId
      }, headers);

      expect(response.status).toBe(200);

      // All returned providers should be active
      for (const provider of response.data.providers) {
        expect(provider.active).toBe(true);
      }
    });

    it('should return 403 for wrong organization', async () => {
      const headers = getAuthHeaders(accessToken);
      const response = await post('get-ai-providers', {
        organization_id: '00000000-0000-0000-0000-000000000000'
      }, headers);

      // Should be 403 (not authorized for this org) or 404
      expect([403, 404]).toContain(response.status);
    });
  });

  describe('POST remove-ai-provider', () => {
    it('should return 401 without authentication', async () => {
      const response = await post('remove-ai-provider', {
        providerId: 'test-id',
        organizationId
      });

      expect(response.status).toBe(401);
    });

    it('should return 400 for missing required fields', async () => {
      const headers = getAuthHeaders(accessToken);
      const response = await post('remove-ai-provider', {
        providerId: 'test-id'
        // Missing organizationId
      }, headers);

      expect(response.status).toBe(400);
    });

    it('should return 404 for non-existent provider', async () => {
      const headers = getAuthHeaders(accessToken);
      const response = await post('remove-ai-provider', {
        providerId: '00000000-0000-0000-0000-000000000000',
        organizationId
      }, headers);

      expect(response.status).toBe(404);
      expect(response.data.success).toBe(false);
    });

    it('should return 403 for provider in different organization', async () => {
      const headers = getAuthHeaders(accessToken);

      // Try to remove with wrong org ID
      const response = await post('remove-ai-provider', {
        providerId: '00000000-0000-0000-0000-000000000000',
        organizationId: '00000000-0000-0000-0000-000000000001'
      }, headers);

      // Should be 403 (not authorized for this org) or 404
      expect([403, 404]).toContain(response.status);
    });

    // Note: To fully test remove-ai-provider, we'd need to:
    // 1. First save a test provider (requires valid API key)
    // 2. Then remove it
    // 3. Verify it's inactive in DB
    //
    // For now, we test the error paths and leave happy-path
    // for manual testing or when test fixtures are available.
  });
});
