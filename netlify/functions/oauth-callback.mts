import type { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import { encrypt } from './lib/encryption';
import crypto from 'crypto';
import { shouldUseNewAuth } from './lib/feature-flags';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const OAUTH_CONFIGS = {
  hubspot: {
    tokenUrl: 'https://api.hubapi.com/oauth/v1/token',
    clientId: process.env.HUBSPOT_CLIENT_ID!,
    clientSecret: process.env.HUBSPOT_CLIENT_SECRET!,
  },
};

export const handler: Handler = async (event) => {
  const provider = event.path.split('/').pop();
  const { code, state } = event.queryStringParameters || {};

  if (!code || !state || !provider) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Missing code, state, or provider' }),
    };
  }

  try {
    // SECURITY FIX: Validate state parameter to prevent tampering
    const stateData = Buffer.from(state, 'base64').toString();
    const stateParts = stateData.split('.');

    if (stateParts.length !== 2) {
      throw new Error('Invalid state format');
    }

    const [statePayload, stateSignature] = stateParts;

    // Verify HMAC signature to ensure state wasn't tampered with
    const expectedSignature = crypto
      .createHmac('sha256', process.env.ENCRYPTION_KEY || '')
      .update(statePayload)
      .digest('hex');

    if (stateSignature !== expectedSignature) {
      throw new Error('State validation failed - possible tampering detected');
    }

    // Decode state to get user_id and organization_id
    const { user_id, organization_id } = JSON.parse(statePayload);

    // SECURITY: Feature-flagged CSRF replay protection
    // Phase 4: Gradually enable OAuth state rotation
    if (shouldUseNewAuth('oauth-callback', user_id)) {
      // NEW AUTH PATH: Check for state replay attacks
      const { data: stateRecord, error: stateError } = await supabase
        .from('oauth_states')
        .select('used_at, expires_at')
        .eq('state_token', state)
        .single();

      if (stateError || !stateRecord) {
        throw new Error('Invalid or unrecognized OAuth state token');
      }

      // Check if state already used (replay attack)
      if (stateRecord.used_at) {
        console.error('🚨 CSRF REPLAY ATTACK DETECTED:', {
          state: state.substring(0, 20) + '...',
          used_at: stateRecord.used_at,
          user_id
        });
        throw new Error('OAuth state token has already been used');
      }

      // Check if state expired
      if (new Date(stateRecord.expires_at) < new Date()) {
        throw new Error('OAuth state token has expired');
      }

      // Mark state as used (prevent future replay)
      await supabase
        .from('oauth_states')
        .update({ used_at: new Date().toISOString() })
        .eq('state_token', state);
    }
    // LEGACY AUTH PATH: No replay protection (VULNERABLE - will be removed after migration)

    // Verify user is member of organization (prevent cross-org attacks)
    // MIGRATION FIX: Changed from user_workspaces to team_members (v1.7.22)
    const { data: membership, error: memberError } = await supabase
      .from('team_members')
      .select('role')
      .eq('user_id', user_id)
      .eq('organization_id', organization_id)
      .single();

    if (memberError || !membership) {
      throw new Error('User is not a member of the specified organization');
    }

    const config = OAUTH_CONFIGS[provider as keyof typeof OAUTH_CONFIGS];
    if (!config) {
      throw new Error(`Unknown provider: ${provider}`);
    }

    // Exchange code for token
    const tokenResponse = await fetch(config.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: `${process.env.URL}/.netlify/functions/oauth-callback/${provider}`,
      }),
    });

    const tokenData = await tokenResponse.json() as any;

    if (!tokenResponse.ok) {
      throw new Error(`Token exchange failed: ${JSON.stringify(tokenData)}`);
    }

    // SECURITY FIX: Encrypt tokens before storing (AES-256-GCM)
    const encryptedAccessToken = encrypt(tokenData.access_token);
    const encryptedRefreshToken = tokenData.refresh_token ? encrypt(tokenData.refresh_token) : null;

    // Store in integrations table with encrypted tokens
    await supabase.from('integrations').upsert({
      organization_id,
      provider,
      access_token: encryptedAccessToken,
      refresh_token: encryptedRefreshToken,
      expires_at: tokenData.expires_in
        ? new Date(Date.now() + tokenData.expires_in * 1000).toISOString()
        : null,
      metadata: tokenData,
      active: true,
    });

    // Redirect back to app
    return {
      statusCode: 302,
      headers: {
        Location: `${process.env.URL}/integrations?connected=${provider}`,
      },
    };
  } catch (error: any) {
    console.error('OAuth callback error:', error);
    return {
      statusCode: 302,
      headers: {
        Location: `${process.env.URL}/integrations?error=oauth_failed`,
      },
    };
  }
};
