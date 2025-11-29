/**
 * List API Keys Endpoint
 *
 * PURPOSE:
 * List all API keys for the authenticated user's organization.
 * Does NOT return the full API key (security), only metadata.
 *
 * AUTHENTICATION:
 * - Requires cookie-based OR API key authentication
 * - Returns keys for the authenticated user's organization only
 *
 * USAGE:
 * GET /.netlify/functions/api-keys-list
 *
 * RESPONSE:
 * {
 *   "success": true,
 *   "keys": [
 *     {
 *       "id": "uuid",
 *       "name": "Production Mobile App",
 *       "keyPrefix": "sf_live_abc12345",
 *       "permissions": ["read", "write"],
 *       "isActive": true,
 *       "lastUsedAt": "2025-01-19T12:34:56.000Z",
 *       "usageCount": 1523,
 *       "expiresAt": "2026-01-19T00:00:00.000Z",
 *       "createdAt": "2025-01-19T00:00:00.000Z",
 *       "createdBy": "user@example.com"
 *     }
 *   ]
 * }
 */

import type { Handler, HandlerEvent, HandlerContext } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import { authenticateRequest } from './lib/api-key-auth';

export const handler: Handler = async (event: HandlerEvent, context: HandlerContext) => {
  // Only allow GET
  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    // Authenticate (supports both cookie and API key)
    const auth = await authenticateRequest(new Request(
      `https://example.com${event.path}`,
      {
        method: event.httpMethod,
        headers: new Headers(event.headers as Record<string, string>)
      }
    ));

    // Get Supabase client
    const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase configuration missing');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Fetch API keys for organization
    const { data: keys, error: queryError } = await supabase
      .from('api_keys')
      .select(`
        id,
        name,
        key_prefix,
        permissions,
        is_active,
        last_used_at,
        usage_count,
        expires_at,
        created_at,
        created_by,
        revoked_at,
        revoked_by,
        revocation_reason
      `)
      .eq('organization_id', auth.orgId)
      .order('created_at', { ascending: false });

    if (queryError) {
      console.error('❌ Failed to fetch API keys:', queryError);
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: 'Failed to fetch API keys',
          code: 'DATABASE_ERROR'
        })
      };
    }

    // Get creator emails for display
    const creatorIds = [...new Set(keys?.map(k => k.created_by) || [])];
    const { data: users } = await supabase
      .from('auth.users')
      .select('id, email')
      .in('id', creatorIds);

    const emailMap = new Map(users?.map(u => [u.id, u.email]) || []);

    // Format response (hide sensitive data)
    const formattedKeys = (keys || []).map(key => ({
      id: key.id,
      name: key.name,
      keyPrefix: key.key_prefix,
      permissions: key.permissions,
      isActive: key.is_active,
      lastUsedAt: key.last_used_at,
      usageCount: key.usage_count || 0,
      expiresAt: key.expires_at,
      createdAt: key.created_at,
      createdBy: emailMap.get(key.created_by) || key.created_by,
      revokedAt: key.revoked_at,
      revocationReason: key.revocation_reason
    }));

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        keys: formattedKeys,
        count: formattedKeys.length
      })
    };

  } catch (error: any) {
    console.error('💥 API keys list error:', error);

    // Handle authentication errors
    if (error.statusCode === 401 || error.statusCode === 403) {
      return {
        statusCode: error.statusCode,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: error.message,
          code: error.code || 'UNAUTHORIZED'
        })
      };
    }

    // Generic error
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: 'Internal server error',
        code: 'INTERNAL_ERROR'
      })
    };
  }
};
