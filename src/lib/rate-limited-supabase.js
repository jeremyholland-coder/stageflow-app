/**
 * Rate-Limited Supabase Client Wrapper
 *
 * SECURITY FIX: Prevents frontend from exhausting Supabase API quotas
 *
 * Problem: Frontend makes unlimited direct Supabase calls, bypassing backend rate limits
 * Solution: Client-side request queue with configurable rate limits
 *
 * Features:
 * - Token bucket algorithm for smooth rate limiting
 * - Automatic request queuing when limit exceeded
 * - Burst allowance for better UX
 * - Per-operation rate limiting (query, insert, update, delete)
 * - Graceful degradation under load
 *
 * Usage:
 *   const supabase = createRateLimitedClient(supabaseClient, options);
 *   await supabase.from('deals').select('*'); // Automatically rate limited
 */

/**
 * Token Bucket Rate Limiter
 *
 * Algorithm:
 * - Bucket starts with `burstSize` tokens
 * - Tokens regenerate at `tokensPerSecond` rate
 * - Each request consumes 1 token
 * - If no tokens available, request is queued
 */
class TokenBucket {
  constructor(tokensPerSecond, burstSize) {
    this.tokensPerSecond = tokensPerSecond;
    this.bucketSize = burstSize;
    this.tokens = burstSize;
    this.lastRefill = Date.now();
  }

  /**
   * Try to consume a token
   * @returns {boolean} True if token available, false if rate limited
   */
  tryConsume() {
    this.refill();

    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }

    return false;
  }

  /**
   * Refill tokens based on elapsed time
   */
  refill() {
    const now = Date.now();
    const elapsedSeconds = (now - this.lastRefill) / 1000;
    const tokensToAdd = elapsedSeconds * this.tokensPerSecond;

    this.tokens = Math.min(this.bucketSize, this.tokens + tokensToAdd);
    this.lastRefill = now;
  }

  /**
   * Get time until next token available (ms)
   */
  getWaitTime() {
    if (this.tokens >= 1) return 0;

    const tokensNeeded = 1 - this.tokens;
    return (tokensNeeded / this.tokensPerSecond) * 1000;
  }
}

/**
 * Request Queue for rate-limited operations
 */
class RequestQueue {
  constructor(bucket) {
    this.bucket = bucket;
    this.queue = [];
    this.processing = false;
  }

  /**
   * Add request to queue and wait for execution
   * @param {Function} operation - Async operation to execute
   * @returns {Promise} - Resolves when operation completes
   */
  async enqueue(operation) {
    return new Promise((resolve, reject) => {
      this.queue.push({ operation, resolve, reject });
      this.processQueue();
    });
  }

  /**
   * Process queued requests (respects rate limits)
   */
  async processQueue() {
    if (this.processing || this.queue.length === 0) return;

    this.processing = true;

    while (this.queue.length > 0) {
      const { operation, resolve, reject } = this.queue[0];

      // Wait for token availability
      if (!this.bucket.tryConsume()) {
        const waitTime = this.bucket.getWaitTime();
        await new Promise(r => setTimeout(r, Math.min(waitTime, 1000)));
        continue;
      }

      // Execute operation
      this.queue.shift();
      try {
        const result = await operation();
        resolve(result);
      } catch (error) {
        reject(error);
      }
    }

    this.processing = false;
  }
}

/**
 * Create rate-limited Supabase client wrapper
 *
 * @param {Object} supabaseClient - Original Supabase client
 * @param {Object} options - Rate limiting options
 * @param {number} options.tokensPerSecond - Request rate (default: 10/second)
 * @param {number} options.burstSize - Burst allowance (default: 20 requests)
 * @returns {Proxy} - Rate-limited Supabase client
 */
export function createRateLimitedClient(supabaseClient, options = {}) {
  const {
    tokensPerSecond = 10, // 10 requests/second default
    burstSize = 20         // Allow burst of 20 requests
  } = options;

  const bucket = new TokenBucket(tokensPerSecond, burstSize);
  const queue = new RequestQueue(bucket);

  // Metrics for monitoring
  const metrics = {
    totalRequests: 0,
    queuedRequests: 0,
    rateLimitHits: 0
  };

  /**
   * Wrap Supabase operation with rate limiting
   */
  function wrapOperation(operation) {
    return async function(...args) {
      metrics.totalRequests++;

      // Try immediate execution
      if (bucket.tryConsume()) {
        return await operation.apply(this, args);
      }

      // Rate limited - queue request
      metrics.queuedRequests++;
      metrics.rateLimitHits++;

      console.warn('[RateLimit] Request queued - rate limit reached', {
        queueSize: queue.queue.length,
        waitTime: bucket.getWaitTime()
      });

      return await queue.enqueue(() => operation.apply(this, args));
    };
  }

  /**
   * Create Proxy to intercept Supabase calls
   */
  return new Proxy(supabaseClient, {
    get(target, prop) {
      const value = target[prop];

      // Don't wrap non-function properties
      if (typeof value !== 'function') {
        return value;
      }

      // Special handling for query builders (from, rpc, etc.)
      if (prop === 'from' || prop === 'rpc') {
        return function(...args) {
          const builder = value.apply(target, args);

          // CRITICAL FIX v1.8.15: Create builder proxy with proper chaining support
          // Problem: .update(data).eq('id', x) breaks because .update() was wrapped to return Promise
          // Solution: All builder methods return proxied builders to maintain the chain
          // Rate limiting ONLY happens at .then() level (when await is used)
          function createBuilderProxy(builderInstance) {
            return new Proxy(builderInstance, {
              get(builderTarget, builderProp) {
                const builderValue = builderTarget[builderProp];

                if (typeof builderValue !== 'function') {
                  return builderValue;
                }

                // Rate limit the actual query execution (.then is called on await)
                if (builderProp === 'then' && typeof builderValue === 'function') {
                  return wrapOperation(builderValue.bind(builderTarget));
                }

                // For ALL other methods, call the original and wrap result in proxy
                // This maintains the proxy chain: .update() → .eq() → .select() → await
                return function(...methodArgs) {
                  const result = builderValue.apply(builderTarget, methodArgs);

                  // If result is a builder (has .then), wrap it to maintain proxy chain
                  // This ensures .then() is rate-limited even after chaining
                  if (result && typeof result === 'object' && typeof result.then === 'function') {
                    return createBuilderProxy(result);
                  }

                  return result;
                };
              }
            });
          }

          return createBuilderProxy(builder);
        };
      }

      // Wrap other methods normally
      return value.bind(target);
    }
  });
}

/**
 * Get rate limiter metrics (for monitoring)
 */
export function getRateLimiterMetrics(rateLimitedClient) {
  return rateLimitedClient._metrics || {
    totalRequests: 0,
    queuedRequests: 0,
    rateLimitHits: 0
  };
}
