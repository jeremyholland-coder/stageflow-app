/**
 * Authentication Health Check Endpoint
 *
 * PURPOSE:
 * Monitors authentication configuration in real-time to detect misconfigurations
 * that could disable security across all endpoints.
 *
 * USAGE:
 * - Automated monitoring: curl https://stageflow.startupstage.com/.netlify/functions/health-check-auth
 * - CI/CD validation: Check response status code (200 = healthy, 503 = degraded)
 * - Dashboard integration: Poll every 60 seconds
 *
 * RESPONSE:
 * - 200 OK: Authentication fully enabled (100% rollout)
 * - 503 Service Unavailable: Authentication misconfigured (disabled or partial rollout)
 */

import type { Handler, HandlerEvent, HandlerContext } from '@netlify/functions';
import { getFeatureFlagStatus, validateFeatureFlagConfig } from './lib/feature-flags';

export const handler: Handler = async (event: HandlerEvent, context: HandlerContext) => {
  try {
    // Get current feature flag status
    const status = getFeatureFlagStatus();

    // Validate configuration
    const validation = validateFeatureFlagConfig();

    // Determine health status
    const isHealthy = status.enabled && status.rolloutPercentage === 100 && validation.valid;

    // Build response
    const response = {
      timestamp: new Date().toISOString(),
      status: isHealthy ? 'healthy' : 'DEGRADED',
      environment: process.env.CONTEXT || 'unknown',
      auth_configuration: {
        enabled: status.enabled,
        rollout_percentage: status.rolloutPercentage,
        whitelist_users: status.whitelistCount,
        blacklist_users: status.blacklistCount,
        endpoint_overrides: status.endpointOverrideCount
      },
      alerts: [] as Array<{ severity: string; message: string; action?: string }>
    };

    // Generate alerts based on configuration
    if (!status.enabled) {
      response.alerts.push({
        severity: 'CRITICAL',
        message: 'Authentication is DISABLED - all endpoints are vulnerable',
        action: 'Immediately run: netlify env:set ENABLE_AUTH_MIDDLEWARE true'
      });
    }

    if (status.enabled && status.rolloutPercentage < 100) {
      response.alerts.push({
        severity: 'WARNING',
        message: `Authentication rollout is at ${status.rolloutPercentage}% (expected: 100%)`,
        action: `Run: netlify env:set AUTH_ROLLOUT_PERCENTAGE 100`
      });
    }

    if (!validation.valid) {
      validation.errors.forEach(error => {
        response.alerts.push({
          severity: error.includes('Warning') ? 'WARNING' : 'ERROR',
          message: error
        });
      });
    }

    // Return appropriate status code
    return {
      statusCode: isHealthy ? 200 : 503,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store, max-age=0'
      },
      body: JSON.stringify(response, null, 2)
    };

  } catch (error: any) {
    console.error('❌ Health check failed:', error);

    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        timestamp: new Date().toISOString(),
        status: 'ERROR',
        error: 'Health check execution failed',
        message: error.message
      }, null, 2)
    };
  }
};
