/**
 * k6 Health Check Load Test
 *
 * Simple load test that doesn't require authentication.
 * Tests public endpoints and health checks.
 *
 * Usage:
 *   k6 run tests/performance/k6-health-check.js
 *   k6 run --vus 10 --duration 2m tests/performance/k6-health-check.js
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// Custom metrics
const errorRate = new Rate('errors');
const healthCheckDuration = new Trend('health_check_duration');
const loginPageDuration = new Trend('login_page_duration');

// Configuration
const BASE_URL = __ENV.BASE_URL || 'https://stageflow.startupstage.com';
const API_BASE = `${BASE_URL}/.netlify/functions`;

// Test options
export const options = {
  stages: [
    { duration: '30s', target: 5 },   // Ramp up to 5 users
    { duration: '1m', target: 10 },   // Ramp to 10 users
    { duration: '2m', target: 10 },   // Stay at 10 users
    { duration: '30s', target: 0 },   // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<5000'], // 95% under 5s
    errors: ['rate<0.05'],              // Error rate below 5%
    health_check_duration: ['p(95)<1000'],
    login_page_duration: ['p(95)<3000'],
  },
};

export default function () {
  // Test: Health check endpoint
  const healthResponse = http.get(`${API_BASE}/health-check`);

  healthCheckDuration.add(healthResponse.timings.duration);

  const healthSuccess = check(healthResponse, {
    'health-check status 200': (r) => r.status === 200,
    'health-check response time < 1s': (r) => r.timings.duration < 1000,
    'health-check returns JSON': (r) => {
      try {
        JSON.parse(r.body);
        return true;
      } catch {
        return false;
      }
    },
  });

  errorRate.add(!healthSuccess);

  sleep(1);

  // Test: Login page load
  const pageResponse = http.get(BASE_URL);

  loginPageDuration.add(pageResponse.timings.duration);

  const pageSuccess = check(pageResponse, {
    'login page status 200': (r) => r.status === 200,
    'login page response time < 3s': (r) => r.timings.duration < 3000,
    'login page contains HTML': (r) => r.body && r.body.includes('<!DOCTYPE html>'),
  });

  errorRate.add(!pageSuccess);

  sleep(2);

  // Test: Auth endpoints (without valid creds - should return 401, not 500)
  const authResponse = http.post(
    `${API_BASE}/profile-get`,
    JSON.stringify({ organizationId: 'test' }),
    { headers: { 'Content-Type': 'application/json' } }
  );

  check(authResponse, {
    'unauthenticated request returns 401': (r) => r.status === 401,
    'unauthenticated request not 500': (r) => r.status !== 500,
    'unauthenticated request returns JSON': (r) => {
      try {
        JSON.parse(r.body);
        return true;
      } catch {
        return false;
      }
    },
  });

  sleep(1);
}

export function setup() {
  console.log(`=== StageFlow Health Check Load Test ===`);
  console.log(`Target: ${BASE_URL}`);
  return { startTime: Date.now() };
}

export function teardown(data) {
  const duration = (Date.now() - data.startTime) / 1000;
  console.log(`\nTest completed in ${duration}s`);
}
