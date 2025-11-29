// path: src/lib/csrf-client.ts

// Name of the CSRF cookie and header must match backend middleware
const CSRF_COOKIE_NAME = 'csrf_token';
const CSRF_HEADER_NAME = 'X-CSRF-Token';

/**
 * Read cookies in the browser and return as key/value object
 */
function getBrowserCookies(): Record<string, string> {
  if (typeof document === 'undefined') return {};
  const cookies: Record<string, string> = {};
  const raw = document.cookie || '';
  raw.split(';').forEach(part => {
    const [rawName, ...rest] = part.split('=');
    if (!rawName) return;
    const name = rawName.trim();
    const value = rest.join('=').trim();
    if (!name) return;
    cookies[name] = decodeURIComponent(value || '');
  });
  return cookies;
}

/**
 * Set a cookie in the browser.
 * CSRF cookie does NOT need HttpOnly (frontend must read it),
 * but should be Secure + SameSite=Strict.
 */
function setBrowserCookie(name: string, value: string, days = 1) {
  if (typeof document === 'undefined') return;
  const expires = new Date(Date.now() + days * 86400000).toUTCString();
  document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(
    value
  )}; Expires=${expires}; Path=/; Secure; SameSite=Strict`;
}

/**
 * Generate a random CSRF token.
 * Using crypto.randomUUID when available, fallback to random string.
 */
function generateCsrfToken(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    // @ts-ignore
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

/**
 * Ensure a CSRF token exists in cookies and return it.
 * This runs on first use in the browser.
 */
export function getCsrfToken(): string {
  const cookies = getBrowserCookies();
  let token = cookies[CSRF_COOKIE_NAME];

  if (!token) {
    token = generateCsrfToken();
    setBrowserCookie(CSRF_COOKIE_NAME, token, 1); // 1 day lifetime is fine; regenerated as needed
  }

  return token;
}

/**
 * secureFetch: wrapper around fetch that:
 * - ensures CSRF token exists
 * - sends it as X-CSRF-Token header
 * - includes credentials (cookies)
 */
export async function secureFetch(
  input: RequestInfo | URL,
  init: RequestInit = {}
): Promise<Response> {
  const token = getCsrfToken();

  const headers = new Headers(init.headers || {});
  // Only set JSON header if not already provided
  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  headers.set(CSRF_HEADER_NAME, token);

  return fetch(input, {
    ...init,
    headers,
    credentials: 'include', // ensure cookies (including csrf_token & auth cookies) are sent
  });
}
