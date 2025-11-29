import type { Handler } from "@netlify/functions";
import { createClient } from '@supabase/supabase-js';
import { shouldUseNewAuth } from './lib/feature-flags';
import { requireAuth, createAuthErrorResponse } from './lib/auth-middleware';

const handler: Handler = async (event) => {
  // SECURITY: Feature-flagged authentication migration
  // Phase 4 Batch 7: Add authentication to admin reporting function
  if (shouldUseNewAuth('get-new-users')) {
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
        method: 'GET',
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
    const supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Calculate yesterday's date range (PST timezone)
    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);

    const yesterdayEnd = new Date(yesterday);
    yesterdayEnd.setHours(23, 59, 59, 999);

    // Get users created yesterday from auth.users (using admin API)
    const { data: authData, error: listError } = await supabase.auth.admin.listUsers();

    if (listError) throw listError;

    const allUsers = authData.users || [];

    // Filter for yesterday's signups
    const yesterdayUsers = allUsers.filter(user => {
      const createdAt = new Date(user.created_at);
      return createdAt >= yesterday && createdAt <= yesterdayEnd;
    });

    // Get users from last 7 days for context
    const weekAgo = new Date(now);
    weekAgo.setDate(weekAgo.getDate() - 7);

    const weekUsers = allUsers.filter(user => {
      const createdAt = new Date(user.created_at);
      return createdAt >= weekAgo;
    });

    const totalUsers = allUsers.length;

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        yesterday: {
          count: yesterdayUsers.length,
          users: yesterdayUsers.map(u => ({
            id: u.id,
            email: u.email,
            created_at: u.created_at,
            email_confirmed: u.email_confirmed_at ? true : false
          })),
          date: yesterday.toLocaleDateString('en-US', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            timeZone: 'America/Los_Angeles'
          })
        },
        stats: {
          totalUsers,
          last7Days: weekUsers.length,
          growthRate: weekUsers.length && totalUsers ? ((weekUsers.length / totalUsers) * 100).toFixed(1) + '%' : 'N/A'
        }
      }, null, 2)
    };

  } catch (error) {
    console.error('Error fetching new users:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        error: 'Failed to fetch users',
        details: error instanceof Error ? error.message : 'Unknown error'
      }, null, 2)
    };
  }
};

export { handler };
