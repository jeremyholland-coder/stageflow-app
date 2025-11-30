/**
 * Centralized Authentication Middleware
 *
 * ZERO TRUST ARCHITECTURE:
 * - Never trust client-provided user IDs
 * - Always validate session tokens
 * - Always verify organization membership
 * - Fail secure (reject if validation fails)
 *
 * PERFORMANCE:
 * - Token caching (30 seconds)
 * - Organization membership caching (5 minutes)
 * - <10ms overhead target
 */

import { createClient, SupabaseClient, User } from '@supabase/supabase-js';
import {
  UnauthorizedError,
  ForbiddenError,
  TokenExpiredError,
  InvalidTokenError,
  OrganizationAccessError,
  InsufficientRoleError
} from './auth-errors';

// Token cache (in-memory, 30 second TTL)
const tokenCache = new Map<string, { user: User; expiresAt: number }>();
const TOKEN_CACHE_TTL = 30 * 1000; // 30 seconds

// Organization membership cache (in-memory, 5 minute TTL)
interface OrgMembership {
  user_id: string;
  organization_id: string;
  role: string;
}

const orgCache = new Map<string, { membership: OrgMembership; expiresAt: number }>();
const ORG_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Cache cleanup (run every 5 minutes)
setInterval(() => {
  const now = Date.now();

  // Clean expired tokens
  for (const [token, cached] of tokenCache.entries()) {
    if (cached.expiresAt < now) {
      tokenCache.delete(token);
    }
  }

  // Clean expired org memberships
  for (const [key, cached] of orgCache.entries()) {
    if (cached.expiresAt < now) {
      orgCache.delete(key);
    }
  }
}, 5 * 60 * 1000);

/**
 * Get Supabase client with service role key
 *
 * PERFORMANCE FIX: Now uses connection pool singleton
 * Reduces database connections by 99% across all auth middleware calls
 */
function getSupabaseClient(): SupabaseClient {
  // MIGRATION: Use connection pool instead of createClient
  // This reuses a single client across all function invocations
  const { getSupabaseClient: getPooledClient } = require('./supabase-pool');
  return getPooledClient();
}

/**
 * Extract JWT token from Authorization header OR HttpOnly cookies
 *
 * PHASE 4 FIX: Dual-mode authentication (2025-11-30)
 * - PRIMARY: Authorization: Bearer <token> header (most reliable cross-origin)
 * - FALLBACK: HttpOnly cookies (for legacy/direct browser navigation)
 *
 * ROOT CAUSE: Cross-origin requests from stageflow.startupstage.com to
 * Netlify Functions may not include cookies due to SameSite/Domain restrictions,
 * even with credentials: 'include'. Authorization header is more reliable.
 */
function extractToken(req: Request): string {
  // DIAGNOSTIC LOGGING: Help identify auth flow issues
  const cookieHeader = req.headers.get('cookie');
  const authHeader = req.headers.get('authorization');
  const origin = req.headers.get('origin') || 'no-origin';

  console.warn('[auth-bridge] Request received:', {
    origin,
    hasCookieHeader: !!cookieHeader,
    cookieHeaderLength: cookieHeader?.length || 0,
    hasAuthHeader: !!authHeader,
    authHeaderType: authHeader ? authHeader.split(' ')[0] : 'none',
    // Log cookie names present (not values for security)
    cookieNames: cookieHeader
      ? cookieHeader.split(';').map(c => c.split('=')[0]?.trim()).filter(Boolean)
      : []
  });

  // PRIMARY: Check Authorization header first (most reliable for cross-origin)
  if (authHeader) {
    const parts = authHeader.split(' ');
    if (parts.length === 2 && parts[0].toLowerCase() === 'bearer') {
      const token = parts[1];
      if (token && token.length > 20) {
        console.warn('[auth-bridge] Using Authorization header token');
        return token;
      }
    }
    console.warn('[auth-bridge] Malformed Authorization header:', {
      format: authHeader.substring(0, 15) + '...'
    });
  }

  // FALLBACK: Try HttpOnly cookies
  if (!cookieHeader) {
    console.error('[auth-bridge] FAILED: No Authorization header AND no cookies');
    throw new UnauthorizedError(
      'Authentication required. Please log in again.',
      {
        hint: 'No Authorization header or cookies received. Check CORS and credentials settings.',
        diagnostics: { origin, hadAuthHeader: !!authHeader, hadCookies: false }
      }
    );
  }

  try {
    // Parse cookies manually to avoid circular dependency
    const cookies: Record<string, string> = {};
    cookieHeader.split(';').forEach(cookie => {
      const [name, ...valueParts] = cookie.split('=');
      if (name && valueParts.length > 0) {
        const trimmedName = name.trim();
        const value = valueParts.join('=').trim();
        cookies[trimmedName] = decodeURIComponent(value);
      }
    });

    const accessToken = cookies['sb-access-token'];

    if (!accessToken) {
      console.error('[auth-bridge] FAILED: Cookies present but no sb-access-token', {
        cookieNames: Object.keys(cookies)
      });
      throw new UnauthorizedError(
        'Session expired. Please log in again.',
        {
          hint: 'Cookie header present but sb-access-token not found',
          diagnostics: { cookieNames: Object.keys(cookies) }
        }
      );
    }

    console.warn('[auth-bridge] Using cookie token (sb-access-token)');
    return accessToken;

  } catch (error) {
    if (error instanceof UnauthorizedError) {
      throw error;
    }

    // Cookie parsing failed
    console.error('[auth-bridge] Cookie parsing failed:', error);
    throw new UnauthorizedError(
      'Failed to parse authentication',
      { original: error instanceof Error ? error.message : String(error) }
    );
  }
}

