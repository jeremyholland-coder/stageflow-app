import type { Context } from '@netlify/functions';
import { createClient, User } from '@supabase/supabase-js';
import { encrypt } from './lib/encryption';
import { createErrorResponse } from './lib/error-sanitizer';
import { withTimeout, TIMEOUTS } from './lib/timeout-wrapper';
import { requireAuth, createAuthErrorResponse } from './lib/auth-middleware';
import { requirePermission, PERMISSIONS } from './lib/rbac';

export default async (req: Request, context: Context) => {
  // SECURITY FIX: Specific origin instead of wildcard
  const allowedOrigins = [
    'https://stageflow.startupstage.com',
    'http://localhost:8888',
    'http://localhost:5173'
  ];
  const origin = req.headers.get('origin') || '';
  const allowOrigin = allowedOrigins.includes(origin) ? origin : 'https://stageflow.startupstage.com';

  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Credentials': 'true'
  };

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers });
  }

  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      { status: 405, headers }
    );
  }

  try {

    const supabaseUrl = process.env.SUPABASE_URL || process.env.SUPABASE_DATABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const encryptionKey = process.env.ENCRYPTION_KEY;

    if (!supabaseUrl || !supabaseServiceKey || !encryptionKey || encryptionKey.length !== 64) {
      console.error('❌ Missing environment configuration');
      return new Response(
        JSON.stringify({
          error: 'Server configuration error',
          debug: {
            hasUrl: !!supabaseUrl,
            hasKey: !!supabaseServiceKey,
            hasEncryption: !!encryptionKey
          }
        }),
        { status: 500, headers }
      );
    }

    // Create clean service role client
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });

    // Parse request body
    const requestBody = await req.json() as any;
    const { organization_id, provider_type, api_key, model, display_name } = requestBody;

    // Validate required fields (user_id now comes from session, not request)
    if (!organization_id || !provider_type || !api_key) {
      console.error('❌ Missing required fields');
      return new Response(
        JSON.stringify({
          error: 'Missing required fields',
          details: 'organization_id, provider_type, and api_key are required',
          received: {
            organization_id: !!organization_id,
            provider_type: !!provider_type,
            api_key: !!api_key
          }
        }),
        { status: 400, headers }
      );
    }

    // SECURITY FIX v1.7.98: Always require authentication, use session user ID
    // IDOR FIX: Never trust client-provided user_id - get from authenticated session
    let authenticatedUser: User;
    try {
      console.warn('[save-ai-provider] Starting auth for org:', organization_id);
      authenticatedUser = await requireAuth(req);
      console.warn('[save-ai-provider] requireAuth succeeded, user:', authenticatedUser.id);

      // PHASE 11 FIX: Query team_members directly instead of requireOrgAccess
      // requireOrgAccess would try to re-read body if org_id is falsy, causing "Organization ID required"
      if (!organization_id) {
        console.error('[save-ai-provider] No organization_id in request body');
        return new Response(
          JSON.stringify({ error: 'Organization ID is required' }),
          { status: 400, headers }
        );
      }

      // Verify membership directly
      const membershipCheck = await withTimeout(
        supabase
          .from('team_members')
          .select('role')
          .eq('user_id', authenticatedUser.id)
          .eq('organization_id', organization_id)
          .maybeSingle(),
        TIMEOUTS.DATABASE_QUERY,
        'Membership check timed out'
      );

      if (membershipCheck.error || !membershipCheck.data) {
        console.error('[save-ai-provider] User not in organization:', {
          userId: authenticatedUser.id,
          organizationId: organization_id,
          error: membershipCheck.error
        });
        return new Response(
          JSON.stringify({ error: 'Not authorized for this organization' }),
          { status: 403, headers }
        );
      }

      const member = membershipCheck.data;
      console.warn('[save-ai-provider] Membership verified, role:', member.role);

      // Require MANAGE_INTEGRATIONS permission (owner/admin only)
      requirePermission(member.role, PERMISSIONS.MANAGE_INTEGRATIONS);
      console.warn('[save-ai-provider] Permission check passed');

      // User is authenticated and authorized
    } catch (authError: any) {
      console.error('[save-ai-provider] Auth error:', {
        message: authError.message,
        code: authError.code,
        name: authError.name
      });
      return createAuthErrorResponse(authError);
    }

    // Use authenticated user ID (IDOR prevention)
    const user_id = authenticatedUser.id;


    // CRITICAL FIX: Future-proof validation patterns
    // Strategy: Minimal validation to catch obvious errors, let provider APIs be final authority
    // MUST MATCH frontend validation in AISettings.jsx for consistency
    const validateApiKey = (key: string, providerId: string): boolean => {
      const trimmed = key.trim();
      if (!trimmed) return false;

      switch(providerId) {
        case 'openai':
          // OpenAI keys: Must start with sk- (old: sk-...T3BlbkFJ..., new: sk-proj-...)
          // Accept any sk- key with reasonable minimum length (20 chars)
          return trimmed.startsWith('sk-') && trimmed.length >= 20;

        case 'anthropic':
          // Anthropic/Claude keys: Must start with sk-ant-
          // Formats evolve: sk-ant-api03-..., sk-ant-sid01-..., sk-ant-...
          // FUTURE-PROOF: Only check prefix and minimum length, not internal structure
          return trimmed.startsWith('sk-ant-') && trimmed.length >= 20;

        case 'google':
          // Google AI Studio keys: AIza prefix + base62 chars
          // Length can vary, but typically 39-40 chars total
          return trimmed.startsWith('AIza') && trimmed.length >= 35;

        case 'xai':
          // xAI/Grok keys: xai- prefix with variable length
          return trimmed.startsWith('xai-') && trimmed.length >= 20;

        default:
          // Generic fallback: any non-empty string with reasonable length
          return trimmed.length >= 20;
      }
    };

    if (!validateApiKey(api_key, provider_type)) {
      console.error('❌ Invalid API key format');
      return new Response(
        JSON.stringify({
          error: 'Invalid API key format',
          details: `The provided key does not match the expected format for ${provider_type}`
        }),
        { status: 400, headers }
      );
    }

    // Encrypt the API key
    let encryptedKey: string;
    try {
      encryptedKey = encrypt(api_key.trim());
    } catch (encryptError: any) {
      console.error('❌ Encryption error:', encryptError);
      return new Response(
        JSON.stringify({
          error: 'Encryption failed',
          details: encryptError.message
        }),
        { status: 500, headers }
      );
    }

    // FIX v1.7.60: Remove created_by filter to prevent duplicate providers
    // PROBLEM: Team member A creates provider, member B tries to update → creates duplicate
    // SOLUTION: Check by organization_id + provider_type only
    const { data: existing, error: existingError } = await withTimeout(
      supabase
        .from('ai_providers')
        .select('id')
        .eq('organization_id', organization_id)
        .eq('provider_type', provider_type)
        .eq('active', true)
        .maybeSingle(),
      TIMEOUTS.DATABASE_QUERY,
      'Provider lookup timed out'
    );

    if (existingError) {
      console.error('❌ Error checking existing provider:', existingError);
    }

    let result;
    
    if (existing) {
      // CRITICAL FIX: Update with timeout
      const { data, error } = await withTimeout(
        supabase
          .from('ai_providers')
          .update({
            api_key_encrypted: encryptedKey,
            display_name: display_name || provider_type,
            model: model
            // Note: updated_at column doesn't exist in schema, relying on DB trigger
          })
          .eq('id', existing.id)
          .select()
          .single(),
        TIMEOUTS.DATABASE_QUERY,
        'Provider update timed out'
      );

      if (error) {
        console.error('❌ Update failed:', {
          message: error.message,
          code: error.code,
          details: error.details,
          hint: error.hint
        });
        return new Response(
          JSON.stringify({
            error: 'Failed to update provider',
            details: error.message,
            code: error.code,
            hint: error.hint
          }),
          { status: 500, headers }
        );
      }
      
      result = data;
    } else {
      
      const insertData = {
        created_by: user_id,
        organization_id: organization_id,
        provider_type: provider_type,
        api_key_encrypted: encryptedKey,
        display_name: display_name || provider_type,
        model: model,
        active: true
      };

      // CRITICAL FIX: Insert with timeout
      const { data, error } = await withTimeout(
        supabase
          .from('ai_providers')
          .insert(insertData)
          .select()
          .single(),
        TIMEOUTS.DATABASE_QUERY,
        'Provider insert timed out'
      );

      if (error) {
        console.error('❌ Insert failed:', {
          message: error.message,
          code: error.code,
          details: error.details,
          hint: error.hint
        });

        // SECURITY FIX: Handle unique constraint violation
        // PostgreSQL error code 23505 = unique_violation
        if (error.code === '23505' || error.message?.includes('duplicate key value violates unique constraint')) {
          return new Response(
            JSON.stringify({
              error: 'Duplicate provider',
              details: `An active ${provider_type} provider already exists for this organization. Please update the existing provider instead of creating a new one.`,
              code: 'DUPLICATE_PROVIDER'
            }),
            { status: 409, headers } // 409 Conflict
          );
        }

        return new Response(
          JSON.stringify({
            error: 'Failed to save provider',
            details: error.message,
            code: error.code,
            hint: error.hint
          }),
          { status: 500, headers }
        );
      }

      result = data;
    }


    return new Response(
      JSON.stringify({
        success: true,
        provider: {
          id: result.id,
          provider_type: result.provider_type,
          display_name: result.display_name,
          model: result.model
        },
        message: 'Provider saved successfully'
      }),
      { status: 200, headers }
    );

  } catch (error: any) {
    console.error('================================');
    console.error('💥 UNCAUGHT ERROR');
    console.error('================================');
    console.error('Error:', error);
    console.error('Message:', error.message);
    console.error('Stack:', error.stack);

    // SECURITY: Use error sanitizer to prevent information disclosure
    return createErrorResponse(
      error,
      500,
      'save_ai_provider',
      'PROVIDER_SAVE_FAILED'
    );
  }
};
