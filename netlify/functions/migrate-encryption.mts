import type { Context, Config } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";
import { encrypt, decrypt } from "./lib/encryption";
import { shouldUseNewAuth } from './lib/feature-flags';
import { requireAuth, createAuthErrorResponse } from './lib/auth-middleware';

/**
 * ONE-TIME MIGRATION SCRIPT
 * Encrypts all existing API keys in ai_providers table
 * Run this once, then disable this function
 */
export default async (req: Request, context: Context) => {
  // Security: Only allow POST from admin
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  // SECURITY: Feature-flagged authentication migration
  // Phase 4 Batch 7: Migrate from admin secret to centralized auth
  if (shouldUseNewAuth('migrate-encryption')) {
    try {
      // NEW AUTH PATH: Use centralized authentication
      await requireAuth(req);
    } catch (authError) {
      return createAuthErrorResponse(authError);
    }
  } else {
    // LEGACY AUTH PATH: Admin secret header
    const adminSecret = req.headers.get('x-admin-secret');
    if (adminSecret !== process.env.ADMIN_SECRET) {
      return new Response('Unauthorized', { status: 401 });
    }
  }

  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  try {
    // Fetch all API keys
    const { data: providers, error: fetchError } = await supabase
      .from('ai_providers')
      .select('*');

    if (fetchError) throw fetchError;

    if (!providers || providers.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        message: 'No API keys to migrate'
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }


    const results = {
      total: providers.length,
      encrypted: 0,
      alreadyEncrypted: 0,
      errors: [] as any[]
    };

    // Migrate each key
    for (const provider of providers) {
      try {
        const currentKey = provider.api_key_encrypted;

        // Check if already encrypted (contains colons)
        if (currentKey.includes(':')) {
          results.alreadyEncrypted++;
          continue;
        }

        // Encrypt the plaintext key
        const encryptedKey = encrypt(currentKey);

        // Update in database
        const { error: updateError } = await supabase
          .from('ai_providers')
          .update({ api_key_encrypted: encryptedKey })
          .eq('id', provider.id);

        if (updateError) {
          throw updateError;
        }

        // Verify we can decrypt it
        const decrypted = decrypt(encryptedKey);
        if (decrypted !== currentKey) {
          throw new Error('Decryption verification failed');
        }

        results.encrypted++;

      } catch (error: any) {
        console.error(`❌ Failed to encrypt provider ${provider.id}:`, error);
        results.errors.push({
          provider_id: provider.id,
          error: error.message
        });
      }
    }


    return new Response(JSON.stringify({
      success: results.errors.length === 0,
      results
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error: any) {
    console.error('Migration error:', error);
    return new Response(JSON.stringify({
      error: 'Migration failed',
      details: error.message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};

export const config: Config = {
  path: "/api/migrate-encryption"
};