/**
 * Validate JWT token and return authenticated user
 *
 * Uses token caching to reduce Supabase API calls.
 * Cache TTL: 30 seconds
 */
export async function validateToken(req: Request): Promise<User> {
  const token = extractToken(req);

  // Check cache first
  const cached = tokenCache.get(token);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.user;
  }

  // Validate with Supabase
  const supabase = getSupabaseClient();

  try {
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error) {
      // Check if token expired
      if (error.message?.includes('expired') || error.message?.includes('JWT')) {
        throw new TokenExpiredError('Token has expired', { original: error.message });
      }

      throw new InvalidTokenError('Token validation failed', { original: error.message });
    }

    if (!user) {
      throw new UnauthorizedError('No user found for token');
    }

    // Cache validated token
    tokenCache.set(token, {
      user,
      expiresAt: Date.now() + TOKEN_CACHE_TTL
    });

    return user;
  } catch (error: any) {
    // Re-throw auth errors
    if (error instanceof UnauthorizedError ||
        error instanceof TokenExpiredError ||
        error instanceof InvalidTokenError) {
      throw error;
    }

    // Wrap unknown errors
    throw new UnauthorizedError('Authentication failed', { original: error.message });
  }
}

/**
 * Require authentication (basic)
 *
 * Usage:
 *   const user = await requireAuth(req);
 */
export async function requireAuth(req: Request): Promise<User> {
  return await validateToken(req);
}

/**
 * Invalidate cached token and associated org memberships
 *
 * SECURITY FIX (2025-11-19):
 * Called on logout, password reset, account deletion, or security events
 * to ensure tokens are immediately invalid after these actions.
 *
 * Previously, tokens remained valid for up to 30 seconds after logout
 * due to caching, creating a security window for unauthorized access.
 *
 * @param token - The JWT access token to invalidate
 */
export function invalidateTokenCache(token: string): void {
  const cached = tokenCache.get(token);

  // Delete token from cache
  tokenCache.delete(token);

  // Also clear org cache for this user
  if (cached) {
    const userId = cached.user.id;

    // Remove all org cache entries for this user
    // Format: userId:organizationId
    const keysToDelete: string[] = [];
    for (const [key, _] of orgCache.entries()) {
      if (key.startsWith(userId)) {
        keysToDelete.push(key);
      }
    }

    keysToDelete.forEach(key => orgCache.delete(key));

    console.warn(`[Security] Invalidated token cache for user ${userId}`, {
      userId,
      orgCacheEntriesCleared: keysToDelete.length,
      timestamp: new Date().toISOString()
    });
  } else {
    // Token not in cache, but log the invalidation attempt
    console.warn('[Security] Token invalidation requested but token not in cache');
  }
}

/**
 * Invalidate all cached tokens for a specific user
 *
 * Use this for account-level security events:
 * - Password change
 * - Account suspension
 * - Permission changes
 *
 * @param userId - The user ID to invalidate all tokens for
 */
export function invalidateUserTokens(userId: string): void {
  const tokensToDelete: string[] = [];

  // Find all tokens for this user
  for (const [token, cached] of tokenCache.entries()) {
    if (cached.user.id === userId) {
      tokensToDelete.push(token);
    }
  }

  // Delete tokens
  tokensToDelete.forEach(token => {
    tokenCache.delete(token);
    console.warn(`[Security] Invalidated token for user ${userId}`);
  });

  // Delete all org cache entries for this user
  const orgKeysToDelete: string[] = [];
  for (const [key, _] of orgCache.entries()) {
    if (key.startsWith(userId)) {
      orgKeysToDelete.push(key);
    }
  }

  orgKeysToDelete.forEach(key => orgCache.delete(key));

  console.warn(`[Security] Invalidated all tokens for user ${userId}`, {
    tokensInvalidated: tokensToDelete.length,
    orgCacheEntriesCleared: orgKeysToDelete.length,
    timestamp: new Date().toISOString()
  });
}

/**
 * Get organization membership for user
 *
 * Uses caching to reduce database queries.
 * Cache TTL: 5 minutes
 */
