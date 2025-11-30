/**
 * Profile E2E Tests
 *
 * Tests for:
 * - profile-get: Fetch authenticated user's profile
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { getTestUserAuth, getAuthHeaders } from './utils/auth';
import { get, logResponse } from './utils/api';

describe('Profile API', () => {
  let accessToken: string;
  let organizationId: string;

  beforeAll(async () => {
    const auth = await getTestUserAuth();
    accessToken = auth.accessToken;
    organizationId = auth.organizationId;
  });

  describe('GET profile-get', () => {
    it('should return 401 without authentication', async () => {
      const response = await get('profile-get');

      expect(response.status).toBe(401);
      expect(response.data.error).toBeDefined();
    });

    it('should return profile for authenticated user', async () => {
      const headers = getAuthHeaders(accessToken);
      const response = await get('profile-get', headers);

      logResponse('profile-get', response);

      expect(response.status).toBe(200);
      expect(response.data.success).toBe(true);
      expect(response.data.profile).toBeDefined();

      // Profile should have expected fields
      const profile = response.data.profile;
      expect(profile.id).toBeDefined();
      // email might be present
      if (profile.email) {
        expect(typeof profile.email).toBe('string');
      }
    });

    it('should include avatar_url field (may be null)', async () => {
      const headers = getAuthHeaders(accessToken);
      const response = await get('profile-get', headers);

      expect(response.status).toBe(200);
      // avatar_url should exist as a key (even if null)
      expect('avatar_url' in (response.data.profile || {})).toBe(true);
    });
  });
});
