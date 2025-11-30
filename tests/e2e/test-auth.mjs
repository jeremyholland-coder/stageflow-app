/**
 * Quick test script to verify auth works
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

async function test() {
  console.log('URL:', SUPABASE_URL ? 'Set' : 'Missing');
  console.log('Key:', SUPABASE_ANON_KEY ? 'Set' : 'Missing');

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  console.log('\nSigning in as test user...');
  const { data, error } = await supabase.auth.signInWithPassword({
    email: 'stageflow.test+qa@example.com',
    password: 'TestPassword123!'
  });

  if (error) {
    console.log('Sign in error:', error.message);
    return;
  }

  const token = data.session.access_token;
  console.log('Got token:', token.substring(0, 30) + '...');
  console.log('User ID:', data.user.id);

  // Test profile-get with auth
  console.log('\nTesting profile-get with Authorization header...');
  const response = await fetch('https://stageflow.startupstage.com/.netlify/functions/profile-get', {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Origin': 'https://stageflow.startupstage.com'
    }
  });

  console.log('Status:', response.status);
  const body = await response.json();
  console.log('Response:', JSON.stringify(body, null, 2));
}

test().catch(console.error);
