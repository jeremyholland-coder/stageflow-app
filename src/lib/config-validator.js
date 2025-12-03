// src/lib/config-validator.js
/**
 * Database Configuration Validator
 * Ensures frontend and backend use consistent database credentials
 * 
 * CRITICAL FIX #1: Prevents database key mismatch between environments
 */

export class ConfigValidator {
  constructor() {
    this.errors = [];
    this.warnings = [];
  }

  /**
   * Validate Supabase configuration at startup
   * @returns {Object} { isValid: boolean, errors: string[], warnings: string[] }
   */
  validateSupabaseConfig() {
    const config = {
      url: import.meta.env.VITE_SUPABASE_URL,
      anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY
    };

    // Reset validation state
    this.errors = [];
    this.warnings = [];

    // Critical: Check if URL and key are defined
    if (!config.url) {
      this.errors.push('VITE_SUPABASE_URL is not defined');
    }

    if (!config.anonKey) {
      this.errors.push('VITE_SUPABASE_ANON_KEY is not defined');
    }

    // Validate URL format
    if (config.url && !this.isValidSupabaseUrl(config.url)) {
      this.errors.push(`Invalid Supabase URL format: ${config.url}`);
    }

    // Validate that URL matches expected project ID
    const expectedProjectId = 'wogloqkryhasahoiajvt';
    if (config.url && !config.url.includes(expectedProjectId)) {
      this.errors.push(
        `Database mismatch detected! ` +
        `Expected project ID: ${expectedProjectId}, ` +
        `Got URL: ${config.url}`
      );
    }

    // Validate anon key format (JWT structure)
    if (config.anonKey && !this.isValidJWT(config.anonKey)) {
      this.errors.push('VITE_SUPABASE_ANON_KEY is not a valid JWT format');
    }

    // Validate that anon key matches the project
    if (config.anonKey && config.url) {
      const keyProjectId = this.extractProjectIdFromKey(config.anonKey);
      if (keyProjectId && keyProjectId !== expectedProjectId) {
        this.errors.push(
          `Anon key project mismatch! ` +
          `URL uses ${expectedProjectId}, ` +
          `Key uses ${keyProjectId}`
        );
      }
    }

    return {
      isValid: this.errors.length === 0,
      errors: this.errors,
      warnings: this.warnings,
      config: {
        url: config.url,
        projectId: expectedProjectId,
        keyValid: config.anonKey ? this.isValidJWT(config.anonKey) : false
      }
    };
  }

  /**
   * Check if URL is valid Supabase format
   */
  isValidSupabaseUrl(url) {
    try {
      const urlObj = new URL(url);
      return (
        urlObj.protocol === 'https:' &&
        (urlObj.hostname.endsWith('.supabase.co') ||
         urlObj.hostname.endsWith('.supabase.in'))
      );
    } catch {
      return false;
    }
  }

  /**
   * Validate JWT format (basic check)
   */
  isValidJWT(token) {
    const parts = token.split('.');
    if (parts.length !== 3) return false;

    try {
      // Try to decode the payload
      const payload = JSON.parse(atob(parts[1]));
      return payload.iss === 'supabase' && payload.role === 'anon';
    } catch {
      return false;
    }
  }

  /**
   * Extract project ID from JWT payload
   */
  extractProjectIdFromKey(token) {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return null;
      
      const payload = JSON.parse(atob(parts[1]));
      return payload.ref || null;
    } catch {
      return null;
    }
  }

  /**
   * Run validation - DEV ONLY warnings, NEVER blocks production
   *
   * CRITICAL: This must NEVER throw or block app boot in production.
   * Missing VITE_ vars in production = silent console error only.
   * Only developers need to see these warnings.
   */
  validateOrThrow() {
    const result = this.validateSupabaseConfig();
    const isDev = import.meta.env.DEV;

    if (!result.isValid) {
      // ALWAYS log to console for debugging
      console.error('[Config] VITE_ environment variable issues:', result.errors);

      // DEV ONLY: Show visible warning to developer
      if (isDev) {
        console.error(
          '%c⚠️ VITE_ ENV VARS MISSING',
          'background: #e74c3c; color: white; padding: 4px 8px; font-weight: bold;',
          '\n\nMissing:', result.errors.join(', '),
          '\n\nCheck your .env.local file has:',
          '\n  VITE_SUPABASE_URL=https://xxx.supabase.co',
          '\n  VITE_SUPABASE_ANON_KEY=eyJ...'
        );
      }

      // NEVER throw in production - let the app try to boot
      // The supabase.js Proxy will handle missing client gracefully
      return result;
    }

    if (result.warnings.length > 0 && isDev) {
      console.warn('⚠️ Configuration Warnings:');
      result.warnings.forEach(w => console.warn(`  • ${w}`));
    }

    return result;
  }

  /**
   * Display validation results in UI (for admin panel)
   */
  getValidationReport() {
    const result = this.validateSupabaseConfig();
    
    return {
      status: result.isValid ? 'healthy' : 'error',
      timestamp: new Date().toISOString(),
      checks: [
        {
          name: 'Database URL',
          status: result.config.url ? 'pass' : 'fail',
          value: result.config.url || 'Not configured',
          expected: `https://${result.config.projectId}.supabase.co`
        },
        {
          name: 'Anon Key',
          status: result.config.keyValid ? 'pass' : 'fail',
          value: result.config.keyValid ? 'Valid JWT' : 'Invalid or missing'
        },
        {
          name: 'Project Consistency',
          status: result.errors.length === 0 ? 'pass' : 'fail',
          value: `Project ID: ${result.config.projectId}`
        }
      ],
      errors: result.errors,
      warnings: result.warnings
    };
  }
}

// Singleton instance
const validator = new ConfigValidator();

// CRITICAL FIX #14: Lazy validation to prevent TDZ errors in production
// Don't run validation at module load time - call initValidator() from App.jsx instead
let validationInitialized = false;

/**
 * Initialize config validation
 *
 * CRITICAL RULES:
 * 1. NEVER block app boot in production
 * 2. NEVER show error UI to end users
 * 3. DEV ONLY: Show console warnings for developers
 * 4. Always fail gracefully - let supabase.js handle missing config
 */
export function initValidator() {
  if (validationInitialized) return;
  validationInitialized = true;

  if (typeof window !== 'undefined') {
    const isDev = import.meta.env.DEV;

    // Run validation (no longer throws)
    const result = validator.validateOrThrow();

    // DEV ONLY: Show visible indicator for missing VITE_ vars
    if (!result.isValid && isDev && document.body) {
      // Small, non-blocking dev indicator in corner
      const indicator = document.createElement('div');
      indicator.style.cssText = `
        position: fixed;
        bottom: 10px;
        left: 10px;
        background: #e74c3c;
        color: white;
        padding: 8px 12px;
        border-radius: 4px;
        font-family: monospace;
        font-size: 12px;
        z-index: 99999;
        cursor: pointer;
        box-shadow: 0 2px 8px rgba(0,0,0,0.3);
      `;
      indicator.textContent = '⚠️ VITE_ env vars missing - check console';
      indicator.title = result.errors.join('\n');
      indicator.onclick = () => {
        console.error('[Config] Missing VITE_ vars:', result.errors);
        indicator.remove();
      };
      document.body.appendChild(indicator);

      // Auto-remove after 10 seconds
      setTimeout(() => indicator.remove(), 10000);
    }

    // PRODUCTION: Silent console error only - NEVER block UI
    // The supabase.js Proxy handles missing client gracefully
  }
}

export default validator;
