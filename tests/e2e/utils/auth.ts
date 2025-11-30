/**
 * E2E Test Authentication Utilities
 *
 * Provides helpers for authenticating test requests against
 * Netlify functions using Supabase auth.
 */

import { createClient, SupabaseClient, User } from '@supabase/supabase-js';

// Test user credentials (set via environment or use defaults)
const TEST_USER_EMAIL = process.env.TEST_USER_EMAIL || 'stageflow.test+qa@example.com';
const TEST_USER_PASSWORD = process.env.TEST_USER_PASSWORD || 'TestPassword123!';

// Singleton supabase client
let supabase: SupabaseClient | null = null;

// Cached auth state
let cachedAccessToken: string | null = null;
let cachedUser: User | null = null;

/**
 * Get configured Supabase client
 */
export function getSupabaseClient(): SupabaseClient {
  if (!supabase) {
    const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

    if (!url || !anonKey) {
      throw new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY');
    }

    supabase = createClient(url, anonKey);
  }
  return supabase;
}

/**
 * Sign in test user and get access token
 *
 * Uses cached token if available and not expired.
 */
export async function getTestUserAuth(): Promise<{
  accessToken: string;
  user: User;
  organizationId: string;
}> {
  // Return cached if available
  if (cachedAccessToken && cachedUser) {
    // Verify token is still valid
    const client = getSupabaseClient();
    const { data: { user }, error } = await client.auth.getUser(cachedAccessToken);

    if (!error && user) {
      // Get organization ID
      const orgId = await getTestUserOrganization(cachedAccessToken);
      return {
        accessToken: cachedAccessToken,
        user: cachedUser,
        organizationId: orgId
      };
    }
  }

  // Sign in fresh
  const client = getSupabaseClient();

  const { data, error } = await client.auth.signInWithPassword({
    email: TEST_USER_EMAIL,
    password: TEST_USER_PASSWORD
  });

  if (error) {
    throw new Error(`Test user sign-in failed: ${error.message}. ` +
      `Ensure test user exists: ${TEST_USER_EMAIL}`);
  }

  if (!data.session || !data.user) {
    throw new Error('Sign-in succeeded but no session returned');
  }

  // Cache for reuse
  cachedAccessToken = data.session.access_token;
  cachedUser = data.user;

  // Get organization ID
  const orgId = await getTestUserOrganization(cachedAccessToken);

  console.log(`✓ Authenticated as: ${data.user.email}`);
  console.log(`✓ Organization ID: ${orgId}`);

  return {
    accessToken: data.session.access_token,
    user: data.user,
    organizationId: orgId
  };
}

/**
 * Get organization ID for test user
 */
async function getTestUserOrganization(accessToken: string): Promise<string> {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY for org lookup');
  }

  // Use service role to query team_members
  const serviceClient = createClient(url, serviceKey);

  // First get user ID from token
  const { data: { user }, error: userError } = await serviceClient.auth.getUser(accessToken);

  if (userError || !user) {
    throw new Error('Could not get user from token');
  }

  // Get organization membership
  const { data: membership, error: memberError } = await serviceClient
    .from('team_members')
    .select('organization_id')
    .eq('user_id', user.id)
    .single();

  if (memberError || !membership) {
    throw new Error(`Test user has no organization membership: ${memberError?.message}`);
  }

  return membership.organization_id;
}

/**
 * Get headers for authenticated requests
 */
export function getAuthHeaders(accessToken: string): Record<string, string> {
  return {
    'Authorization': `Bearer ${accessToken}`,
    'Content-Type': 'application/json'
  };
}

/**
 * Clear cached auth (use between test suites if needed)
 */
export function clearAuthCache(): void {
  cachedAccessToken = null;
  cachedUser = null;
}
