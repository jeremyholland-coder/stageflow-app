/**
 * Notifications E2E Tests
 *
 * Tests for:
 * - notification-preferences-legacy-get: Get user's notification preferences
 * - notification-preferences-save: Save/update notification preferences
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { getTestUserAuth, getAuthHeaders } from './utils/auth';
import { post, logResponse } from './utils/api';

describe('Notifications API', () => {
  let accessToken: string;
  let organizationId: string;

  beforeAll(async () => {
    const auth = await getTestUserAuth();
    accessToken = auth.accessToken;
    organizationId = auth.organizationId;
  });

  describe('POST notification-preferences-legacy-get', () => {
    it('should return 401 without authentication', async () => {
      const response = await post('notification-preferences-legacy-get', {
        organization_id: organizationId
      });

      expect(response.status).toBe(401);
    });

    it('should return 400 for missing organization_id', async () => {
      const headers = getAuthHeaders(accessToken);
      const response = await post('notification-preferences-legacy-get', {}, headers);

      expect(response.status).toBe(400);
      expect(response.data.error).toContain('organization_id');
    });

    it('should return preferences for authenticated user', async () => {
      const headers = getAuthHeaders(accessToken);
      const response = await post('notification-preferences-legacy-get', {
        organization_id: organizationId
      }, headers);

      logResponse('notification-preferences-legacy-get', response);

      expect(response.status).toBe(200);
      expect(response.data.preferences).toBeDefined();

      // Should have expected preference fields (with defaults if not set)
      const prefs = response.data.preferences;
      expect(typeof prefs.all_notifications).toBe('boolean');
      expect(typeof prefs.notify_deal_created).toBe('boolean');
      expect(typeof prefs.notify_stage_changed).toBe('boolean');
      expect(typeof prefs.notify_deal_won).toBe('boolean');
      expect(typeof prefs.weekly_digest).toBe('boolean');
    });
  });

  describe('POST notification-preferences-save', () => {
    it('should return 401 without authentication', async () => {
      const response = await post('notification-preferences-save', {
        organization_id: organizationId,
        all_notifications: true
      });

      expect(response.status).toBe(401);
    });

    it('should return 400 for missing organization_id', async () => {
      const headers = getAuthHeaders(accessToken);
      const response = await post('notification-preferences-save', {
        all_notifications: true
      }, headers);

      expect(response.status).toBe(400);
    });

    it('should save notification preferences', async () => {
      const headers = getAuthHeaders(accessToken);

      // Generate a unique test value
      const testWeeklyDigest = Math.random() > 0.5;

      const response = await post('notification-preferences-save', {
        organization_id: organizationId,
        all_notifications: true,
        notify_deal_created: true,
        notify_stage_changed: true,
        notify_deal_won: true,
        notify_deal_lost: false,
        weekly_digest: testWeeklyDigest,
        digest_day: 'monday',
        digest_time: '09:00',
        digest_timezone: 'America/New_York'
      }, headers);

      logResponse('notification-preferences-save', response);

      expect(response.status).toBe(200);
      expect(response.data.success).toBe(true);
      expect(response.data.data).toBeDefined();
    });

    it('should persist preference changes', async () => {
      const headers = getAuthHeaders(accessToken);

      // Step 1: Set a specific value
      const testValue = false;
      await post('notification-preferences-save', {
        organization_id: organizationId,
        all_notifications: true,
        notify_deal_lost: testValue,
        weekly_digest: false
      }, headers);

      // Step 2: Read back and verify
      const getResponse = await post('notification-preferences-legacy-get', {
        organization_id: organizationId
      }, headers);

      expect(getResponse.status).toBe(200);
      expect(getResponse.data.preferences.notify_deal_lost).toBe(testValue);

      // Step 3: Change the value
      const newValue = true;
      await post('notification-preferences-save', {
        organization_id: organizationId,
        notify_deal_lost: newValue
      }, headers);

      // Step 4: Read back again and verify change persisted
      const verifyResponse = await post('notification-preferences-legacy-get', {
        organization_id: organizationId
      }, headers);

      expect(verifyResponse.status).toBe(200);
      expect(verifyResponse.data.preferences.notify_deal_lost).toBe(newValue);

      console.log('✓ Notification preference persistence verified');
    });
  });
});