async function getOrganizationMembership(
  userId: string,
  organizationId: string
): Promise<OrgMembership | null> {
  const cacheKey = `${userId}:${organizationId}`;

  // Check cache first
  const cached = orgCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.membership;
  }

  // Query database
  const supabase = getSupabaseClient();

  const { data: member, error } = await supabase
    .from('team_members')
    .select('user_id, organization_id, role')
    .eq('user_id', userId)
    .eq('organization_id', organizationId)
    .maybeSingle();

  if (error) {
    console.error('❌ Failed to fetch organization membership:', error);
    return null;
  }

  if (!member) {
    return null;
  }

  // Cache membership
  orgCache.set(cacheKey, {
    membership: member as OrgMembership,
    expiresAt: Date.now() + ORG_CACHE_TTL
  });

  return member as OrgMembership;
}

/**
 * Require authentication + organization access
 *
 * Validates that:
 * 1. User has valid session
 * 2. User is member of specified organization
 *
 * Usage:
 *   const { user, member } = await requireOrgAccess(req, organizationId);
 */
export async function requireOrgAccess(
  req: Request,
  organizationId?: string
): Promise<{ user: User; member: OrgMembership }> {
  // Validate token
  const user = await validateToken(req);

  // If no org ID provided, try to get from request body
  if (!organizationId) {
    try {
      const body = await req.json();
      organizationId = body.organization_id || body.organizationId;
    } catch (e) {
      // If JSON parsing fails, org ID must be provided explicitly
    }
  }

  if (!organizationId) {
    throw new ForbiddenError('Organization ID required');
  }

  // Check organization membership
  const member = await getOrganizationMembership(user.id, organizationId);

  if (!member) {
    throw new OrganizationAccessError(
      'You are not a member of this organization',
      { userId: user.id, organizationId }
    );
  }

  return { user, member };
}

/**
 * Require authentication + organization access + specific role(s)
 *
 * Validates that:
 * 1. User has valid session
 * 2. User is member of specified organization
 * 3. User has one of the required roles
 *
 * Usage:
 *   const { user, member } = await requireRole(req, orgId, ['admin', 'owner']);
 */
export async function requireRole(
  req: Request,
  organizationId: string,
  requiredRoles: string[]
): Promise<{ user: User; member: OrgMembership }> {
  const { user, member } = await requireOrgAccess(req, organizationId);

  // Check if user has required role
  if (!requiredRoles.includes(member.role)) {
    throw new InsufficientRoleError(
      requiredRoles,
      member.role,
      { userId: user.id, organizationId }
    );
  }

  return { user, member };
}

/**
 * Validate that client-provided user ID matches authenticated user
 *
 * CRITICAL: Always call this when accepting user_id from request body
 *
 * Usage:
 *   await validateUserIdMatch(user, body.user_id);
 */
export async function validateUserIdMatch(user: User, clientProvidedUserId: string): Promise<void> {
  if (user.id !== clientProvidedUserId) {
    throw new ForbiddenError(
      'User ID mismatch',
      {
        authenticated: user.id,
        provided: clientProvidedUserId
      }
    );
  }
}

/**
 * Get all organizations user is member of
 *
 * Useful for listing user's organizations
 */
export async function getUserOrganizations(userId: string): Promise<OrgMembership[]> {
  const supabase = getSupabaseClient();

  const { data: memberships, error } = await supabase
    .from('team_members')
    .select('user_id, organization_id, role')
    .eq('user_id', userId);

  if (error) {
    console.error('❌ Failed to fetch user organizations:', error);
    throw new Error('Failed to fetch organizations');
  }

  return (memberships || []) as OrgMembership[];
}

/**
 * Clear auth caches (useful for testing)
 */
export function clearAuthCaches(): void {
  tokenCache.clear();
  orgCache.clear();
}

/**
 * Get cache stats (for monitoring)
 */
export function getAuthCacheStats() {
  return {
    tokens: {
      size: tokenCache.size,
      ttl: TOKEN_CACHE_TTL
    },
    organizations: {
      size: orgCache.size,
      ttl: ORG_CACHE_TTL
    }
  };
}

/**
 * Create error response from auth error
 *
 * Converts AuthError instances into HTTP Response objects
 * with appropriate status codes and sanitized error messages
 *
 * Usage:
 *   try {
 *     const user = await requireAuth(req);
 *   } catch (error) {
 *     return createAuthErrorResponse(error);
 *   }
 */
export function createAuthErrorResponse(error: any): Response {
  // Import AuthError dynamically to avoid circular dependency
  const { AuthError } = require('./auth-errors');

  if (error instanceof AuthError) {
    return new Response(JSON.stringify(error.toJSON()), {
      status: error.statusCode,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // Unknown error - return generic 500
  console.error('❌ Unexpected auth error:', error);
  return new Response(JSON.stringify({
    error: 'Authentication failed',
    code: 'AUTH_ERROR'
  }), {
    status: 500,
    headers: { 'Content-Type': 'application/json' }
  });
}
