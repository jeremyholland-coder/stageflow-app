/**
 * Setup Demo Team - Create full team with seats and deal assignments
 *
 * This function:
 * 1. Upgrades organization to top-tier plan (20 seats)
 * 2. Creates team members across different roles
 * 3. Distributes deals across team members realistically
 * 4. Sets up team hierarchy and assignments
 *
 * Usage: POST to /.netlify/functions/setup-demo-team
 * Body: { "email": "stageflow@startupstage.com" }
 */

import { createClient } from '@supabase/supabase-js';
import { shouldUseNewAuth } from './lib/feature-flags';
import { requireAuth, createAuthErrorResponse } from './lib/auth-middleware';

export const handler = async (event: any) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const { email } = JSON.parse(event.body || '{}');

    if (!email) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Email required' })
      };
    }

    // SECURITY: Feature-flagged authentication migration
    // Phase 4 Batch 4: Add authentication to admin demo setup function
    if (shouldUseNewAuth('setup-demo-team')) {
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

        // Admin operation authenticated
      } catch (authError) {
        const errorResponse = createAuthErrorResponse(authError);
        return {
          statusCode: errorResponse.status,
          body: await errorResponse.text()
        };
      }
    }
    // LEGACY AUTH PATH: No authentication (CRITICAL VULNERABILITY - admin function exposed)

    const supabaseUrl = process.env.VITE_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Missing Supabase credentials');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    console.log('[DemoTeam] Setting up demo team for:', email);

    // 1. Find user and organization
    const { data: authUsers, error: userError } = await supabase.auth.admin.listUsers();

    if (userError) {
      throw new Error(`Failed to fetch users: ${userError.message}`);
    }

    const mainUser = authUsers.users.find(u => u.email === email);

    if (!mainUser) {
      throw new Error(`User not found: ${email}`);
    }

    // MIGRATION FIX: Changed from user_workspaces to team_members (v1.7.22)
    const { data: workspace, error: workspaceError } = await supabase
      .from('team_members')
      .select('organization_id, role')
      .eq('user_id', mainUser.id)
      .single();

    if (workspaceError || !workspace) {
      throw new Error('Organization not found for user');
    }

    const orgId = workspace.organization_id;
    console.log('[DemoTeam] Found organization:', orgId);

    // 2. Upgrade organization to top-tier plan
    const { error: orgUpdateError } = await supabase
      .from('organizations')
      .update({
        subscription_tier: 'enterprise',
        max_seats: 20,
        subscription_status: 'active'
      })
      .eq('id', orgId);

    if (orgUpdateError) {
      console.error('[DemoTeam] Failed to update organization:', orgUpdateError);
    } else {
      console.log('[DemoTeam] ✓ Upgraded to Enterprise plan (20 seats)');
    }

    // 3. Define team structure
    const teamMembers = [
      // Executives (2)
      { email: 'ceo@startupstage.com', name: 'Sarah Chen', role: 'owner', title: 'CEO', dealShare: 0.05 },
      { email: 'cro@startupstage.com', name: 'Michael Rodriguez', role: 'admin', title: 'Chief Revenue Officer', dealShare: 0.08 },

      // Sales Leadership (3)
      { email: 'vp.sales@startupstage.com', name: 'Jennifer Williams', role: 'admin', title: 'VP of Sales', dealShare: 0.10 },
      { email: 'sales.director@startupstage.com', name: 'David Kim', role: 'admin', title: 'Sales Director', dealShare: 0.12 },
      { email: 'sales.manager@startupstage.com', name: 'Amanda Foster', role: 'member', title: 'Sales Manager', dealShare: 0.15 },

      // Account Executives (8) - The heavy lifters
      { email: 'ae1@startupstage.com', name: 'Robert Johnson', role: 'member', title: 'Senior Account Executive', dealShare: 0.08 },
      { email: 'ae2@startupstage.com', name: 'Emily Davis', role: 'member', title: 'Senior Account Executive', dealShare: 0.07 },
      { email: 'ae3@startupstage.com', name: 'James Wilson', role: 'member', title: 'Account Executive', dealShare: 0.06 },
      { email: 'ae4@startupstage.com', name: 'Lisa Martinez', role: 'member', title: 'Account Executive', dealShare: 0.06 },
      { email: 'ae5@startupstage.com', name: 'Christopher Lee', role: 'member', title: 'Account Executive', dealShare: 0.05 },
      { email: 'ae6@startupstage.com', name: 'Jessica Taylor', role: 'member', title: 'Account Executive', dealShare: 0.05 },
      { email: 'ae7@startupstage.com', name: 'Daniel Anderson', role: 'member', title: 'Junior Account Executive', dealShare: 0.04 },
      { email: 'ae8@startupstage.com', name: 'Olivia Thomas', role: 'member', title: 'Junior Account Executive', dealShare: 0.04 },

      // Sales Development Reps (4)
      { email: 'sdr1@startupstage.com', name: 'Matthew Garcia', role: 'member', title: 'Senior SDR', dealShare: 0.02 },
      { email: 'sdr2@startupstage.com', name: 'Sophia White', role: 'member', title: 'SDR', dealShare: 0.02 },
      { email: 'sdr3@startupstage.com', name: 'Ethan Harris', role: 'member', title: 'SDR', dealShare: 0.01 },
      { email: 'sdr4@startupstage.com', name: 'Isabella Clark', role: 'member', title: 'SDR', dealShare: 0.01 },

      // Support/Operations (3)
      { email: 'sales.ops@startupstage.com', name: 'Andrew Lewis', role: 'member', title: 'Sales Operations Manager', dealShare: 0 },
      { email: 'customer.success@startupstage.com', name: 'Maria Robinson', role: 'member', title: 'Customer Success Manager', dealShare: 0 },
      { email: 'sales.analyst@startupstage.com', name: 'Kevin Walker', role: 'member', title: 'Sales Analyst', dealShare: 0 }
    ];

    console.log('[DemoTeam] Creating', teamMembers.length, 'team members...');

    // 4. Check which users already exist
    const existingUsers = authUsers.users.filter(u =>
      teamMembers.some(tm => tm.email === u.email)
    );

    console.log('[DemoTeam] Found', existingUsers.length, 'existing users');

    // 5. Create missing auth users
    let createdUsers = 0;
    const allUsers = [...authUsers.users];

    for (const member of teamMembers) {
      let user = authUsers.users.find(u => u.email === member.email);

      if (!user) {
        console.log(`[DemoTeam] Creating auth user for ${member.email}...`);

        const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
          email: member.email,
          email_confirm: true,
          password: 'DemoPassword123!',
          user_metadata: {
            full_name: member.name,
            role: member.title
          }
        });

        if (createError) {
          console.error(`[DemoTeam] Failed to create user ${member.email}:`, createError.message);
        } else if (newUser.user) {
          user = newUser.user;
          allUsers.push(user);
          createdUsers++;
          console.log(`[DemoTeam] ✓ Created ${member.name}`);

          // Add to user_profiles for fast lookups
          await supabase.from('user_profiles').insert({
            id: user.id,
            email: member.email,
            full_name: member.name,
            role_title: member.title
          }).then(() => {
            console.log(`[DemoTeam] ✓ Created profile for ${member.name}`);
          });
        }
      }
    }

    console.log('[DemoTeam] Created', createdUsers, 'new auth users');

    // 6. Create workspace entries for all team members
    let workspaceCount = 0;
    for (const member of teamMembers) {
      const user = allUsers.find(u => u.email === member.email);

      if (user) {
        // Check if workspace already exists
        // MIGRATION FIX: Changed from user_workspaces to team_members (v1.7.22)
        const { data: existingWorkspace } = await supabase
          .from('team_members')
          .select('id')
          .eq('user_id', user.id)
          .eq('organization_id', orgId)
          .single();

        if (!existingWorkspace) {
          const { error: workspaceError } = await supabase
            .from('team_members')
            .insert({
              user_id: user.id,
              organization_id: orgId,
              role: member.role
            });

          if (!workspaceError) {
            workspaceCount++;
            console.log(`[DemoTeam] ✓ Added workspace for ${member.name}`);
          }
        }
      } else {
        console.log(`[DemoTeam] ⚠ User still not found: ${member.email} - skipping`);
      }
    }

    console.log('[DemoTeam] Created', workspaceCount, 'new workspace entries');

    // 6. Get all deals for this organization
    const { data: allDeals, error: dealsError } = await supabase
      .from('deals')
      .select('*')
      .eq('organization_id', orgId)
      .limit(1);

    // Log available columns for debugging
    if (allDeals && allDeals.length > 0) {
      console.log('[DemoTeam] Available columns:', Object.keys(allDeals[0]));
    }

    // Get all deals
    const { data: allDealsComplete, error: dealsCompleteError } = await supabase
      .from('deals')
      .select('*')
      .eq('organization_id', orgId);

    if (dealsCompleteError) {
      console.error('[DemoTeam] Deals fetch error:', dealsCompleteError);
      throw new Error(`Failed to fetch deals: ${dealsCompleteError.message}`);
    }

    if (!allDealsComplete || allDealsComplete.length === 0) {
      console.warn('[DemoTeam] No deals found for organization');
      // Continue anyway - we can still set up the team
    }

    const allDealsData = allDealsComplete || [];
    console.log('[DemoTeam] Found', allDealsData.length, 'deals to assign');

    // 7. Distribute deals across team members
    let assignedCount = 0;
    const activeDeals = allDealsData.filter(d => d.status === 'active');
    const wonDeals = allDealsData.filter(d => d.status === 'won');
    const lostDeals = allDealsData.filter(d => d.status === 'lost');

    // Helper to assign deals to a user based on their share
    const assignDeals = async (deals: any[], teamMembers: any[]) => {
      let currentIndex = 0;
      const dealUpdates = [];

      for (const member of teamMembers) {
        if (member.dealShare === 0) continue; // Skip non-sales roles

        const user = allUsers.find(u => u.email === member.email);
        if (!user) continue;

        const count = Math.floor(deals.length * member.dealShare);

        for (let i = 0; i < count && currentIndex < deals.length; i++) {
          const deal = deals[currentIndex];

          // Assign deal to this team member
          dealUpdates.push(
            supabase
              .from('deals')
              .update({
                assigned_to: user.id,
                assigned_by: mainUser.id,
                assigned_at: new Date().toISOString()
              })
              .eq('id', deal.id)
          );

          assignedCount++;
          currentIndex++;
        }
      }

      // Assign remaining deals to top performers
      while (currentIndex < deals.length) {
        const topPerformers = teamMembers.filter(m => m.dealShare >= 0.06);
        const randomPerformer = topPerformers[Math.floor(Math.random() * topPerformers.length)];
        const user = allUsers.find(u => u.email === randomPerformer.email);

        if (user) {
          const deal = deals[currentIndex];
          dealUpdates.push(
            supabase
              .from('deals')
              .update({
                assigned_to: user.id,
                assigned_by: mainUser.id,
                assigned_at: new Date().toISOString()
              })
              .eq('id', deal.id)
          );
          assignedCount++;
        }

        currentIndex++;
      }

      // Execute all assignments in batch
      if (dealUpdates.length > 0) {
        console.log(`[DemoTeam] Executing ${dealUpdates.length} deal assignments...`);
        await Promise.all(dealUpdates);
      }
    };

    // Assign active deals
    await assignDeals(activeDeals, teamMembers);

    // Assign won deals (favor senior reps)
    await assignDeals(wonDeals, teamMembers.filter(m => m.title.includes('Senior') || m.title.includes('Director') || m.title.includes('VP')));

    // Assign lost deals (spread across all)
    await assignDeals(lostDeals, teamMembers);

    console.log('[DemoTeam] Assigned', assignedCount, 'deals to team members');

    // 8. Get final statistics from actual assignments
    const teamStats = await Promise.all(
      teamMembers.map(async (member) => {
        const user = allUsers.find(u => u.email === member.email);
        if (!user) return null;

        // Get actual assigned deals
        const { data: assignedDeals } = await supabase
          .from('deals')
          .select('id, value, status')
          .eq('organization_id', orgId)
          .eq('assigned_to', user.id);

        const deals = assignedDeals || [];
        const totalValue = deals.reduce((sum, d) => sum + (d.value || 0), 0);
        const wonDeals = deals.filter(d => d.status === 'won').length;
        const activeDeals = deals.filter(d => d.status === 'active').length;

        return {
          name: member.name,
          title: member.title,
          role: member.role,
          email: member.email,
          dealCount: deals.length,
          activeDeals,
          wonDeals,
          totalValue,
          avgDealSize: deals.length > 0 ? Math.round(totalValue / deals.length) : 0
        };
      })
    );

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        message: `Demo team setup complete for ${email}`,
        stats: {
          organizationId: orgId,
          subscriptionTier: 'enterprise',
          maxSeats: 20,
          teamSize: teamMembers.length,
          workspacesCreated: workspaceCount,
          totalDeals: allDealsData.length,
          dealsAssigned: assignedCount,
          teamMembers: teamStats.filter(Boolean)
        }
      }, null, 2)
    };

  } catch (error: any) {
    console.error('[DemoTeam] Error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Failed to setup demo team',
        details: error.message
      })
    };
  }
};
