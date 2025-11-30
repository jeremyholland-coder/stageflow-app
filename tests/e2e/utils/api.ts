/**
 * E2E Test API Utilities
 *
 * Provides helpers for calling Netlify functions during tests.
 */

// Base URL for Netlify functions
// Use production URL for integration tests when local dev isn't running
const BASE_URL = process.env.TEST_BASE_URL || 'https://stageflow.startupstage.com';

// Origin header for CORS (must match BASE_URL)
const ORIGIN_HEADER = BASE_URL.includes('localhost')
  ? 'http://localhost:8888'
  : 'https://stageflow.startupstage.com';

export interface ApiResponse<T = any> {
  status: number;
  ok: boolean;
  data: T;
  headers: Headers;
}

/**
 * Call a Netlify function
 *
 * @param path - Function path (e.g., 'profile-get', 'create-deal')
 * @param options - Fetch options (method, headers, body)
 * @returns Parsed response with status and data
 */
export async function callFunction<T = any>(
  path: string,
  options: RequestInit = {}
): Promise<ApiResponse<T>> {
  const url = `${BASE_URL}/.netlify/functions/${path}`;

  // Set default headers
  const headers = new Headers(options.headers);
  if (!headers.has('Content-Type') && options.body) {
    headers.set('Content-Type', 'application/json');
  }

  // Add origin header for CORS
  headers.set('Origin', ORIGIN_HEADER);

  const response = await fetch(url, {
    ...options,
    headers
  });

  // Parse response
  let data: T;
  const contentType = response.headers.get('content-type');

  if (contentType?.includes('application/json')) {
    data = await response.json();
  } else {
    data = await response.text() as any;
  }

  return {
    status: response.status,
    ok: response.ok,
    data,
    headers: response.headers
  };
}

/**
 * GET request helper
 */
export async function get<T = any>(
  path: string,
  headers: Record<string, string> = {}
): Promise<ApiResponse<T>> {
  return callFunction<T>(path, {
    method: 'GET',
    headers
  });
}

/**
 * POST request helper
 */
export async function post<T = any>(
  path: string,
  body: any,
  headers: Record<string, string> = {}
): Promise<ApiResponse<T>> {
  return callFunction<T>(path, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });
}

/**
 * POST multipart form data (for file uploads)
 */
export async function postFormData<T = any>(
  path: string,
  formData: FormData,
  headers: Record<string, string> = {}
): Promise<ApiResponse<T>> {
  // Don't set Content-Type for FormData - browser will set it with boundary
  const url = `${BASE_URL}/.netlify/functions/${path}`;

  const requestHeaders = new Headers(headers);
  requestHeaders.set('Origin', ORIGIN_HEADER);
  // Remove Content-Type if set - let fetch handle multipart boundary
  requestHeaders.delete('Content-Type');

  const response = await fetch(url, {
    method: 'POST',
    headers: requestHeaders,
    body: formData
  });

  let data: T;
  const contentType = response.headers.get('content-type');

  if (contentType?.includes('application/json')) {
    data = await response.json();
  } else {
    data = await response.text() as any;
  }

  return {
    status: response.status,
    ok: response.ok,
    data,
    headers: response.headers
  };
}

/**
 * Create a test image file for avatar uploads
 */
export function createTestImageFile(): Blob {
  // 1x1 red PNG
  const base64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';
  const binary = atob(base64);
  const array = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    array[i] = binary.charCodeAt(i);
  }
  return new Blob([array], { type: 'image/png' });
}

/**
 * Log API response for debugging
 */
export function logResponse(name: string, response: ApiResponse): void {
  console.log(`\n[${name}] Status: ${response.status}`);
  console.log(`[${name}] Data:`, JSON.stringify(response.data, null, 2).substring(0, 500));
}
