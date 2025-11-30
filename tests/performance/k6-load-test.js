/**
 * k6 Load Test Script for StageFlow API
 *
 * Tests API endpoint performance under load.
 *
 * Usage:
 *   k6 run tests/performance/k6-load-test.js
 *   k6 run --vus 10 --duration 5m tests/performance/k6-load-test.js
 *   k6 run -e BASE_URL=http://localhost:8888 tests/performance/k6-load-test.js
 *
 * Install k6:
 *   brew install k6  (macOS)
 *   choco install k6 (Windows)
 *   See: https://k6.io/docs/getting-started/installation/
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// Custom metrics
const errorRate = new Rate('errors');
const profileGetDuration = new Trend('profile_get_duration');
const createDealDuration = new Trend('create_deal_duration');
const updateDealDuration = new Trend('update_deal_duration');
const aiProvidersDuration = new Trend('ai_providers_duration');
const notificationsDuration = new Trend('notifications_duration');

// Configuration
const BASE_URL = __ENV.BASE_URL || 'https://stageflow.startupstage.com';
const API_BASE = `${BASE_URL}/.netlify/functions`;

// Test user auth token (must be provided as environment variable)
const AUTH_TOKEN = __ENV.AUTH_TOKEN || '';
const ORG_ID = __ENV.ORG_ID || '';

// Test stages - ramp up, sustain, ramp down
export const options = {
  stages: [
    { duration: '1m', target: 10 },   // Ramp up to 10 users
    { duration: '3m', target: 25 },   // Ramp up to 25 users
    { duration: '5m', target: 25 },   // Stay at 25 users
    { duration: '2m', target: 50 },   // Spike to 50 users
    { duration: '3m', target: 50 },   // Stay at 50 users
    { duration: '2m', target: 0 },    // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<3000'], // 95% of requests under 3s
    errors: ['rate<0.1'],               // Error rate below 10%
    profile_get_duration: ['p(95)<2000'],
    create_deal_duration: ['p(95)<3000'],
    ai_providers_duration: ['p(95)<2000'],
  },
};

// Helper function for authenticated requests
function authRequest(method, endpoint, body = null) {
  const url = `${API_BASE}/${endpoint}`;
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${AUTH_TOKEN}`,
  };

  const params = { headers };

  let response;
  if (method === 'GET') {
    response = http.get(url, params);
  } else if (method === 'POST') {
    response = http.post(url, JSON.stringify(body), params);
  }

  return response;
}

// Main test function
export default function () {
  if (!AUTH_TOKEN || !ORG_ID) {
    console.warn('AUTH_TOKEN and ORG_ID must be provided as environment variables');
    return;
  }

  // Group: Profile operations
  group('Profile', () => {
    const response = authRequest('POST', 'profile-get', {
      organizationId: ORG_ID,
    });

    profileGetDuration.add(response.timings.duration);

    const success = check(response, {
      'profile-get status 200': (r) => r.status === 200,
      'profile-get has data': (r) => {
        const body = JSON.parse(r.body);
        return body && (body.profile || body.organization);
      },
    });

    errorRate.add(!success);
  });

  sleep(1);

  // Group: Deal operations
  group('Deals', () => {
    // Create a deal
    const uniqueClient = `K6 Test ${Date.now()}-${__VU}`;
    const createResponse = authRequest('POST', 'create-deal', {
      dealData: {
        client: uniqueClient,
        value: Math.floor(Math.random() * 10000) + 1000,
        stage: 'lead',
        notes: 'Created by k6 load test',
      },
      organizationId: ORG_ID,
    });

    createDealDuration.add(createResponse.timings.duration);

    const createSuccess = check(createResponse, {
      'create-deal status 200': (r) => r.status === 200,
      'create-deal returns deal': (r) => {
        const body = JSON.parse(r.body);
        return body && body.deal && body.deal.id;
      },
    });

    errorRate.add(!createSuccess);

    // If deal was created, update and delete it
    if (createSuccess && createResponse.status === 200) {
      const dealId = JSON.parse(createResponse.body).deal.id;

      sleep(0.5);

      // Update deal
      const updateResponse = authRequest('POST', 'update-deal', {
        dealId: dealId,
        updates: { stage: 'quote', value: 15000 },
        organizationId: ORG_ID,
      });

      updateDealDuration.add(updateResponse.timings.duration);

      check(updateResponse, {
        'update-deal status 200': (r) => r.status === 200,
      });

      sleep(0.5);

      // Delete deal (cleanup)
      const deleteResponse = authRequest('POST', 'delete-deal', {
        dealId: dealId,
        organizationId: ORG_ID,
      });

      check(deleteResponse, {
        'delete-deal status 200': (r) => r.status === 200,
      });
    }
  });

  sleep(1);

  // Group: AI Providers
  group('AI Providers', () => {
    const response = authRequest('POST', 'get-ai-providers', {
      organizationId: ORG_ID,
    });

    aiProvidersDuration.add(response.timings.duration);

    const success = check(response, {
      'get-ai-providers status 200': (r) => r.status === 200,
    });

    errorRate.add(!success);
  });

  sleep(1);

  // Group: Notifications
  group('Notifications', () => {
    const response = authRequest('POST', 'notification-preferences-get', {
      organizationId: ORG_ID,
    });

    notificationsDuration.add(response.timings.duration);

    // This might return 200 or 404 depending on setup
    check(response, {
      'notifications status valid': (r) => r.status === 200 || r.status === 404,
    });
  });

  sleep(2);
}

// Setup function - runs once before test
export function setup() {
  console.log(`=== StageFlow k6 Load Test ===`);
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Auth Token: ${AUTH_TOKEN ? 'Provided' : 'MISSING'}`);
  console.log(`Org ID: ${ORG_ID ? 'Provided' : 'MISSING'}`);

  // Verify auth works
  const response = authRequest('POST', 'profile-get', {
    organizationId: ORG_ID,
  });

  if (response.status !== 200) {
    console.error('Auth verification failed:', response.status, response.body);
  } else {
    console.log('Auth verified successfully');
  }

  return { startTime: Date.now() };
}

// Teardown function - runs once after test
export function teardown(data) {
  const duration = (Date.now() - data.startTime) / 1000;
  console.log(`\n=== Test Complete ===`);
  console.log(`Duration: ${duration}s`);
}
