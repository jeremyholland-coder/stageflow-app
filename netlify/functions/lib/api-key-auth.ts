/**
 * API Key Authentication Library
 *
 * PURPOSE:
 * Provides API key authentication for non-browser clients (mobile apps,
 * third-party integrations, scripts, CI/CD pipelines).
 *
 * USAGE:
 * ```typescript
 * import { requireApiKey } from './lib/api-key-auth';
 *
 * const { userId, orgId, permissions } = await requireApiKey(req);
 * ```
 *
 * AUTHENTICATION FLOW:
 * 1. Extract API key from X-API-Key header
 * 2. Hash the key with SHA-256
 * 3. Query database for matching key_hash
 * 4. Validate: is_active, expires_at, permissions
 * 5. Update last_used_at and usage_count
 * 6. Return user context for authorization
 *
 * SECURITY:
 * - Keys are hashed with SHA-256 (never stored in plaintext)
 * - Scoped to organization (RLS enforced)
 * - Can be revoked instantly
 * - Expiration supported (optional)
 * - Rate-limiting per key (via middleware)
 */

import { createClient } from '@supabase/supabase-js';
import { createHash } from 'crypto';

// Error classes
export class ApiKeyError extends Error {
  constructor(
    message: string,
    public code: string = 'API_KEY_ERROR',
    public statusCode: number = 401
  ) {
    super(message);
    this.name = 'ApiKeyError';
  }
}

export class ApiKeyNotFoundError extends ApiKeyError {
  constructor() {
    super('API key not found in request headers', 'API_KEY_MISSING', 401);
  }
}

export class InvalidApiKeyError extends ApiKeyError {
  constructor(reason: string = 'Invalid API key') {
    super(reason, 'INVALID_API_KEY', 401);
  }
}

export class RevokedApiKeyError extends ApiKeyError {
  constructor() {
    super('API key has been revoked', 'API_KEY_REVOKED', 401);
  }
}

export class ExpiredApiKeyError extends ApiKeyError {
  constructor() {
    super('API key has expired', 'API_KEY_EXPIRED', 401);
  }
}

export class InsufficientPermissionsError extends ApiKeyError {
  constructor(required: string, actual: string[]) {
    super(
      `Insufficient permissions. Required: ${required}, Have: ${actual.join(', ')}`,
      'INSUFFICIENT_PERMISSIONS',
      403
    );
  }
}

/**
 * API Key context returned after successful authentication
 */
export interface ApiKeyContext {
  /** User ID who created the API key */
  userId: string;
  /** Organization ID the key belongs to */
  orgId: string;
  /** Permissions granted to this key */
  permissions: string[];
  /** API key ID (for logging/tracking) */
  keyId: string;
  /** Key name (for logging) */
  keyName: string;
}

/**
 * Extract API key from request headers
 * Supports both X-API-Key and Authorization: Bearer formats
 */
function extractApiKey(req: Request): string {
  // Try X-API-Key header first (recommended)
  const apiKeyHeader = req.headers.get('x-api-key') || req.headers.get('X-API-Key');
  if (apiKeyHeader) {
    return apiKeyHeader.trim();
  }

  // Try Authorization: Bearer as fallback
  const authHeader = req.headers.get('authorization') || req.headers.get('Authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7).trim();
    // Check if it looks like an API key (starts with sk_)
    if (token.startsWith('sk_')) {
      return token;
    }
  }

  throw new ApiKeyNotFoundError();
}

/**
 * Hash API key with SHA-256
 * This matches the format stored in the database
 */
function hashApiKey(apiKey: string): string {
  return createHash('sha256').update(apiKey).digest('hex');
}

/**
 * Validate API key format
 * Expected format: sf_{env}_{random} (sf = StageFlow)
 * Example: sf_live_abc123def456ghi789
 */
function validateApiKeyFormat(apiKey: string): void {
  // Check prefix
  if (!apiKey.startsWith('sf_')) {
    throw new InvalidApiKeyError('API key must start with "sf_"');
  }

  // Check length (minimum 32 characters for security)
  if (apiKey.length < 32) {
    throw new InvalidApiKeyError('API key too short');
  }

  // Check format: sk_{env}_{random}
  const parts = apiKey.split('_');
  if (parts.length < 3) {
    throw new InvalidApiKeyError('Invalid API key format. Expected: sk_{env}_{random}');
  }

  // Check environment (live or test)
  const env = parts[1];
  if (!['live', 'test'].includes(env)) {
    throw new InvalidApiKeyError('API key environment must be "live" or "test"');
  }
}

/**
 * Validate and authenticate API key
 * Returns user context for authorization
 *
 * @throws ApiKeyNotFoundError if key not in headers
 * @throws InvalidApiKeyError if key format invalid or not found in database
 * @throws RevokedApiKeyError if key has been revoked
 * @throws ExpiredApiKeyError if key has expired
 */
