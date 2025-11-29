/**
 * Security Events Logging Library
 *
 * PURPOSE:
 * Centralized logging for all authentication and security events.
 * Provides audit trail for compliance (SOC 2, GDPR, PCI DSS) and incident response.
 *
 * USAGE:
 * ```typescript
 * import { logSecurityEvent, SecurityEventType } from './lib/security-events';
 *
 * await logSecurityEvent({
 *   type: 'LOGIN_SUCCESS',
 *   userId: user.id,
 *   email: user.email,
 *   ipAddress: req.headers.get('x-forwarded-for'),
 *   userAgent: req.headers.get('user-agent'),
 *   metadata: { loginMethod: 'password' }
 * });
 * ```
 *
 * FEATURES:
 * - Automatic suspicious activity detection
 * - Risk scoring
 * - Async logging (non-blocking)
 * - Graceful degradation on errors
 * - Structured metadata
 *
 * SECURITY:
 * - Never logs sensitive data (passwords, tokens)
 * - IP addresses anonymized if privacy mode enabled
 * - GDPR-compliant data retention
 *
 * CREATED: 2025-11-19
 * AUTHOR: Senior Security Engineer
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

/**
 * Security event types
 * Must match CHECK constraint in database
 */
export type SecurityEventType =
  | 'LOGIN_SUCCESS'
  | 'LOGIN_FAILURE'
  | 'LOGOUT'
  | 'TOKEN_REFRESH'
  | 'TOKEN_REFRESH_FAILURE'
  | 'PASSWORD_RESET_REQUESTED'
  | 'PASSWORD_RESET_COMPLETED'
  | 'SIGNUP_SUCCESS'
  | 'SIGNUP_FAILURE'
  | 'RATE_LIMIT_EXCEEDED'
  | 'SESSION_EXPIRED'
  | 'SUSPICIOUS_ACTIVITY'
  | 'ACCOUNT_LOCKED'
  | 'ACCOUNT_UNLOCKED'
  | 'MFA_ENABLED'
  | 'MFA_DISABLED'
  | 'API_KEY_CREATED'
  | 'API_KEY_REVOKED';

/**
 * Security event structure
 */
export interface SecurityEvent {
  type: SecurityEventType;
  userId?: string;
  email?: string;
  ipAddress?: string;
  userAgent?: string;
  metadata?: Record<string, any>;
  isSuspicious?: boolean;
  riskScore?: number;
}

/**
 * Security event logging result
 */
export interface LogResult {
  success: boolean;
  eventId?: string;
  error?: string;
}

/**
 * Get Supabase client with service role key
 * Required for inserting into security_events table
 */
function getSupabaseClient(): SupabaseClient {
  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase configuration for security event logging');
  }

  return createClient(supabaseUrl, supabaseKey);
}

/**
 * Anonymize IP address for privacy (GDPR compliance)
 * Keeps first 3 octets for IPv4, first 4 groups for IPv6
 *
 * @param ip - IP address to anonymize
 * @returns Anonymized IP address
 */
function anonymizeIP(ip: string): string {
  if (!ip) return '';

  // IPv4: 192.168.1.123 -> 192.168.1.0
  if (ip.includes('.')) {
    const parts = ip.split('.');
    if (parts.length === 4) {
      return `${parts[0]}.${parts[1]}.${parts[2]}.0`;
    }
  }

  // IPv6: 2001:0db8:85a3:0000:0000:8a2e:0370:7334 -> 2001:0db8:85a3:0000::
  if (ip.includes(':')) {
    const parts = ip.split(':');
    if (parts.length >= 4) {
      return `${parts.slice(0, 4).join(':')}::`;
    }
  }

  return ip;
}

/**
 * Calculate risk score based on event type and metadata
 *
 * Risk Scores:
 * - 0-30: Low risk (normal activity)
 * - 31-60: Medium risk (potentially suspicious)
 * - 61-80: High risk (suspicious activity)
 * - 81-100: Critical risk (likely attack)
 *
 * @param event - Security event
 * @returns Risk score (0-100)
 */
