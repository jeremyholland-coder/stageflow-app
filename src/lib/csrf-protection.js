// src/lib/csrf-protection.js
/**
 * CSRF Protection Implementation
 * Protects state-changing operations from cross-site request forgery
 * 
 * HIGH-PRIORITY FIX #6: Implements double-submit cookie pattern
 */

export class CsrfProtection {
  constructor(options = {}) {
    this.tokenName = options.tokenName || 'csrf_token';
    this.headerName = options.headerName || 'X-CSRF-Token';
    this.cookieName = options.cookieName || '_csrf';
    this.tokenLength = options.tokenLength || 32;
    // CRITICAL FIX #14: Don't access window.location in constructor
    // Defer to getCookieOptions() method for lazy evaluation
    this.baseOptions = options.cookieOptions || {};
  }

  /**
   * Get cookie options (lazy evaluation to prevent TDZ errors)
   */
  getCookieOptions() {
    return {
      sameSite: 'strict',
      secure: typeof window !== 'undefined' && window.location.protocol === 'https:',
      path: '/',
      ...this.baseOptions
    };
  }

  /**
   * Generate a cryptographically secure CSRF token
   */
  generateToken() {
    const array = new Uint8Array(this.tokenLength);
    crypto.getRandomValues(array);
    
    return Array.from(array, byte => 
      byte.toString(16).padStart(2, '0')
    ).join('');
  }

  /**
   * Get or create CSRF token
   */
  getToken() {
    let token = sessionStorage.getItem(this.tokenName);
    
    if (!token) {
      token = this.generateToken();
      sessionStorage.setItem(this.tokenName, token);
      this.setCookie(token);
    }
    
    const cookieToken = this.getCookie();
    if (cookieToken && cookieToken !== token) {
      console.warn('[CSRF] Token mismatch detected, regenerating...');
      token = this.generateToken();
      sessionStorage.setItem(this.tokenName, token);
      this.setCookie(token);
    }
    
    return token;
  }

  /**
   * Set CSRF token in cookie
   */
  setCookie(token) {
    const cookieOpts = this.getCookieOptions();
    const options = [
      `${this.cookieName}=${token}`,
      `path=${cookieOpts.path}`,
      `samesite=${cookieOpts.sameSite}`
    ];

    if (cookieOpts.secure) {
      options.push('secure');
    }

    document.cookie = options.join('; ');
  }

  /**
   * Get CSRF token from cookie
   * FIX: Defensive cookie parsing to prevent crashes in SSR/restricted contexts
   */
  getCookie() {
    // Guard against undefined document or cookie (SSR, iframes, restricted contexts)
    if (typeof document === 'undefined' || typeof document.cookie !== 'string') {
      return null;
    }

    try {
      const name = this.cookieName + '=';
      const cookieString = document.cookie || '';
      const cookies = cookieString.split(';');

      for (let cookie of cookies) {
        cookie = cookie.trim();
        if (cookie.indexOf(name) === 0) {
          return cookie.substring(name.length);
        }
      }

      return null;
    } catch (error) {
      console.warn('[CSRF] Cookie parse error:', error);
      return null;
    }
  }

  /**
   * Clear CSRF token
   */
  clearToken() {
    sessionStorage.removeItem(this.tokenName);
    document.cookie = `${this.cookieName}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;`;
  }

  /**
   * Validate CSRF token (timing-safe comparison)
   */
  validateToken(submittedToken) {
    const storedToken = this.getToken();
    
    if (!submittedToken || !storedToken) {
      return false;
    }
    
    return this.timingSafeEqual(submittedToken, storedToken);
  }

  /**
   * Timing-safe string comparison
   */
  timingSafeEqual(a, b) {
    if (a.length !== b.length) {
      return false;
    }
    
    let result = 0;
    for (let i = 0; i < a.length; i++) {
      result |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    
    return result === 0;
  }

  /**
   * Add CSRF token to fetch request
   */
  protectRequest(url, options = {}) {
    const method = (options.method || 'GET').toUpperCase();
    const stateMethods = ['POST', 'PUT', 'DELETE', 'PATCH'];
    
    if (!stateMethods.includes(method)) {
      return { url, options };
    }

    const token = this.getToken();
    const headers = new Headers(options.headers || {});
    headers.set(this.headerName, token);

    return {
      url,
      options: {
        ...options,
        headers,
        credentials: 'include' // CRITICAL: Include HttpOnly auth cookies
      }
    };
  }

  /**
   * Protect FormData submission
   */
  protectFormData(formData) {
    const token = this.getToken();
    formData.append(this.tokenName, token);
    return formData;
  }

  /**
   * Create protected fetch wrapper
   */
  createProtectedFetch() {
    const self = this;
    
    return async function protectedFetch(url, options = {}) {
      const { url: protectedUrl, options: protectedOptions } = 
        self.protectRequest(url, options);
      
      return fetch(protectedUrl, protectedOptions);
    };
  }
}

// Singleton instance
export const csrfProtection = new CsrfProtection();

/**
 * Backend middleware for CSRF validation
 */
export function validateCsrfToken(request) {
  const submittedToken = request.headers.get('X-CSRF-Token') || 
                        request.headers.get('x-csrf-token');
  
  const cookies = request.headers.get('cookie') || '';
  const cookieMatch = cookies.match(/_csrf=([^;]+)/);
  const cookieToken = cookieMatch ? cookieMatch[1] : null;

  if (!submittedToken || !cookieToken) {
    return {
      valid: false,
      error: 'CSRF token missing',
      status: 403
    };
  }

  if (submittedToken !== cookieToken) {
    return {
      valid: false,
      error: 'CSRF token mismatch',
      status: 403
    };
  }

  return { valid: true };
}

export default CsrfProtection;
