/**
 * Application Diagnostics Endpoint
 *
 * PURPOSE:
 * Internal debugging tool to verify database connectivity and schema health
 * without requiring manual SQL queries or screenshots.
 *
 * USAGE:
 * GET /.netlify/functions/app-diagnostics
 *
 * AUTHENTICATION:
 * - Requires cookie-based authentication (HttpOnly session)
 * - Returns limited info for unauthenticated users
 *
 * RESPONSE:
 * {
 *   "status": "ok" | "degraded" | "error",
 *   "timestamp": "2025-11-23T17:30:00.000Z",
 *   "user_id": "uuid",
 *   "organization_id": "uuid",
 *   "checks": {
 *     "auth": { "ok": true },
 *     "organization": { "ok": true, "name": "My Org" },
 *     "deals": { "ok": true, "count": 15 },
 *     "ai_providers": { "ok": true, "count": 2 },
 *     "api_keys": { "ok": true, "count": 1, "schema_ok": true }
 *   }
 * }
 */

import type { Handler, HandlerEvent, HandlerContext } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

// CORS headers
const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*', // Diagnostic endpoint - OK to be public
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

export const handler: Handler = async (event: HandlerEvent, context: HandlerContext) => {
  // Handle OPTIONS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers
    };
  }

  // Only allow GET
  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  const diagnosticResult: any = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    checks: {}
  };

  try {
    console.log('[DIAGNOSTICS] Starting health checks...');

    // Initialize Supabase client
    const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      diagnosticResult.status = 'error';
      diagnosticResult.checks.config = {
        ok: false,
        error: 'Missing Supabase configuration'
      };
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify(diagnosticResult)
      };
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Check 1: Authentication
    console.log('[DIAGNOSTICS] Checking authentication...');
    try {
      // Extract session from cookie (same logic as auth-session.mts)
      const cookieHeader = event.headers.cookie || '';
      const cookies = Object.fromEntries(
        cookieHeader.split(';').map(c => c.trim().split('=').map(decodeURIComponent))
      );

      const accessToken = cookies['sb-access-token'];
      const refreshToken = cookies['sb-refresh-token'];

      if (!accessToken || !refreshToken) {
        diagnosticResult.user_id = null;
        diagnosticResult.organization_id = null;
        diagnosticResult.checks.auth = {
          ok: false,
          authenticated: false,
          message: 'No session found - please log in first'
        };
        console.log('[DIAGNOSTICS] Unauthenticated request');
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify(diagnosticResult)
        };
      }

      // Validate session
      const { data: { user }, error: authError } = await supabase.auth.getUser(accessToken);

      if (authError || !user) {
        diagnosticResult.checks.auth = {
          ok: false,
          authenticated: false,
          error: authError?.message || 'Invalid session'
        };
        console.log('[DIAGNOSTICS] Invalid session:', authError?.message);
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify(diagnosticResult)
        };
      }

      diagnosticResult.user_id = user.id;
      diagnosticResult.checks.auth = {
        ok: true,
        authenticated: true,
        email: user.email
      };
      console.log('[DIAGNOSTICS] ✅ Auth check passed:', user.email);

      // Check 2: Organization membership
      console.log('[DIAGNOSTICS] Checking organization membership...');
      try {
        const { data: membership, error: membershipError } = await supabase
          .from('team_members')
          .select('organization_id, role, organizations(id, name)')
          .eq('user_id', user.id)
          .maybeSingle();

        if (membershipError) {
          diagnosticResult.checks.organization = {
            ok: false,
            error: membershipError.message,
            code: membershipError.code
          };
          diagnosticResult.status = 'degraded';
          console.log('[DIAGNOSTICS] ❌ Organization check failed:', membershipError.message);
        } else if (!membership) {
          diagnosticResult.checks.organization = {
            ok: false,
            error: 'No organization membership found'
          };
          diagnosticResult.status = 'degraded';
          console.log('[DIAGNOSTICS] ⚠️ User not in any organization');
        } else {
          diagnosticResult.organization_id = membership.organization_id;
          diagnosticResult.checks.organization = {
            ok: true,
            name: membership.organizations?.name || 'Unknown',
            role: membership.role
          };
          console.log('[DIAGNOSTICS] ✅ Organization check passed:', membership.organizations?.name);

          // Check 3: Deals table
          console.log('[DIAGNOSTICS] Checking deals table...');
          try {
            const { count, error: dealsError } = await supabase
              .from('deals')
              .select('id', { count: 'exact', head: true })
              .eq('organization_id', membership.organization_id);

            if (dealsError) {
              diagnosticResult.checks.deals = {
                ok: false,
                error: dealsError.message,
                code: dealsError.code
              };
              diagnosticResult.status = 'degraded';
              console.log('[DIAGNOSTICS] ❌ Deals check failed:', dealsError.message);
            } else {
              diagnosticResult.checks.deals = {
                ok: true,
                count: count || 0
              };
              console.log('[DIAGNOSTICS] ✅ Deals check passed: count =', count);
            }
          } catch (err: any) {
            diagnosticResult.checks.deals = {
              ok: false,
              error: err.message
            };
            diagnosticResult.status = 'degraded';
            console.log('[DIAGNOSTICS] ❌ Deals check exception:', err.message);
          }

          // Check 4: AI Providers table
          console.log('[DIAGNOSTICS] Checking ai_providers table...');
          try {
            const { count, error: aiError } = await supabase
              .from('ai_providers')
              .select('id', { count: 'exact', head: true })
              .eq('organization_id', membership.organization_id)
              .eq('active', true);

            if (aiError) {
              diagnosticResult.checks.ai_providers = {
                ok: false,
                error: aiError.message,
                code: aiError.code
              };
              diagnosticResult.status = 'degraded';
              console.log('[DIAGNOSTICS] ❌ AI providers check failed:', aiError.message);
            } else {
              diagnosticResult.checks.ai_providers = {
                ok: true,
                count: count || 0
              };
              console.log('[DIAGNOSTICS] ✅ AI providers check passed: count =', count);
            }
          } catch (err: any) {
            diagnosticResult.checks.ai_providers = {
              ok: false,
              error: err.message
            };
            diagnosticResult.status = 'degraded';
            console.log('[DIAGNOSTICS] ❌ AI providers check exception:', err.message);
          }

          // Check 5: API Keys table + schema validation
          console.log('[DIAGNOSTICS] Checking api_keys table and schema...');
          try {
            // First, verify schema by trying to select all columns
            const { data: sampleKey, error: schemaError } = await supabase
              .from('api_keys')
              .select('id, organization_id, created_by, name, key_prefix, key_hash, permissions, metadata, is_active, last_used_at, expires_at, created_at, updated_at, revoked_at, revoked_by, revocation_reason, usage_count, last_used_ip, last_used_user_agent')
              .eq('organization_id', membership.organization_id)
              .limit(1)
              .maybeSingle();

            if (schemaError) {
              diagnosticResult.checks.api_keys = {
                ok: false,
                schema_ok: false,
                error: schemaError.message,
                code: schemaError.code,
                hint: 'Schema validation failed - check if all 19 columns exist'
              };
              diagnosticResult.status = 'degraded';
              console.log('[DIAGNOSTICS] ❌ API keys schema validation failed:', schemaError.message);
            } else {
              // Schema OK, now get count
              const { count, error: countError } = await supabase
                .from('api_keys')
                .select('id', { count: 'exact', head: true })
                .eq('organization_id', membership.organization_id)
                .eq('is_active', true);

              if (countError) {
                diagnosticResult.checks.api_keys = {
                  ok: false,
                  schema_ok: true,
                  error: countError.message,
                  code: countError.code
                };
                diagnosticResult.status = 'degraded';
                console.log('[DIAGNOSTICS] ❌ API keys count failed:', countError.message);
              } else {
                diagnosticResult.checks.api_keys = {
                  ok: true,
                  schema_ok: true,
                  count: count || 0
                };
                console.log('[DIAGNOSTICS] ✅ API keys check passed: count =', count);
              }
            }
          } catch (err: any) {
            diagnosticResult.checks.api_keys = {
              ok: false,
              schema_ok: false,
              error: err.message
            };
            diagnosticResult.status = 'degraded';
            console.log('[DIAGNOSTICS] ❌ API keys check exception:', err.message);
          }
        }
      } catch (err: any) {
        diagnosticResult.checks.organization = {
          ok: false,
          error: err.message
        };
        diagnosticResult.status = 'degraded';
        console.log('[DIAGNOSTICS] ❌ Organization check exception:', err.message);
      }

    } catch (authErr: any) {
      diagnosticResult.checks.auth = {
        ok: false,
        error: authErr.message
      };
      diagnosticResult.status = 'error';
      console.log('[DIAGNOSTICS] ❌ Auth check exception:', authErr.message);
    }

    console.log('[DIAGNOSTICS] Health check complete:', diagnosticResult.status);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(diagnosticResult, null, 2)
    };

  } catch (error: any) {
    console.error('[DIAGNOSTICS] 💥 Critical error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        status: 'error',
        timestamp: new Date().toISOString(),
        error: error.message,
        checks: diagnosticResult.checks
      }, null, 2)
    };
  }
};