function calculateRiskScore(event: SecurityEvent): number {
  let score = 0;

  // Base scores by event type
  const eventRiskScores: Record<SecurityEventType, number> = {
    'LOGIN_SUCCESS': 0,
    'LOGIN_FAILURE': 20,
    'LOGOUT': 0,
    'TOKEN_REFRESH': 0,
    'TOKEN_REFRESH_FAILURE': 30,
    'PASSWORD_RESET_REQUESTED': 10,
    'PASSWORD_RESET_COMPLETED': 15,
    'SIGNUP_SUCCESS': 5,
    'SIGNUP_FAILURE': 25,
    'RATE_LIMIT_EXCEEDED': 70,
    'SESSION_EXPIRED': 5,
    'SUSPICIOUS_ACTIVITY': 80,
    'ACCOUNT_LOCKED': 60,
    'ACCOUNT_UNLOCKED': 10,
    'MFA_ENABLED': 0,
    'MFA_DISABLED': 40,
    'API_KEY_CREATED': 10,
    'API_KEY_REVOKED': 15
  };

  score = eventRiskScores[event.type] || 0;

  // Adjust score based on metadata
  if (event.metadata) {
    // Multiple failures increase risk
    if (event.metadata.consecutiveFailures) {
      score += Math.min(event.metadata.consecutiveFailures * 10, 30);
    }

    // Unknown devices increase risk
    if (event.metadata.newDevice) {
      score += 15;
    }

    // Unusual locations increase risk
    if (event.metadata.unusualLocation) {
      score += 20;
    }

    // Tor/VPN/Proxy increases risk
    if (event.metadata.isTorOrVPN) {
      score += 25;
    }

    // Bot-like behavior increases risk
    if (event.metadata.isSuspiciousUserAgent) {
      score += 20;
    }
  }

  // If explicitly marked as suspicious
  if (event.isSuspicious) {
    score = Math.max(score, 70);
  }

  // Cap at 100
  return Math.min(score, 100);
}

/**
 * Log a security event
 *
 * This function is designed to NEVER throw errors or block execution.
 * All errors are logged and swallowed to prevent authentication flow disruption.
 *
 * @param event - Security event to log
 * @returns Promise<LogResult> - Result of logging operation
 */
export async function logSecurityEvent(event: SecurityEvent): Promise<LogResult> {
  try {
    // Validate required fields
    if (!event.type) {
      console.error('[SecurityEvents] Missing event type');
      return { success: false, error: 'Missing event type' };
    }

    // Get Supabase client
    const supabase = getSupabaseClient();

    // Anonymize IP if privacy mode enabled
    const shouldAnonymizeIP = process.env.ANONYMIZE_IP_ADDRESSES === 'true';
    const ipAddress = event.ipAddress
      ? (shouldAnonymizeIP ? anonymizeIP(event.ipAddress) : event.ipAddress)
      : null;

    // Calculate risk score if not provided
    const riskScore = event.riskScore ?? calculateRiskScore(event);

    // Prepare event data
    const eventData = {
      event_type: event.type,
      user_id: event.userId || null,
      email: event.email || null,
      ip_address: ipAddress,
      user_agent: event.userAgent || null,
      metadata: event.metadata || {},
      is_suspicious: event.isSuspicious || riskScore >= 70,
      risk_score: riskScore
    };

    // Insert into database
    const { data, error } = await supabase
      .from('security_events')
      .insert(eventData)
      .select('id')
      .single();

    if (error) {
      console.error('[SecurityEvents] Failed to log event:', {
        eventType: event.type,
        error: error.message,
        code: error.code
      });
      return { success: false, error: error.message };
    }

    // Success
    console.warn('[SecurityEvents] Event logged:', {
      eventId: data.id,
      type: event.type,
      userId: event.userId,
      email: event.email,
      riskScore: riskScore
    });

    return { success: true, eventId: data.id };

  } catch (error: any) {
    // NEVER throw - gracefully degrade
    console.error('[SecurityEvents] Exception while logging event:', {
      eventType: event.type,
      error: error.message,
      stack: error.stack
    });

    return { success: false, error: error.message };
  }
}

/**
 * Log multiple security events in batch
 * More efficient than individual calls
 *
 * @param events - Array of security events
 * @returns Promise<LogResult[]> - Array of results
 */
