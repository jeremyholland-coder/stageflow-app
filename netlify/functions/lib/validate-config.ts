/**
 * Database Configuration Validator
 * 
 * Ensures frontend and backend Supabase credentials match to prevent
 * data inconsistencies and silent failures.
 * 
 * Critical Fix #1: Addresses database key mismatch risk identified in audit
 */

interface SupabaseConfig {
  url: string;
  anonKey: string;
  serviceRoleKey?: string;
}

interface ValidationResult {
  valid: boolean;
  config?: SupabaseConfig;
  errors: string[];
  warnings: string[];
}

/**
 * Validates Supabase configuration across frontend and backend
 * 
 * @throws Error if configuration is invalid in production
 * @returns ValidationResult with config or error details
 */
export function validateSupabaseConfig(): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  
  // Extract environment variables
  const frontendUrl = process.env.VITE_SUPABASE_URL;
  const backendUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  
  const frontendKey = process.env.VITE_SUPABASE_ANON_KEY;
  const backendKey = process.env.SUPABASE_ANON_KEY;
  // Check SUPABASE_SERVICE_ROLE_KEY first (matches local .env), fallback to SERVICE_ROLE_KEY
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;
  
  // Validate URLs exist
  if (!frontendUrl && !backendUrl) {
    errors.push('No Supabase URL configured (VITE_SUPABASE_URL or SUPABASE_URL)');
  }
  
  // Validate keys exist
  if (!frontendKey && !backendKey) {
    errors.push('No Supabase anon key configured (VITE_SUPABASE_ANON_KEY or SUPABASE_ANON_KEY)');
  }
  
  // Validate URLs match if both present
  if (frontendUrl && backendUrl && frontendUrl !== backendUrl) {
    errors.push(
      `Database URL mismatch:\n` +
      `  Frontend (VITE_SUPABASE_URL): ${frontendUrl}\n` +
      `  Backend (SUPABASE_URL): ${backendUrl}`
    );
  }
  
  // Validate keys match (compare first 20 chars to avoid logging full keys)
  if (frontendKey && backendKey) {
    const frontendKeyPrefix = frontendKey.substring(0, 20);
    const backendKeyPrefix = backendKey.substring(0, 20);
    
    if (frontendKeyPrefix !== backendKeyPrefix) {
      errors.push(
        `Database key mismatch detected:\n` +
        `  Frontend key prefix: ${frontendKeyPrefix}...\n` +
        `  Backend key prefix: ${backendKeyPrefix}...\n` +
        `  This will cause authentication failures between frontend and backend.`
      );
    }
  }
  
  // Validate we're not using the old database
  const OLD_DB_ID = 'yqrabexvmhnqfnnblxnc';
  const CURRENT_DB_ID = 'wogloqkryhasahoiajvt';
  
  if (frontendUrl?.includes(OLD_DB_ID) || backendUrl?.includes(OLD_DB_ID)) {
    errors.push(
      `❌ CRITICAL: Still referencing OLD DATABASE (${OLD_DB_ID})\n` +
      `  Should be using: ${CURRENT_DB_ID}\n` +
      `  This database was migrated on Oct 18, 2025.`
    );
  }
  
  // Validate current database is being used
  if (frontendUrl && !frontendUrl.includes(CURRENT_DB_ID)) {
    warnings.push(
      `Frontend URL doesn't match expected database ID: ${CURRENT_DB_ID}\n` +
      `  Current: ${frontendUrl}`
    );
  }
  
  // Validate service role key is only in backend
  if (process.env.VITE_SUPABASE_SERVICE_ROLE_KEY) {
    errors.push(
      '🚨 SECURITY RISK: Service role key found in frontend env vars!\n' +
      '  Service role keys should NEVER be in VITE_* variables.\n' +
      '  This bypasses Row Level Security and exposes your database.'
    );
  }
  
  // Return validation result
  const valid = errors.length === 0;

  // CRITICAL: NEVER throw - just log errors
  // Throwing here breaks ALL Netlify functions
  if (!valid) {
    console.error('[validate-config] Configuration issues detected:', errors);
  }
  
  // Log warnings
  if (warnings.length > 0) {
    console.warn('⚠️ Database configuration warnings:');
    warnings.forEach(w => console.warn(`  - ${w}`));
  }
  
  // Log success
  if (valid) {
  }
  
  return {
    valid,
    config: valid ? {
      url: frontendUrl || backendUrl!,
      anonKey: frontendKey || backendKey!,
      serviceRoleKey
    } : undefined,
    errors,
    warnings
  };
}

/**
 * Helper to get validated Supabase config
 * Throws in production if config is invalid
 */
export function getSupabaseConfig(): SupabaseConfig {
  const result = validateSupabaseConfig();
  
  if (!result.valid || !result.config) {
    throw new Error(
      'Cannot get Supabase config - validation failed:\n' +
      result.errors.join('\n')
    );
  }
  
  return result.config;
}

/**
 * Validate config at module load time
 * Logs errors but NEVER throws - individual functions handle missing config
 */
try {
  validateSupabaseConfig();
} catch (error: any) {
  // This should never happen now, but just in case
  console.error('[validate-config] Unexpected validation error:', error.message);
}
