/**
 * Run Database Migration
 * POST with { migrationName: "20251114_team_assignment_system" }
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { join } from 'path';
import { shouldUseNewAuth } from './lib/feature-flags';
import { requireAuth, createAuthErrorResponse } from './lib/auth-middleware';

export const handler = async (event: any) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  // SECURITY: Feature-flagged authentication migration
  // Phase 4 Batch 7: Add authentication to CRITICAL SQL execution function
  if (shouldUseNewAuth('run-migration')) {
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
  // LEGACY AUTH PATH: No authentication (CRITICAL VULNERABILITY - SQL execution exposed!)

  try {
    const { migrationName } = JSON.parse(event.body || '{}');

    if (!migrationName) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'migrationName required' })
      };
    }

    const supabaseUrl = process.env.VITE_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Missing Supabase credentials');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    console.log('[Migration] Running migration:', migrationName);

    // Read migration file
    const migrationPath = join(process.cwd(), 'supabase', 'migrations', `${migrationName}.sql`);
    let sqlContent: string;

    try {
      sqlContent = readFileSync(migrationPath, 'utf-8');
    } catch (err: any) {
      return {
        statusCode: 404,
        body: JSON.stringify({
          error: 'Migration file not found',
          path: migrationPath,
          details: err.message
        })
      };
    }

    // Execute the SQL
    const { data, error } = await supabase.rpc('exec_sql', {
      sql_query: sqlContent
    });

    if (error) {
      // Try direct SQL execution if exec_sql doesn't exist
      console.log('[Migration] Trying direct SQL execution...');

      // Split SQL into individual statements
      const statements = sqlContent
        .split(';')
        .map(s => s.trim())
        .filter(s => s.length > 0 && !s.startsWith('--') && !s.startsWith('/*'));

      console.log(`[Migration] Executing ${statements.length} SQL statements...`);

      const results = [];
      for (let i = 0; i < statements.length; i++) {
        const stmt = statements[i];
        try {
          // Use raw SQL via PostgREST
          const response = await fetch(`${supabaseUrl}/rest/v1/rpc/exec`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'apikey': supabaseServiceKey,
              'Authorization': `Bearer ${supabaseServiceKey}`
            },
            body: JSON.stringify({ query: stmt })
          });

          if (!response.ok) {
            console.error(`[Migration] Statement ${i + 1} failed:`, stmt.substring(0, 100));
          } else {
            results.push({ success: true, statement: i + 1 });
          }
        } catch (err: any) {
          console.error(`[Migration] Error on statement ${i + 1}:`, err.message);
          results.push({ success: false, statement: i + 1, error: err.message });
        }
      }

      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: true,
          message: `Migration ${migrationName} executed`,
          statementsExecuted: statements.length,
          results: results.filter(r => !r.success) // Only show failures
        })
      };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        message: `Migration ${migrationName} completed successfully`,
        data
      })
    };

  } catch (error: any) {
    console.error('[Migration] Error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Migration failed',
        details: error.message
      })
    };
  }
};
