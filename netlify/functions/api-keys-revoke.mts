/**
 * Revoke API Key Endpoint
 *
 * PURPOSE:
 * Revoke (disable) an API key to prevent further use.
 * Revoked keys cannot be un-revoked - create a new key instead.
 *
 * AUTHENTICATION:
 * - Requires cookie-based OR API key authentication
 * - Can only revoke keys belonging to your organization
 *
 * USAGE:
 * POST /.netlify/functions/api-keys-revoke
 * {
 *   "keyId": "uuid",
 *   "reason": "Compromised - rotating keys" // optional
 * }
 *
 * RESPONSE:
 * {
 *   "success": true,
 *   "message": "API key revoked successfully",
 *   "keyName": "Production Mobile App",
 *   "revokedAt": "2025-01-19T12:34:56.000Z"
 * }
 */

import type { Handler, HandlerEvent, HandlerContext } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import { authenticateRequest } from './lib/api-key-auth';

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
    // Authenticate
    const auth = await authenticateRequest(new Request(
      `https://example.com${event.path}`,
      {
        method: event.httpMethod,
        headers: new Headers(event.headers as Record<string, string>)
      }
    ));

    // Parse request
    const body = JSON.parse(event.body || '{}');
    const { keyId, reason } = body;

    if (!keyId) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: 'Missing required field: keyId',
          code: 'INVALID_INPUT'
        })
      };
    }

    // Get Supabase client
    const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase configuration missing');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify key belongs to organization
    const { data: keyRecord, error: fetchError } = await supabase
      .from('api_keys')
      .select('id, name, organization_id, is_active')
      .eq('id', keyId)
      .single();

    if (fetchError || !keyRecord) {
      return {
        statusCode: 404,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: 'API key not found',
          code: 'KEY_NOT_FOUND'
        })
      };
    }

    // Check organization ownership
    if (keyRecord.organization_id !== auth.orgId) {
      return {
        statusCode: 403,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: 'Cannot revoke API key from different organization',
          code: 'FORBIDDEN'
        })
      };
    }

    // Check if already revoked
    if (!keyRecord.is_active) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: 'API key is already revoked',
          code: 'ALREADY_REVOKED'
        })
      };
    }

    // Revoke the key
    const revokedAt = new Date().toISOString();
    const { error: updateError } = await supabase
      .from('api_keys')
      .update({
        is_active: false,
        revoked_at: revokedAt,
        revoked_by: auth.userId,
        revocation_reason: reason || 'Revoked by user'
      })
      .eq('id', keyId);

    if (updateError) {
      console.error('❌ Failed to revoke API key:', updateError);
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: 'Failed to revoke API key',
          code: 'DATABASE_ERROR'
        })
      };
    }

    console.log(`✅ API key revoked: ${keyRecord.name} (${keyId}) by user ${auth.userId}`);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        message: 'API key revoked successfully',
        keyName: keyRecord.name,
        revokedAt
      })
    };

  } catch (error: any) {
    console.error('💥 API key revoke error:', error);

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