export async function logSecurityEventsBatch(events: SecurityEvent[]): Promise<LogResult[]> {
  try {
    if (!events || events.length === 0) {
      return [];
    }

    const supabase = getSupabaseClient();
    const shouldAnonymizeIP = process.env.ANONYMIZE_IP_ADDRESSES === 'true';

    // Prepare all events
    const eventDataArray = events.map(event => ({
      event_type: event.type,
      user_id: event.userId || null,
      email: event.email || null,
      ip_address: event.ipAddress
        ? (shouldAnonymizeIP ? anonymizeIP(event.ipAddress) : event.ipAddress)
        : null,
      user_agent: event.userAgent || null,
      metadata: event.metadata || {},
      is_suspicious: event.isSuspicious || calculateRiskScore(event) >= 70,
      risk_score: event.riskScore ?? calculateRiskScore(event)
    }));

    // Batch insert
    const { data, error } = await supabase
      .from('security_events')
      .insert(eventDataArray)
      .select('id');

    if (error) {
      console.error('[SecurityEvents] Batch insert failed:', error.message);
      return events.map(() => ({ success: false, error: error.message }));
    }

    // Map results
    return (data || []).map(row => ({ success: true, eventId: row.id }));

  } catch (error: any) {
    console.error('[SecurityEvents] Batch insert exception:', error.message);
    return events.map(() => ({ success: false, error: error.message }));
  }
}

/**
 * Get recent failed login attempts for email (for rate limiting)
 *
 * @param email - Email address to check
 * @param windowMinutes - Time window in minutes (default: 60)
 * @returns Promise<number> - Number of failed attempts
 */
export async function getFailedLoginAttempts(
  email: string,
  windowMinutes: number = 60
): Promise<number> {
  try {
    const supabase = getSupabaseClient();

    const { data, error } = await supabase
      .from('security_events')
      .select('id', { count: 'exact' })
      .eq('event_type', 'LOGIN_FAILURE')
      .eq('email', email)
      .gte('created_at', new Date(Date.now() - windowMinutes * 60 * 1000).toISOString());

    if (error) {
      console.error('[SecurityEvents] Failed to get login attempts:', error.message);
      return 0;
    }

    return data?.length || 0;

  } catch (error: any) {
    console.error('[SecurityEvents] Exception getting login attempts:', error.message);
    return 0;
  }
}

/**
 * Get recent suspicious events for monitoring dashboard
 *
 * @param limit - Maximum number of events to return
 * @returns Promise<SecurityEvent[]> - Array of suspicious events
 */
export async function getRecentSuspiciousEvents(limit: number = 100): Promise<SecurityEvent[]> {
  try {
    const supabase = getSupabaseClient();

    const { data, error } = await supabase
      .from('security_events')
      .select('*')
      .eq('is_suspicious', true)
      .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('[SecurityEvents] Failed to get suspicious events:', error.message);
      return [];
    }

    return (data || []).map(row => ({
      type: row.event_type as SecurityEventType,
      userId: row.user_id,
      email: row.email,
      ipAddress: row.ip_address,
      userAgent: row.user_agent,
      metadata: row.metadata,
      isSuspicious: row.is_suspicious,
      riskScore: row.risk_score
    }));

  } catch (error: any) {
    console.error('[SecurityEvents] Exception getting suspicious events:', error.message);
    return [];
  }
}

/**
 * Helper: Extract IP address from request
 *
 * @param req - Request object
 * @returns IP address or null
 */
export function extractIPAddress(req: Request | any): string | null {
  // Netlify Functions provide headers as object
  const headers = req.headers instanceof Headers ? req.headers : new Headers(req.headers || {});

  // Try various IP headers
  return (
    headers.get('x-forwarded-for')?.split(',')[0].trim() ||
    headers.get('cf-connecting-ip') ||
    headers.get('x-real-ip') ||
    headers.get('x-client-ip') ||
    null
  );
}

/**
 * Helper: Extract user agent from request
 *
 * @param req - Request object
 * @returns User agent string or null
 */
export function extractUserAgent(req: Request | any): string | null {
  const headers = req.headers instanceof Headers ? req.headers : new Headers(req.headers || {});
  return headers.get('user-agent') || null;
}

/**
 * Helper: Create security event from request context
 *
 * @param type - Event type
 * @param req - Request object (Netlify Function event or Web Request)
 * @param additional - Additional event data
 * @returns SecurityEvent
 */
export function createSecurityEvent(
  type: SecurityEventType,
  req: Request | any,
  additional: Partial<SecurityEvent> = {}
): SecurityEvent {
  return {
    type,
    ipAddress: extractIPAddress(req),
    userAgent: extractUserAgent(req),
    ...additional
  };
}
