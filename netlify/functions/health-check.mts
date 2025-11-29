/**
 * Health Check Endpoint
 * Validates environment configuration and database connectivity
 * REFACTORED: Using standardized API helpers (Day 2, Oct 22, 2025)
 */

import type { Context } from "@netlify/functions";
import { withErrorHandling, successResponse } from "./lib/api-helpers";
import { shouldUseNewAuth } from './lib/feature-flags';
import { requireAuth, createAuthErrorResponse } from './lib/auth-middleware';

const healthCheckHandler = async (req: Request): Promise<Response> => {
  // SECURITY: Feature-flagged authentication migration
  // Phase 4 Batch 6: Add authentication to admin diagnostic function
  if (shouldUseNewAuth('health-check')) {
    try {
      // NEW AUTH PATH: Require authentication for admin operations
      await requireAuth(req);
    } catch (authError) {
      return createAuthErrorResponse(authError);
    }
  }
  // LEGACY AUTH PATH: No authentication (CRITICAL VULNERABILITY - admin function exposed)

  // Extract env vars
  const frontendUrl = process.env.VITE_SUPABASE_URL;
  const backendUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const frontendKey = process.env.VITE_SUPABASE_ANON_KEY;
  const backendKey = process.env.SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  
  // Database IDs
  const CURRENT_DB_ID = 'wogloqkryhasahoiajvt';
  const OLD_DB_ID = 'yqrabexvmhnqfnnblxnc';
  
  // Validation checks
  const checks = {
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'production',
    
    // URL validation
    frontend_url_exists: !!frontendUrl,
    backend_url_exists: !!backendUrl,
    urls_match: frontendUrl === backendUrl,
    uses_current_db: (frontendUrl?.includes(CURRENT_DB_ID) ?? false) && 
                     (backendUrl?.includes(CURRENT_DB_ID) ?? false),
    uses_old_db: (frontendUrl?.includes(OLD_DB_ID) ?? false) || 
                 (backendUrl?.includes(OLD_DB_ID) ?? false),
    
    // Key validation
    frontend_key_exists: !!frontendKey,
    backend_key_exists: !!backendKey,
    keys_match: frontendKey?.substring(0, 20) === backendKey?.substring(0, 20),
    service_role_exists: !!serviceRoleKey,
    
    // Security check
    service_role_in_frontend: !!process.env.VITE_SUPABASE_SERVICE_ROLE_KEY,
  };
  
  // Determine overall health
  const errors: string[] = [];
  const warnings: string[] = [];
  
  if (!checks.frontend_url_exists) errors.push('Missing VITE_SUPABASE_URL');
  if (!checks.backend_url_exists) errors.push('Missing SUPABASE_URL');
  if (!checks.urls_match) errors.push('Frontend/backend URL mismatch');
  if (!checks.uses_current_db) errors.push(`Not using current database (${CURRENT_DB_ID})`);
  if (checks.uses_old_db) errors.push(`Still referencing old database (${OLD_DB_ID})`);
  if (!checks.frontend_key_exists) errors.push('Missing VITE_SUPABASE_ANON_KEY');
  if (!checks.backend_key_exists) errors.push('Missing SUPABASE_ANON_KEY');
  if (!checks.keys_match) errors.push('Frontend/backend anon key mismatch');
  if (!checks.service_role_exists) warnings.push('Missing SUPABASE_SERVICE_ROLE_KEY');
  if (checks.service_role_in_frontend) errors.push('SECURITY: Service role exposed in frontend env');
  
  const healthy = errors.length === 0;
  
  const responseData = {
    status: healthy ? 'healthy' : 'unhealthy',
    checks,
    errors: errors.length > 0 ? errors : undefined,
    warnings: warnings.length > 0 ? warnings : undefined,
    database: {
      expected: CURRENT_DB_ID,
      frontend: frontendUrl?.split('.supabase.co')[0]?.split('//')[1],
      backend: backendUrl?.split('.supabase.co')[0]?.split('//')[1],
    }
  };
  
  // Return with appropriate status code
  return new Response(JSON.stringify(responseData, null, 2), {
    status: healthy ? 200 : 503,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache, no-store, must-revalidate'
    }
  });
};

// Export with standardized error handling
export default withErrorHandling(healthCheckHandler, 'health-check');
