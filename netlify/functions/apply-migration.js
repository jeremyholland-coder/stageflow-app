/**
 * Netlify Function: Apply Database Migration
 * Executes SQL migration via Supabase Management API
 *
 * SECURITY: Requires admin authentication
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { requireAuth } from './lib/auth-middleware';
import { buildCorsHeaders } from './lib/cors';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Sanitize error messages to prevent leaking internal details
 */
function sanitizeError(error) {
  const message = error?.message || String(error);
  // Remove database paths, SQL details, connection strings
  const sanitized = message
    .replace(/postgresql?:\/\/[^\s]+/gi, '[DATABASE_URL]')
    .replace(/supabase\.co[^\s]*/gi, '[SUPABASE_URL]')
    .replace(/relation "[^"]+"/gi, 'relation "[TABLE]"')
    .replace(/column "[^"]+"/gi, 'column "[COLUMN]"')
    .replace(/function "[^"]+"/gi, 'function "[FUNCTION]"')
    .replace(/at position \d+/gi, 'at position [N]')
    .replace(/line \d+/gi, 'line [N]');
  return sanitized;
}

export default async (req, context) => {
  const headers = buildCorsHeaders(req);

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers });
  }

  // Only allow POST requests
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...headers, 'Content-Type': 'application/json' }
    });
  }

  // SECURITY FIX: Require authentication
  const authResult = await requireAuth(req, { requireAdmin: true });
  if (!authResult.authenticated) {
    return new Response(JSON.stringify({
      success: false,
      error: authResult.error || 'Authentication required'
    }), {
      status: authResult.status || 401,
      headers: { ...headers, 'Content-Type': 'application/json' }
    });
  }

  try {
    // Read the migration file
    const migrationPath = path.resolve(__dirname, '../../database/migrations/fix_mobile_organization_setup.sql');
    const sql = fs.readFileSync(migrationPath, 'utf8');

    console.log('📄 Migration file loaded:', path.basename(migrationPath));
    console.log('📊 SQL length:', sql.length, 'characters');

    // Get Supabase credentials from environment
    const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Missing Supabase credentials');
    }

    // Extract project ref from URL (e.g., https://abcdefgh.supabase.co -> abcdefgh)
    const projectRef = supabaseUrl.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1];

    if (!projectRef) {
      throw new Error('Invalid Supabase URL format');
    }

    console.log('🔧 Applying migration to project:', projectRef);

    // Use Supabase Management API to execute SQL
    // Note: This requires the service role key with sufficient permissions
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/exec`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': supabaseServiceKey,
        'Authorization': `Bearer ${supabaseServiceKey}`,
        'Prefer': 'return=representation'
      },
      body: JSON.stringify({ query: sql })
    });

    if (!response.ok) {
      const errorText = await response.text();
      // Log full error internally (server-side only)
      console.error('❌ Supabase API error:', errorText);

      // SECURITY: Don't expose internal error details to client
      throw new Error(`Migration failed with status ${response.status}`);
    }

    const result = await response.json();

    console.log('✅ Migration applied successfully');

    return new Response(JSON.stringify({
      success: true,
      message: 'Migration applied successfully',
      details: {
        migration: 'fix_mobile_organization_setup.sql',
        function: 'setup_organization_atomic',
        timestamp: new Date().toISOString()
      },
      result
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    // Log full error internally
    console.error('❌ Migration failed:', error);

    // SECURITY: Sanitize error message before sending to client
    return new Response(JSON.stringify({
      success: false,
      error: sanitizeError(error),
      details: {
        migration: 'fix_mobile_organization_setup.sql',
        timestamp: new Date().toISOString()
      }
    }), {
      status: 500,
      headers: { ...headers, 'Content-Type': 'application/json' }
    });
  }
};

export const config = {
  path: "/api/apply-migration"
};
