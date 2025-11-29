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
      // Read cookie from document.cookie
      const value = `; ${document.cookie}`;
      const parts = value.split(`; ${name}=`);
      if (parts.length === 2) return parts.pop().split(';').shift();
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
