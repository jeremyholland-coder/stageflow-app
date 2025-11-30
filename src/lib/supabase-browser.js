/**
 * Supabase Browser Client with Cookie Storage
 *
 * Uses @supabase/ssr for secure cookie-based authentication
 * Replaces localStorage with HttpOnly cookies to prevent XSS attacks
 */

import { createBrowserClient } from '@supabase/ssr';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createBrowserClient(supabaseUrl, supabaseAnonKey, {
  cookies: {
    get(name) {
      // FIX: Defensive cookie parsing to prevent "e.split is not a function" error (React error #31)
      // Root cause: document.cookie could be undefined in certain browser contexts (SSR, iframes, restricted contexts)
      // or parts.pop() could return undefined if cookie parsing fails
      // This was causing unhandled promise rejections and crashing the notification settings screen
      try {
        // Guard against undefined document or cookie
        if (typeof document === 'undefined' || typeof document.cookie !== 'string') {
          return undefined;
        }
        const cookieString = document.cookie || '';
        const value = `; ${cookieString}`;
        const parts = value.split(`; ${name}=`);
        if (parts.length === 2) {
          const lastPart = parts.pop();
          // Guard against undefined lastPart before calling split
          if (typeof lastPart === 'string') {
            return lastPart.split(';').shift();
          }
        }
        return undefined;
      } catch (error) {
        // Fail safely - return undefined instead of crashing
        console.warn('[supabase-browser] Cookie parse error:', error);
        return undefined;
      }
    },
    set(name, value, options) {
      // Write cookie to document.cookie
      let cookie = `${name}=${value}`;

      if (options?.maxAge) {
        cookie += `; max-age=${options.maxAge}`;
      }
      if (options?.path) {
        cookie += `; path=${options.path}`;
      }
      if (options?.domain) {
        cookie += `; domain=${options.domain}`;
      }
      if (options?.sameSite) {
        cookie += `; samesite=${options.sameSite}`;
      }
      if (options?.secure) {
        cookie += '; secure';
      }

      document.cookie = cookie;
    },
    remove(name, options) {
      // Remove cookie by setting max-age to 0
      let cookie = `${name}=; max-age=0`;

      if (options?.path) {
        cookie += `; path=${options.path}`;
      }
      if (options?.domain) {
        cookie += `; domain=${options.domain}`;
      }

      document.cookie = cookie;
    }
  }
});
