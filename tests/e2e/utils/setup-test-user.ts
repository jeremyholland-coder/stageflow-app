/**
 * Test User Setup Script
 *
 * Creates or verifies a test user in Supabase for e2e testing.
 *
 * Run with: npx ts-node tests/e2e/utils/setup-test-user.ts
 *
 * Prerequisites:
 * - SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set
 * - Run via `netlify dev` to have env vars available
 */

import { createClient } from '@supabase/supabase-js';

const TEST_USER_EMAIL = process.env.TEST_USER_EMAIL || 'stageflow.test+qa@example.com';
const TEST_USER_PASSWORD = process.env.TEST_USER_PASSWORD || 'TestPassword123!';
const TEST_ORG_NAME = 'E2E Test Organization';

async function setupTestUser() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    console.error('Run this script via: netlify dev --command "npx ts-node tests/e2e/utils/setup-test-user.ts"');
    process.exit(1);
  }

  const supabase = createClient(url, serviceKey);

  console.log('Setting up test user:', TEST_USER_EMAIL);

  // 1. Check if user exists
  const { data: existingUsers, error: listError } = await supabase.auth.admin.listUsers();

  if (listError) {
    console.error('Failed to list users:', listError);
    process.exit(1);
  }

  let userId: string;
  const existing = existingUsers.users.find(u => u.email === TEST_USER_EMAIL);

  if (existing) {
    console.log('✓ Test user already exists:', existing.id);
    userId = existing.id;
  } else {
    // Create the user
    const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
      email: TEST_USER_EMAIL,
      password: TEST_USER_PASSWORD,
      email_confirm: true
    });

    if (createError || !newUser.user) {
      console.error('Failed to create test user:', createError);
      process.exit(1);
    }

    console.log('✓ Created test user:', newUser.user.id);
    userId = newUser.user.id;
  }

  // 2. Check if organization exists
  const { data: orgs, error: orgError } = await supabase
    .from('organizations')
    .select('id')
    .eq('name', TEST_ORG_NAME)
    .maybeSingle();

  let orgId: string;

  if (orgs) {
    console.log('✓ Test organization already exists:', orgs.id);
    orgId = orgs.id;
  } else {
    // Create organization
    const { data: newOrg, error: createOrgError } = await supabase
      .from('organizations')
      .insert({ name: TEST_ORG_NAME })
      .select()
      .single();

    if (createOrgError || !newOrg) {
      console.error('Failed to create test organization:', createOrgError);
      process.exit(1);
    }

    console.log('✓ Created test organization:', newOrg.id);
    orgId = newOrg.id;
  }

  // 3. Check if user is member of org
  const { data: membership, error: memberError } = await supabase
    .from('team_members')
    .select('*')
    .eq('user_id', userId)
    .eq('organization_id', orgId)
    .maybeSingle();

  if (membership) {
    console.log('✓ User already member of organization');
  } else {
    // Add user to organization
    const { error: addMemberError } = await supabase
      .from('team_members')
      .insert({
        user_id: userId,
        organization_id: orgId,
        role: 'owner'
      });

    if (addMemberError) {
      console.error('Failed to add user to organization:', addMemberError);
      process.exit(1);
    }

    console.log('✓ Added user to organization as owner');
  }

  // 4. Create profile if not exists
  const { error: profileError } = await supabase
    .from('profiles')
    .upsert({
      id: userId,
      email: TEST_USER_EMAIL,
      first_name: 'Test',
      last_name: 'User'
    });

  if (profileError) {
    console.warn('Profile upsert warning:', profileError);
  } else {
    console.log('✓ Profile created/updated');
  }

  console.log('\n=== Test User Setup Complete ===');
  console.log('Email:', TEST_USER_EMAIL);
  console.log('Password:', TEST_USER_PASSWORD);
  console.log('User ID:', userId);
  console.log('Organization ID:', orgId);
  console.log('\nYou can now run: npm run test:integration');
}

setupTestUser().catch(console.error);
