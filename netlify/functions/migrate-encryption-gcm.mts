/**
 * Migration Function: Upgrade API Key Encryption from CBC to GCM
 * One-time migration to upgrade all existing encrypted API keys
 */
import type { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import { encrypt, decrypt, isLegacyEncryption, decryptLegacy } from './lib/encryption';
import { shouldUseNewAuth } from './lib/feature-flags';
import { requireAuth, createAuthErrorResponse } from './lib/auth-middleware';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export const handler: Handler = async (event) => {
  // SECURITY: Feature-flagged authentication migration
  // Phase 4 Batch 7: Add authentication to admin migration function
  if (shouldUseNewAuth('migrate-encryption-gcm')) {
    try {
      // NEW AUTH PATH: Require authentication for admin operations
      const authHeader = event.headers.authorization || event.headers.Authorization;
      if (!authHeader) {
        return {
          statusCode: 401,
          body: JSON.stringify({ error: 'Authentication required' })
        };
      }

      const request = new Request('https://dummy.com', {
        method: 'POST',
        headers: { 'Authorization': authHeader }
      });

      await requireAuth(request);
    } catch (authError) {
      const errorResponse = createAuthErrorResponse(authError);
      return {
        statusCode: errorResponse.status,
        body: await errorResponse.text()
      };
    }
  }
  // LEGACY AUTH PATH: No authentication (CRITICAL VULNERABILITY - admin function exposed)

  try {
    
    // Get all API keys from ai_providers table
    const { data: providers, error: fetchError } = await supabase
      .from('ai_providers')
      .select('id, organization_id, provider, api_key, encrypted')
      .eq('encrypted', true);
    
    if (fetchError) {
      console.error('Error fetching providers:', fetchError);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Failed to fetch API keys', details: fetchError.message })
      };
    }
    
    if (!providers || providers.length === 0) {
      return {
        statusCode: 200,
        body: JSON.stringify({ 
          success: true, 
          message: 'No encrypted API keys found',
          migrated: 0
        })
      };
    }
    
    
    let migrated = 0;
    let skipped = 0;
    let errors = 0;
    
    for (const provider of providers) {
      try {
        // Check if already using GCM format
        if (!isLegacyEncryption(provider.api_key)) {
          skipped++;
          continue;
        }
        
        
        // Decrypt using old CBC method
        const plaintext = decryptLegacy(provider.api_key);
        
        // Re-encrypt using new GCM method
        const newEncrypted = encrypt(plaintext);
        
        // Update in database
        const { error: updateError } = await supabase
          .from('ai_providers')
          .update({ api_key: newEncrypted, updated_at: new Date().toISOString() })
          .eq('id', provider.id);
        
        if (updateError) {
          console.error(`Error updating provider ${provider.id}:`, updateError);
          errors++;
          continue;
        }
        
        migrated++;
        
      } catch (error: any) {
        console.error(`Error migrating provider ${provider.id}:`, error);
        errors++;
      }
    }
    
    const summary = {
      success: true,
      total: providers.length,
      migrated,
      skipped,
      errors,
      message: `Migration complete: ${migrated} migrated, ${skipped} skipped, ${errors} errors`
    };
    
    
    return {
      statusCode: 200,
      body: JSON.stringify(summary)
    };
    
  } catch (error: any) {
    console.error('Migration failed:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        error: 'Migration failed', 
        details: error.message 
      })
    };
  }
};
