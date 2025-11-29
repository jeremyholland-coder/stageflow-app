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
   * Run validation and throw if critical errors found
   */
  validateOrThrow() {
    const result = this.validateSupabaseConfig();
    
    if (!result.isValid) {
      const errorMsg = [
        '❌ DATABASE CONFIGURATION ERROR',
        '',
        'Critical database configuration issues detected:',
        ...result.errors.map(e => `  • ${e}`),
        '',
        'The application cannot start until these are resolved.',
        'Please check your .env.local file and Netlify environment variables.'
      ].join('\n');
      
      throw new Error(errorMsg);
    }

    if (result.warnings.length > 0) {
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

export function initValidator() {
  if (validationInitialized) return;
  validationInitialized = true;

  if (typeof window !== 'undefined') {
    try {
      validator.validateOrThrow();
    } catch (error) {
      console.error(error.message);
      // Show error to user
      if (document.body) {
        const errorDiv = document.createElement('div');
        errorDiv.style.cssText = `
          position: fixed;
          top: 0; left: 0; right: 0; bottom: 0;
          background: #1a1a1a;
          color: #fff;
          padding: 40px;
          font-family: monospace;
          z-index: 99999;
          overflow: auto;
        `;
        // SECURITY FIX: Use textContent to prevent XSS
        const heading = document.createElement('h1');
        heading.style.color = '#e74c3c';
        heading.textContent = '⚠️ Configuration Error';

        const pre = document.createElement('pre');
        pre.style.background = '#2a2a2a';
        pre.style.padding = '20px';
        pre.style.borderRadius = '8px';
        pre.textContent = error.message; // Safe - no HTML injection

        const para = document.createElement('p');
        para.textContent = 'Please contact your system administrator.';

        errorDiv.appendChild(heading);
        errorDiv.appendChild(pre);
        errorDiv.appendChild(para);
        document.body.appendChild(errorDiv);
      }
    }
  }
}

export default validator;
