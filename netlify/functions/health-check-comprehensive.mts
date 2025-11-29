// ENGINEERED SOLUTION: Comprehensive Health Check Endpoint
// Monitors all critical services for production readiness
// Date: 2025-11-04

import type { Context } from "@netlify/functions";
import { createClient } from '@supabase/supabase-js';
import { shouldUseNewAuth } from './lib/feature-flags';
import { requireAuth, createAuthErrorResponse } from './lib/auth-middleware';

export default async (req: Request, context: Context) => {
  // SECURITY: Feature-flagged authentication migration
  // Phase 4 Batch 6: Add authentication to admin diagnostic function
  if (shouldUseNewAuth('health-check-comprehensive')) {
    try {
      // NEW AUTH PATH: Require authentication for admin operations
      await requireAuth(req);
    } catch (authError) {
      return createAuthErrorResponse(authError);
    }
  }
  // LEGACY AUTH PATH: No authentication (CRITICAL VULNERABILITY - admin function exposed)

  const checks: Record<string, any> = {
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'unknown',
    healthy: true
  };

  // Check 1: Database connectivity
  try {
    const supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_ANON_KEY!
    );

    const { data, error } = await supabase
      .from('organizations')
      .select('id')
      .limit(1);

    checks.database = {
      status: error ? 'unhealthy' : 'healthy',
      error: error?.message,
      responsive: !error
    };

    if (error) checks.healthy = false;
  } catch (error: any) {
    checks.database = {
      status: 'unhealthy',
      error: error.message
    };
    checks.healthy = false;
  }

  // Check 2: Environment variables
  const requiredVars = [
    'SUPABASE_URL',
    'SUPABASE_ANON_KEY',
    'STRIPE_SECRET_KEY',
    'ENCRYPTION_KEY'
  ];

  const missingVars = requiredVars.filter(v => !process.env[v]);
  checks.environment_variables = {
    status: missingVars.length === 0 ? 'healthy' : 'unhealthy',
    missing: missingVars
  };

  if (missingVars.length > 0) checks.healthy = false;

  // Check 3: Encryption module
  try {
    const { encrypt, decrypt } = await import('./lib/encryption');
    const testValue = 'health-check-test';
    const encrypted = encrypt(testValue);
    const decrypted = decrypt(encrypted);

    checks.encryption = {
      status: decrypted === testValue ? 'healthy' : 'unhealthy',
      working: decrypted === testValue
    };

    if (decrypted !== testValue) checks.healthy = false;
  } catch (error: any) {
    checks.encryption = {
      status: 'unhealthy',
      error: error.message
    };
    checks.healthy = false;
  }

  // Return appropriate status code
  const statusCode = checks.healthy ? 200 : 503;

  return new Response(JSON.stringify(checks, null, 2), {
    status: statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache, no-store, must-revalidate'
    }
  });
};
