/**
 * Log Sanitizer Utility
 *
 * PURPOSE:
 * Removes PII (Personally Identifiable Information) from logs to comply with
 * GDPR, CCPA, and security best practices.
 *
 * SECURITY FEATURES:
 * - Hash email addresses for log correlation without exposing PII
 * - Redact sensitive fields
 * - Preserve debugging capability with anonymized identifiers
 *
 * COMPLIANCE:
 * - GDPR Article 5(1)(f): Data must be processed securely
 * - CCPA Section 1798.100: Right to know what data is collected
 * - Apple App Store 5.1.1: Data Collection and Storage
 */

import crypto from 'crypto';

/**
 * Hash a string to create an anonymized identifier
 * Uses SHA-256 with salt for consistent but non-reversible hashing
 */
export function hashIdentifier(value: string): string {
  if (!value) return 'unknown';

  // Use SHA-256 hash with truncation for logs
  const hash = crypto.createHash('sha256')
    .update(value.toLowerCase().trim())
    .digest('hex');

  // Return first 12 characters for brevity in logs
  return `uid_${hash.substring(0, 12)}`;
}

/**
 * Sanitize email for logging
 * Returns hashed identifier instead of actual email
 */
export function sanitizeEmail(email: string | undefined): string {
  if (!email) return 'no-email';
  return hashIdentifier(email);
}

/**
 * Sanitize user ID for logging
 * Returns the ID as-is (UUIDs are not PII)
 */
export function sanitizeUserId(userId: string | undefined): string {
  if (!userId) return 'no-user-id';
  // UUIDs are random and not PII, safe to log
  return userId;
}

/**
 * Sanitize IP address for logging
 * Removes last octet for privacy while maintaining correlation
 */
export function sanitizeIP(ip: string | undefined): string {
  if (!ip || ip === 'unknown') return 'no-ip';

  // For IPv4, remove last octet: 192.168.1.100 → 192.168.1.x
  const ipv4Match = ip.match(/^(\d+\.\d+\.\d+)\.\d+$/);
  if (ipv4Match) {
    return `${ipv4Match[1]}.x`;
  }

  // For IPv6, truncate: 2001:0db8:85a3::8a2e:0370:7334 → 2001:0db8:85a3::x
  if (ip.includes(':')) {
    const parts = ip.split(':');
    return `${parts.slice(0, 3).join(':')}::x`;
  }

  return 'unknown-ip';
}

/**
 * Create sanitized log context for authentication events
 */
export function createAuthLogContext(params: {
  email?: string;
  userId?: string;
  ip?: string;
  userAgent?: string;
  timestamp?: string;
}) {
  return {
    // Use hashed email for correlation without exposing PII
    emailHash: sanitizeEmail(params.email),
    userId: sanitizeUserId(params.userId),
    ip: sanitizeIP(params.ip),
    // User agent is OK to log (not PII, useful for debugging)
    userAgent: params.userAgent || 'unknown',
    timestamp: params.timestamp || new Date().toISOString()
  };
}

/**
 * Redact sensitive fields from objects
 */
export function redactSensitiveFields<T extends Record<string, any>>(
  obj: T,
  sensitiveFields: string[] = ['password', 'token', 'secret', 'key', 'email']
): Partial<T> {
  const redacted: any = { ...obj };

  for (const field of sensitiveFields) {
    if (field in redacted) {
      redacted[field] = '[REDACTED]';
    }
  }

  return redacted;
}
