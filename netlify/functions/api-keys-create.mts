/**
 * Create API Key Endpoint
 *
 * PURPOSE:
 * Allow users to create API keys for programmatic access to their organization's data.
 *
 * AUTHENTICATION:
 * - Requires cookie-based authentication (user must be logged in via browser)
 * - Cannot create API keys using an API key (must use session cookies)
 *
 * USAGE:
 * POST /.netlify/functions/api-keys-create
 * {
 *   "name": "Production Mobile App",
 *   "permissions": ["read", "write"],
 *   "expiresInDays": 365 // optional, null = never expires
 * }
 *
 * RESPONSE:
 * {
 *   "success": true,
 *   "apiKey": "sf_live_EXAMPLE_KEY_SHOWN_ONLY_ONCE", // SHOWN ONLY ONCE
 *   "keyId": "uuid",
 *   "keyPrefix": "sf_live_EXAMPLE",
 *   "name": "Production Mobile App",
 *   "permissions": ["read", "write"],
 *   "expiresAt": "2026-01-19T00:00:00.000Z",
 *   "warning": "Save this API key securely - it will not be shown again"
 * }
 */

import type { Handler, HandlerEvent, HandlerContext } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import { requireAuth } from './lib/auth-middleware';
import { generateApiKey, getApiKeyPrefix } from './lib/api-key-auth';
import { createHash } from 'crypto';

export const handler: Handler = async (event: HandlerEvent, context: HandlerContext) => {
  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    // Authenticate user (cookie-based auth only)
    const user = await requireAuth(new Request(
      `https://example.com${event.path}`,
      {
        method: event.httpMethod,
        headers: new Headers(event.headers as Record<string, string>)
      }
    ));

    // Parse request body
    const body = JSON.parse(event.body || '{}');
    const { name, permissions = ['read'], expiresInDays } = body;

    // Validate input
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: 'Missing required field: name',
          code: 'INVALID_INPUT'
        })
      };
    }

    // Validate permissions
    const validPermissions = ['read', 'write', 'admin'];
    if (!Array.isArray(permissions) || !permissions.every(p => validPermissions.includes(p))) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: 'Invalid permissions. Must be array of: read, write, admin',
          code: 'INVALID_PERMISSIONS'
        })
      };
    }

    // Get user's organization
    const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase configuration missing');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get user's organization from team_members
    const { data: membership, error: membershipError } = await supabase
      .from('team_members')
      .select('organization_id')
      .eq('user_id', user.id)
      .single();

    if (membershipError || !membership) {
      console.error('[API KEYS] User not in any organization:', {
        userId: user.id,
        userEmail: user.email,
        error: membershipError?.message,
        errorCode: membershipError?.code,
        errorDetails: membershipError?.details
      });
      return {
        statusCode: 403,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: 'User not associated with any organization. Please contact support.',
          code: 'NO_ORGANIZATION',
          details: membershipError?.message
        })
      };
    }

    console.log('[API KEYS] Creating key for org:', {
      organizationId: membership.organization_id,
      userId: user.id,
      keyName: name.trim()
    });

    // Generate API key
    const apiKey = generateApiKey('live');
    const keyPrefix = getApiKeyPrefix(apiKey);
    const keyHash = createHash('sha256').update(apiKey).digest('hex');

    // Calculate expiration date
    let expiresAt: string | null = null;
    if (expiresInDays && typeof expiresInDays === 'number' && expiresInDays > 0) {
      const expiration = new Date();
      expiration.setDate(expiration.getDate() + expiresInDays);
      expiresAt = expiration.toISOString();
    }

    // Insert API key into database
    const { data: keyRecord, error: insertError } = await supabase
      .from('api_keys')
      .insert({
        organization_id: membership.organization_id,
        created_by: user.id,
        name: name.trim(),
        key_prefix: keyPrefix,
        key_hash: keyHash,
        permissions,
        is_active: true,
        expires_at: expiresAt
      })
      .select('id, name, key_prefix, permissions, expires_at, created_at')
      .single();

    if (insertError || !keyRecord) {
      console.error('[API KEYS] Failed to create API key:', {
        error: insertError,
        errorMessage: insertError?.message,
        errorCode: insertError?.code,
        errorDetails: insertError?.details,
        errorHint: insertError?.hint,
        organizationId: membership.organization_id,
        userId: user.id
      });
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: insertError?.message || 'Failed to create API key',
          code: 'DATABASE_ERROR',
          details: insertError?.details || insertError?.hint
        })
      };
    }

    console.log(`✅ API key created: ${keyRecord.name} (${keyRecord.id}) by ${user.email}`);

    // Return API key (ONLY TIME IT'S SHOWN)
    return {
      statusCode: 201,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        apiKey, // FULL KEY - shown only once
        keyId: keyRecord.id,
        keyPrefix: keyRecord.key_prefix,
        name: keyRecord.name,
        permissions: keyRecord.permissions,
        expiresAt: keyRecord.expires_at,
        createdAt: keyRecord.created_at,
        warning: '⚠️ Save this API key securely - it will not be shown again'
      })
    };

  } catch (error: any) {
    console.error('💥 API key creation error:', error);

    // Handle authentication errors
    if (error.name === 'UnauthorizedError') {
      return {
        statusCode: 401,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: error.message,
          code: 'UNAUTHORIZED'
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
