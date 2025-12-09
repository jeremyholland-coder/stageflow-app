/**
 * CORS SPINE TESTS
 *
 * ENGINE REBUILD Phase 9: Tests for centralized CORS configuration
 *
 * Tests ensure:
 * 1. buildCorsHeaders returns correct headers for allowed origins
 * 2. getCorsOrigin correctly validates and returns origins
 * 3. Netlify deploy previews are handled correctly
 * 4. Unknown origins fall back to production origin
 */

import { describe, it, expect } from 'vitest';
import {
  buildCorsHeaders,
  getCorsOrigin,
  ALLOWED_ORIGINS,
  isNetlifyDeployPreview,
} from '../../netlify/functions/lib/cors';

describe('CORS Spine', () => {
  describe('ALLOWED_ORIGINS', () => {
    it('should include production origin', () => {
      expect(ALLOWED_ORIGINS).toContain('https://stageflow.startupstage.com');
    });

    it('should include staging origin', () => {
      expect(ALLOWED_ORIGINS).toContain('https://stageflow-app.netlify.app');
    });

    it('should include localhost origins', () => {
      expect(ALLOWED_ORIGINS).toContain('http://localhost:8888');
      expect(ALLOWED_ORIGINS).toContain('http://localhost:5173');
    });
  });

  describe('getCorsOrigin', () => {
    it('should return origin if in allowed list', () => {
      expect(getCorsOrigin('https://stageflow.startupstage.com')).toBe('https://stageflow.startupstage.com');
      expect(getCorsOrigin('http://localhost:8888')).toBe('http://localhost:8888');
    });

    it('should return origin for Netlify deploy previews', () => {
      // Netlify deploy preview format: https://deploy-preview-123--stageflow-app.netlify.app
      const preview = 'https://deploy-preview-123--stageflow-app.netlify.app';
      expect(getCorsOrigin(preview)).toBe(preview);
    });

    it('should return origin for branch deploys', () => {
      // Branch deploy format: https://feature-branch--stageflow-app.netlify.app
      const branchDeploy = 'https://feature-xyz--stageflow-app.netlify.app';
      expect(getCorsOrigin(branchDeploy)).toBe(branchDeploy);
    });

    it('should return production origin for unknown origins', () => {
      expect(getCorsOrigin('https://evil.com')).toBe('https://stageflow.startupstage.com');
      expect(getCorsOrigin('http://localhost:9999')).toBe('https://stageflow.startupstage.com');
    });

    it('should return production origin for empty string', () => {
      expect(getCorsOrigin('')).toBe('https://stageflow.startupstage.com');
    });

    it('should return production origin for null/undefined', () => {
      expect(getCorsOrigin(null)).toBe('https://stageflow.startupstage.com');
      expect(getCorsOrigin(undefined)).toBe('https://stageflow.startupstage.com');
    });
  });

  describe('isNetlifyDeployPreview', () => {
    it('should return true for stageflow Netlify deploy previews', () => {
      expect(isNetlifyDeployPreview('https://deploy-preview-123--stageflow-app.netlify.app')).toBe(true);
      expect(isNetlifyDeployPreview('https://main--stageflow-app.netlify.app')).toBe(true);
    });

    it('should return true for stageflow rev-ops previews', () => {
      expect(isNetlifyDeployPreview('https://deploy-preview-456--stageflow-rev-ops.netlify.app')).toBe(true);
    });

    it('should return false for non-stageflow Netlify sites', () => {
      expect(isNetlifyDeployPreview('https://other-site.netlify.app')).toBe(false);
      expect(isNetlifyDeployPreview('https://malicious--site.netlify.app')).toBe(false);
    });

    it('should return false for non-Netlify origins', () => {
      expect(isNetlifyDeployPreview('https://stageflow.com')).toBe(false);
      expect(isNetlifyDeployPreview('http://localhost:8888')).toBe(false);
    });
  });

  describe('buildCorsHeaders', () => {
    it('should return headers with correct origin', () => {
      const headers = buildCorsHeaders('https://stageflow.startupstage.com');

      expect(headers['Access-Control-Allow-Origin']).toBe('https://stageflow.startupstage.com');
      expect(headers['Access-Control-Allow-Credentials']).toBe('true');
    });

    it('should include Content-Type header', () => {
      const headers = buildCorsHeaders('https://stageflow.startupstage.com');

      expect(headers['Content-Type']).toBe('application/json');
    });

    it('should use custom methods when provided', () => {
      const headers = buildCorsHeaders('https://stageflow.startupstage.com', { methods: 'GET, OPTIONS' });

      expect(headers['Access-Control-Allow-Methods']).toBe('GET, OPTIONS');
    });

    it('should default to POST, OPTIONS for methods', () => {
      const headers = buildCorsHeaders('https://stageflow.startupstage.com');

      expect(headers['Access-Control-Allow-Methods']).toContain('POST');
      expect(headers['Access-Control-Allow-Methods']).toContain('OPTIONS');
    });

    it('should include Authorization in allowed headers', () => {
      const headers = buildCorsHeaders('https://stageflow.startupstage.com');

      expect(headers['Access-Control-Allow-Headers']).toContain('Authorization');
      expect(headers['Access-Control-Allow-Headers']).toContain('Content-Type');
    });

    it('should fall back to production origin for unknown origins', () => {
      const headers = buildCorsHeaders('https://evil.com');

      expect(headers['Access-Control-Allow-Origin']).toBe('https://stageflow.startupstage.com');
    });
  });
});
