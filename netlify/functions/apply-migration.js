/**
 * Netlify Function: Apply Database Migration
 * Executes SQL migration via Supabase Management API
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default async (req, context) => {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' }
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
      const error = await response.text();
      console.error('❌ Supabase API error:', error);

      // If RPC exec doesn't exist, we need to use a different approach
      // Let's try using the pg library through a database connection
      throw new Error(`Supabase API returned ${response.status}: ${error}`);
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
    console.error('❌ Migration failed:', error);

    return new Response(JSON.stringify({
      success: false,
      error: error.message,
      details: {
        migration: 'fix_mobile_organization_setup.sql',
        timestamp: new Date().toISOString()
      }
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};

export const config = {
  path: "/api/apply-migration"
};
