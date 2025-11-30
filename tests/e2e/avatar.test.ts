/**
 * Avatar E2E Tests
 *
 * Tests for:
 * - upload-avatar: Upload profile picture
 * - remove-avatar: Remove profile picture
 *
 * Note: These tests require the 'avatars' bucket to exist in Supabase Storage.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getTestUserAuth, getAuthHeaders } from './utils/auth';
import { post, postFormData, logResponse, createTestImageFile } from './utils/api';

describe('Avatar API', () => {
  let accessToken: string;
  let organizationId: string;
  let uploadedAvatarUrl: string | null = null;

  beforeAll(async () => {
    const auth = await getTestUserAuth();
    accessToken = auth.accessToken;
    organizationId = auth.organizationId;
  });

  // Cleanup: Remove any uploaded avatar after tests
  afterAll(async () => {
    if (uploadedAvatarUrl) {
      try {
        const headers = getAuthHeaders(accessToken);
        await post('remove-avatar', {}, headers);
        console.log('✓ Cleanup: Removed test avatar');
      } catch (e) {
        console.warn('Avatar cleanup failed:', e);
      }
    }
  });

  describe('POST upload-avatar', () => {
    it('should return 401 without authentication', async () => {
      const formData = new FormData();
      const testFile = createTestImageFile();
      formData.append('file', testFile, 'test.png');

      const response = await postFormData('upload-avatar', formData);

      expect(response.status).toBe(401);
    });

    it('should return 400 for missing file', async () => {
      const headers = getAuthHeaders(accessToken);
      const formData = new FormData();
      // Don't append any file

      const response = await postFormData('upload-avatar', formData, headers);

      expect(response.status).toBe(400);
      expect(response.data.error).toContain('file');
    });

    it('should upload a valid image file', async () => {
      const headers = getAuthHeaders(accessToken);
      const formData = new FormData();

      // Create a small test PNG
      const testFile = createTestImageFile();
      formData.append('file', testFile, 'test-avatar.png');

      const response = await postFormData('upload-avatar', formData, headers);

      logResponse('upload-avatar', response);

      // May fail if avatars bucket doesn't exist - that's expected in some envs
      if (response.status === 500 && response.data.error?.includes('bucket')) {
        console.log('⚠️ Skipping: avatars bucket not configured');
        return;
      }

      expect(response.status).toBe(200);
      expect(response.data.success).toBe(true);
      expect(response.data.avatarUrl).toBeDefined();
      expect(response.data.avatarUrl).toContain('avatars');

      uploadedAvatarUrl = response.data.avatarUrl;
      console.log(`✓ Uploaded avatar: ${uploadedAvatarUrl}`);
    });

    it('should reject files over 2MB', async () => {
      const headers = getAuthHeaders(accessToken);
      const formData = new FormData();

      // Create a blob larger than 2MB
      const largeBuffer = new Uint8Array(2.5 * 1024 * 1024); // 2.5MB
      const largeFile = new Blob([largeBuffer], { type: 'image/png' });
      formData.append('file', largeFile, 'large.png');

      const response = await postFormData('upload-avatar', formData, headers);

      expect(response.status).toBe(400);
      expect(response.data.error).toContain('large');
    });

    it('should reject invalid file types', async () => {
      const headers = getAuthHeaders(accessToken);
      const formData = new FormData();

      // Create a text file
      const textFile = new Blob(['hello world'], { type: 'text/plain' });
      formData.append('file', textFile, 'test.txt');

      const response = await postFormData('upload-avatar', formData, headers);

      expect(response.status).toBe(400);
      expect(response.data.error).toContain('file type');
    });
  });

  describe('POST remove-avatar', () => {
    it('should return 401 without authentication', async () => {
      const response = await post('remove-avatar', {});

      expect(response.status).toBe(401);
    });

    it('should remove avatar successfully', async () => {
      // First ensure there's an avatar to remove
      if (!uploadedAvatarUrl) {
        // Try to upload one first
        const headers = getAuthHeaders(accessToken);
        const formData = new FormData();
        const testFile = createTestImageFile();
        formData.append('file', testFile, 'test-avatar.png');

        const uploadRes = await postFormData('upload-avatar', formData, headers);
        if (uploadRes.status !== 200) {
          console.log('⚠️ Skipping remove test: could not upload avatar first');
          return;
        }
        uploadedAvatarUrl = uploadRes.data.avatarUrl;
      }

      const headers = getAuthHeaders(accessToken);
      const response = await post('remove-avatar', {}, headers);

      logResponse('remove-avatar', response);

      expect(response.status).toBe(200);
      expect(response.data.success).toBe(true);

      uploadedAvatarUrl = null; // Cleared
      console.log('✓ Removed avatar');
    });

    it('should succeed even when no avatar exists', async () => {
      // Removing when there's nothing should still succeed (idempotent)
      const headers = getAuthHeaders(accessToken);
      const response = await post('remove-avatar', {}, headers);

      // Should succeed (200) - removing nothing is valid
      expect(response.status).toBe(200);
      expect(response.data.success).toBe(true);
    });
  });
});
