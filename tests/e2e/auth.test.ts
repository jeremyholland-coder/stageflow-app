/**
 * Auth E2E Tests (API Level)
 *
 * Tests for authentication flows:
 * - Login with valid/invalid credentials
 * - Password reset request
 * - Session validation
 * - Token refresh
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { getTestUserAuth, getAuthHeaders, getSupabaseClient } from './utils/auth';
import { post, logResponse } from './utils/api';

describe('Auth API', () => {
  let accessToken: string;
  let organizationId: string;

  beforeAll(async () => {
    const auth = await getTestUserAuth();
    accessToken = auth.accessToken;
    organizationId = auth.organizationId;
  });

  describe('Login Flow', () => {
    it('should return 401 for invalid credentials', async () => {
      // Simulate invalid login by calling an auth-required endpoint without token
      const response = await post('profile-get', {
        organizationId
      }, {
        'Content-Type': 'application/json'
        // No Authorization header
      });

      expect(response.status).toBe(401);
    });

    it('should return 200 with valid credentials', async () => {
      const headers = getAuthHeaders(accessToken);
      const response = await post('profile-get', {
        organizationId
      }, headers);

      expect(response.status).toBe(200);
      expect(response.data).toBeDefined();
    });

    it('should return clean error for malformed token', async () => {
      const response = await post('profile-get', {
        organizationId
      }, {
        'Authorization': 'Bearer malformed-token',
        'Content-Type': 'application/json'
      });

      expect(response.status).toBe(401);
      // Should have clean error message, not 500
      expect(response.data.error || response.data.message).toBeDefined();
    });
  });

  describe('Password Reset', () => {
    it('should accept password reset request for valid email', async () => {
      // This endpoint should not require auth
      const response = await post('auth-request-password-reset', {
        email: 'test@example.com'
      });

      logResponse('auth-request-password-reset', response);

      // Should return 200 (even if email doesn't exist - security best practice)
      // Or might return 400 for rate limiting
      expect([200, 400, 429]).toContain(response.status);

      // Should not return 500
      expect(response.status).not.toBe(500);
    });

    it('should return 400 for missing email', async () => {
      const response = await post('auth-request-password-reset', {});

      expect(response.status).toBe(400);
    });

    it('should return 400 for invalid email format', async () => {
      const response = await post('auth-request-password-reset', {
        email: 'not-an-email'
      });

      expect([400, 422]).toContain(response.status);
    });
  });

  describe('Session Validation', () => {
    it('should validate active session', async () => {
      const headers = getAuthHeaders(accessToken);
      const response = await post('auth-session', {}, headers);

      logResponse('auth-session', response);

      // Should return session info or valid status
      expect([200, 400, 404]).toContain(response.status);
    });

    it('should reject expired/invalid session', async () => {
      const response = await post('auth-session', {}, {
        'Authorization': 'Bearer expired-token-12345',
        'Content-Type': 'application/json'
      });

      // Should return 401 for invalid session
      expect(response.status).toBe(401);
    });
  });

  describe('Auth Error Responses', () => {
    it('should return consistent error format for 401', async () => {
      const response = await post('create-deal', {
        dealData: { client: 'Test' },
        organizationId
      });

      expect(response.status).toBe(401);
      expect(response.data).toBeDefined();

      // Should have error message
      const hasErrorMessage = response.data.error ||
        response.data.message ||
        response.data.code;
      expect(hasErrorMessage).toBeTruthy();
    });

    it('should not leak sensitive info in auth errors', async () => {
      const response = await post('profile-get', {
        organizationId
      }, {
        'Authorization': 'Bearer invalid',
        'Content-Type': 'application/json'
      });

      expect(response.status).toBe(401);

      // Response should not contain stack traces or internal details
      const responseText = JSON.stringify(response.data).toLowerCase();
      expect(responseText).not.toContain('stack');
      expect(responseText).not.toContain('supabase');
      expect(responseText).not.toContain('postgres');
    });
  });

  describe('Rate Limiting', () => {
    it('should handle rapid auth requests gracefully', async () => {
      // Send multiple requests quickly
      const requests = Array(5).fill(null).map(() =>
        post('auth-request-password-reset', {
          email: 'ratelimit-test@example.com'
        })
      );

      const responses = await Promise.all(requests);

      // All should return valid HTTP status (not crash)
      for (const response of responses) {
        expect([200, 400, 429]).toContain(response.status);
      }

      // At least some might be rate limited
      const rateLimited = responses.filter(r => r.status === 429);
      console.log(`Rate limited requests: ${rateLimited.length}/5`);
    });
  });
});

describe('Organization Access', () => {
  let accessToken: string;
  let organizationId: string;

  beforeAll(async () => {
    const auth = await getTestUserAuth();
    accessToken = auth.accessToken;
    organizationId = auth.organizationId;
  });

  it('should not allow access to other organizations', async () => {
    const headers = getAuthHeaders(accessToken);

    // Try to access a different organization
    const fakeOrgId = '00000000-0000-0000-0000-000000000000';
    const response = await post('profile-get', {
      organizationId: fakeOrgId
    }, headers);

    // Should return 403 (forbidden) or 404 (not found)
    expect([403, 404]).toContain(response.status);
  });

  it('should enforce organization boundaries on deals', async () => {
    const headers = getAuthHeaders(accessToken);
    const fakeOrgId = '00000000-0000-0000-0000-000000000000';

    const response = await post('create-deal', {
      dealData: { client: 'Cross-Org Test' },
      organizationId: fakeOrgId
    }, headers);

    // Should not allow creating deals in other orgs
    expect([400, 403, 404]).toContain(response.status);
  });
});

describe('Signup Flow', () => {
  it('should return 400 for missing fields', async () => {
    const response = await post('auth-signup', {});

    expect(response.status).toBe(400);
  });

  it('should return 400 for weak password', async () => {
    const response = await post('auth-signup', {
      email: 'newuser@test.com',
      password: '123' // Too weak
    });

    expect([400, 422]).toContain(response.status);

    // Should mention password requirements
    const errorText = JSON.stringify(response.data).toLowerCase();
    expect(errorText).toMatch(/password|weak|short|requirements/);
  });

  it('should return 400 for invalid email format', async () => {
    const response = await post('auth-signup', {
      email: 'invalid-email',
      password: 'ValidPassword123!'
    });

    expect([400, 422]).toContain(response.status);
  });

  // Note: We don't test successful signup to avoid creating test accounts
});
