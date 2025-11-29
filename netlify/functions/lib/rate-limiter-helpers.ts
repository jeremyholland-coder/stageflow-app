// ENGINEERED SOLUTION: Rate Limiting Helper Functions
// Properly designed for Netlify Functions with Request object
// Date: 2025-11-04

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetTime: number;
}

interface RequestLog {
  count: number;
  resetTime: number;
}

const requestLogs = new Map<string, RequestLog>();

// Cleanup old entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, log] of requestLogs.entries()) {
    if (now > log.resetTime) {
      requestLogs.delete(key);
    }
  }
}, 5 * 60 * 1000);

/**
 * Check rate limit for a request
 * @param req - Netlify Request object
 * @param windowMs - Time window in milliseconds
 * @param maxRequests - Maximum requests allowed in window
 * @returns RateLimitResult
 */
export async function checkRateLimit(
  req: Request,
  windowMs: number,
  maxRequests: number
): Promise<RateLimitResult> {
  // Get identifier (IP address preferred)
  const identifier = req.headers.get('x-forwarded-for') ||
                    req.headers.get('cf-connecting-ip') ||
                    req.headers.get('x-real-ip') ||
                    'anonymous';

  const now = Date.now();
  let log = requestLogs.get(identifier);

  // Initialize or reset if expired
  if (!log || now > log.resetTime) {
    log = {
      count: 1,
      resetTime: now + windowMs
    };
    requestLogs.set(identifier, log);

    return {
      allowed: true,
      remaining: maxRequests - 1,
      resetTime: log.resetTime
    };
  }

  // Increment counter
  log.count++;

  const allowed = log.count <= maxRequests;
  const remaining = Math.max(0, maxRequests - log.count);

  return {
    allowed,
    remaining,
    resetTime: log.resetTime
  };
}

/**
 * Create rate limit response for rejected requests
 */
export function createRateLimitResponse(resetTime: number): Response {
  const retryAfter = Math.ceil((resetTime - Date.now()) / 1000);

  return new Response(JSON.stringify({
    error: 'Too many requests. Please try again later.',
    retryAfter
  }), {
    status: 429,
    headers: {
      'Content-Type': 'application/json',
      'Retry-After': String(retryAfter),
      'X-RateLimit-Limit': '100',
      'X-RateLimit-Remaining': '0',
      'X-RateLimit-Reset': String(Math.floor(resetTime / 1000))
    }
  });
}

// Preset configurations
export const RATE_LIMIT_CONFIGS = {
  API: { windowMs: 15 * 60 * 1000, maxRequests: 100 },     // 100/15min
  AUTH: { windowMs: 60 * 1000, maxRequests: 5 },           // 5/min
  LLM: { windowMs: 60 * 1000, maxRequests: 10 },           // 10/min
  WEBHOOK: { windowMs: 60 * 1000, maxRequests: 60 }        // 60/min
};