export async function requireApiKey(req: Request): Promise<ApiKeyContext> {
  // Extract API key from headers
  const apiKey = extractApiKey(req);

  // Validate format
  validateApiKeyFormat(apiKey);

  // Hash the key for database lookup
  const keyHash = hashApiKey(apiKey);

  // Get Supabase configuration
  // CRITICAL: Backend MUST prefer SUPABASE_* vars over VITE_* vars
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    console.error('❌ [API Key Auth] Missing Supabase configuration');
    throw new ApiKeyError('Server configuration error', 'CONFIG_ERROR', 500);
  }

  // Create Supabase client with service role key (bypass RLS)
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  // Look up API key in database
  const { data: keyRecord, error: queryError } = await supabase
    .from('api_keys')
    .select('id, organization_id, created_by, name, permissions, is_active, expires_at, last_used_at')
    .eq('key_hash', keyHash)
    .single();

  if (queryError || !keyRecord) {
    console.error('❌ [API Key Auth] Key not found:', keyHash.substring(0, 16) + '...');
    throw new InvalidApiKeyError('API key not found');
  }

  // Check if key is active
  if (!keyRecord.is_active) {
    console.warn('⚠️  [API Key Auth] Revoked key used:', keyRecord.id);
    throw new RevokedApiKeyError();
  }

  // Check if key is expired
  if (keyRecord.expires_at && new Date(keyRecord.expires_at) < new Date()) {
    console.warn('⚠️  [API Key Auth] Expired key used:', keyRecord.id);
    throw new ExpiredApiKeyError();
  }

  // Update last_used_at and usage_count (async, don't block response)
  // Note: This runs in background, errors are logged but don't fail auth
  supabase
    .from('api_keys')
    .update({
      last_used_at: new Date().toISOString(),
      usage_count: (await supabase.from('api_keys').select('usage_count').eq('id', keyRecord.id).single()).data?.usage_count + 1 || 1
    })
    .eq('id', keyRecord.id)
    .then(() => {
      console.log(`✅ [API Key Auth] Key used: ${keyRecord.name} (${keyRecord.id})`);
    })
    .catch((err) => {
      console.error('❌ [API Key Auth] Failed to update usage stats:', err);
    });

  // Return authenticated context
  return {
    userId: keyRecord.created_by,
    orgId: keyRecord.organization_id,
    permissions: Array.isArray(keyRecord.permissions) ? keyRecord.permissions : ['read'],
    keyId: keyRecord.id,
    keyName: keyRecord.name
  };
}

/**
 * Check if API key has required permission
 * @throws InsufficientPermissionsError if permission not granted
 */
export function requirePermission(context: ApiKeyContext, permission: string): void {
  if (!context.permissions.includes(permission) && !context.permissions.includes('admin')) {
    throw new InsufficientPermissionsError(permission, context.permissions);
  }
}

/**
 * Generate a new API key
 * Format: sf_{env}_{random}
 * Example: sf_live_abc123def456... (64 hex characters)
 */
export function generateApiKey(environment: 'live' | 'test' = 'live'): string {
  // Generate 32 bytes of randomness (256 bits)
  const randomBytes = require('crypto').randomBytes(32);
  const randomString = randomBytes.toString('hex'); // 64 hex characters

  // Format: sf_{env}_{random} (sf = StageFlow)
  return `sf_${environment}_${randomString}`;
}

/**
 * Get API key prefix for display
 * Shows first 16 characters: sf_live_abc12345
 * Used for key identification without exposing full key
 */
export function getApiKeyPrefix(apiKey: string): string {
  return apiKey.substring(0, 16);
}

/**
 * Middleware: Support both cookie auth and API key auth
 * Tries cookie auth first, falls back to API key
 *
 * Usage in endpoints:
 * ```typescript
 * const auth = await authenticateRequest(req);
 * // auth.method = 'cookie' | 'api_key'
 * // auth.userId, auth.orgId available
 * ```
 */
export async function authenticateRequest(req: Request): Promise<{
  method: 'cookie' | 'api_key';
  userId: string;
  orgId: string;
  permissions?: string[];
}> {
  // Try API key first (if X-API-Key header present)
  const hasApiKey = req.headers.has('x-api-key') || req.headers.has('X-API-Key') ||
    (req.headers.get('authorization')?.startsWith('Bearer sk_'));

  if (hasApiKey) {
    try {
      const context = await requireApiKey(req);
      return {
        method: 'api_key',
        userId: context.userId,
        orgId: context.orgId,
        permissions: context.permissions
      };
    } catch (error) {
      // API key failed, don't fallback (explicit API key = must be valid)
      throw error;
    }
  }

  // No API key header = must use cookie auth
  // Import cookie auth and validate
  const { requireAuth } = await import('./auth-middleware');
  const user = await requireAuth(req);

  // Get organization from team_members
  // CRITICAL: Backend MUST prefer SUPABASE_* vars over VITE_* vars
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabase = createClient(supabaseUrl!, supabaseServiceKey!);

  const { data: membership } = await supabase
    .from('team_members')
    .select('organization_id')
    .eq('user_id', user.id)
    .single();

  if (!membership) {
    throw new ApiKeyError('User not associated with any organization', 'NO_ORGANIZATION', 403);
  }

  return {
    method: 'cookie',
    userId: user.id,
    orgId: membership.organization_id
  };
}
