/**
 * One-time fix for mobile organization setup
 * Recreates the setup_organization_atomic function without the updated_at column
 */

import { createClient } from '@supabase/supabase-js';

export default async (req, context) => {
  try {
    const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Missing Supabase credentials');
    }

    // Create admin client
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });

    console.warn('🔧 Attempting to fix mobile organization setup...');

    // The fix: We need to recreate the setup_organization_atomic function
    // Since we can't execute arbitrary SQL via the Supabase JS client,
    // we'll return the SQL that needs to be executed manually

    const migrationSQL = `
-- =====================================================
-- FIX: Mobile Organization Setup - Remove updated_at column
-- Issue: user_workspaces table doesn't have updated_at column
-- =====================================================

CREATE OR REPLACE FUNCTION setup_organization_atomic(
  p_user_id UUID,
  p_email TEXT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_org_id UUID;
  v_role TEXT;
  v_existing_org_id UUID;
  v_org_name TEXT;
BEGIN
  -- Check if user already belongs to an organization
  -- MIGRATION FIX: Changed from user_workspaces to team_members (v1.7.22)
  SELECT organization_id, role INTO v_existing_org_id, v_role
  FROM team_members
  WHERE user_id = p_user_id
  LIMIT 1;

  IF v_existing_org_id IS NOT NULL THEN
    -- User already has an organization
    RETURN json_build_object(
      'organization_id', v_existing_org_id,
      'role', v_role
    );
  END IF;

  -- Generate organization name from email
  v_org_name := COALESCE(SPLIT_PART(p_email, '@', 1), 'user') || '''s Organization';

  -- Create new organization
  INSERT INTO organizations (name, plan, created_at, updated_at)
  VALUES (
    v_org_name,
    'free',
    NOW(),
    NOW()
  )
  RETURNING id INTO v_org_id;

  -- Add user to workspace as owner
  -- FIX: Removed updated_at column - it doesn't exist in team_members table schema
  -- MIGRATION FIX: Changed from user_workspaces to team_members (v1.7.22)
  INSERT INTO team_members (user_id, organization_id, role, created_at)
  VALUES (p_user_id, v_org_id, 'owner', NOW());

  -- Create default notification preferences (if table exists)
  BEGIN
    INSERT INTO notification_preferences (
      user_id,
      organization_id,
      all_notifications,
      notify_deal_created,
      notify_stage_changed,
      notify_deal_won,
      notify_deal_lost,
      weekly_digest,
      created_at,
      updated_at
    )
    VALUES (
      p_user_id,
      v_org_id,
      true,
      true,
      true,
      true,
      false,
      false,
      NOW(),
      NOW()
    );
  EXCEPTION
    WHEN undefined_table THEN
      -- Table doesn't exist yet, skip notification preferences
      NULL;
  END;

  RETURN json_build_object(
    'organization_id', v_org_id,
    'role', 'owner'
  );
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION setup_organization_atomic(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION setup_organization_atomic(UUID, TEXT) TO service_role;
`;

    return new Response(JSON.stringify({
      success: false,
      requiresManualApplication: true,
      message: 'This migration requires manual application via Supabase SQL Editor',
      instructions: [
        '1. Go to your Supabase Dashboard',
        '2. Navigate to SQL Editor',
        '3. Copy and paste the SQL provided below',
        '4. Click "Run" to execute the migration'
      ],
      sql: migrationSQL,
      supabaseUrl: supabaseUrl
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('❌ Error:', error);

    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};

export const config = {
  path: "/api/fix-mobile-setup"
};
