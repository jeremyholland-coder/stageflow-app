/**
 * Unified Data Prefetcher
 *
 * Centralized prefetch manager for navigation targets. All AI provider reads
 * flow through backend service functions (no direct Supabase table reads),
 * and logging is trimmed to warn/error in production.
 */

import { supabase } from './supabase';
import { getCurrentNetworkQuality } from './network-quality';
import { logger } from './logger';

const CACHE_TTLS = {
  aiProviders: 10 * 60 * 1000, // 10 minutes
  readiness: 30 * 1000,        // 30 seconds
  billing: 30 * 1000,          // 30 seconds
  teamMembers: 5 * 60 * 1000,  // 5 minutes
  settings: 10 * 60 * 1000     // 10 minutes
};

const isBrowser = typeof window !== 'undefined';

const isTabVisible = () => {
  if (!isBrowser) return false;
  return document.visibilityState === 'visible';
};

const hasStrongConnection = () => {
  if (!isBrowser) return false;

  const networkQuality = getCurrentNetworkQuality();
  if (networkQuality === 'poor' || networkQuality === 'offline') {
    return false;
  }

  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if (connection?.effectiveType && !['4g', '5g'].includes(connection.effectiveType)) {
    return false;
  }

  return true;
};

const scheduleIdle = (task) => {
  if (!isBrowser) return;

  if ('requestIdleCallback' in window) {
    requestIdleCallback(
      () => task().catch((err) => console.warn('[Prefetch] idle task failed', err)),
      { timeout: 1500 }
    );
  } else {
    setTimeout(() => {
      task().catch((err) => console.warn('[Prefetch] deferred task failed', err));
    }, 100);
  }
};

async function buildAuthHeaders() {
  const headers = { 'Content-Type': 'application/json' };

  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) {
      headers.Authorization = `Bearer ${session.access_token}`;
    }
  } catch (error) {
    // Warn in dev only; callers will still attempt without auth header
    logger.warn('[Prefetch] Unable to read session for headers', error);
  }

  return headers;
}

class DataPrefetcher {
  constructor() {
    this.prefetchCache = new Map();
  }

  shouldPrefetch(cacheKey, type) {
    const cached = this.prefetchCache.get(cacheKey);
    if (!cached) return true;

    const ttl = CACHE_TTLS[type] || 5 * 60 * 1000;
    return Date.now() - cached.timestamp > ttl;
  }

  markPrefetched(cacheKey, type) {
    this.prefetchCache.set(cacheKey, {
      timestamp: Date.now(),
      type
    });
  }

  async prefetchAIProviders(orgId) {
    if (!orgId) return;

    const cacheKey = `ai-providers:${orgId}`;
    if (!this.shouldPrefetch(cacheKey, 'aiProviders')) return;

    try {
      const headers = await buildAuthHeaders();
      const response = await fetch('/.netlify/functions/get-ai-providers', {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify({ organization_id: orgId })
      });

      if (!response.ok) {
        console.warn(`[Prefetch] AI providers request failed: ${response.status}`);
        return;
      }

      await response.json();
      this.markPrefetched(cacheKey, 'aiProviders');
      if (import.meta.env.DEV) {
        logger.log('[Prefetch] Cached AI providers');
      }
    } catch (error) {
      console.warn('[Prefetch] AI providers prefetch failed:', error);
    }
  }

  async prefetchAIReadiness(orgId) {
    if (!orgId) return;

    const cacheKey = `ai-readiness:${orgId}`;
    if (!this.shouldPrefetch(cacheKey, 'readiness')) return;

    try {
      const headers = await buildAuthHeaders();
      const response = await fetch('/.netlify/functions/ai-readiness', {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify({ organization_id: orgId })
      });

      if (!response.ok) {
        console.warn(`[Prefetch] AI readiness request failed: ${response.status}`);
        return;
      }

      await response.json();
      this.markPrefetched(cacheKey, 'readiness');
      if (import.meta.env.DEV) {
        logger.log('[Prefetch] Cached AI readiness');
      }
    } catch (error) {
      console.warn('[Prefetch] AI readiness prefetch failed:', error);
    }
  }

  async prefetchBilling(orgId) {
    if (!orgId) return;

    const cacheKey = `billing:${orgId}`;
    if (!this.shouldPrefetch(cacheKey, 'billing')) return;

    try {
      const { data, error } = await supabase
        .from('organizations')
        .select('subscription_tier, trial_ends_at, stripe_customer_id')
        .eq('id', orgId)
        .maybeSingle();

      if (error) {
        console.warn('[Prefetch] Billing prefetch failed:', error.message);
        return;
      }

      if (data) {
        this.markPrefetched(cacheKey, 'billing');
        if (import.meta.env.DEV) {
          logger.log('[Prefetch] Cached billing');
        }
      }
    } catch (error) {
      console.warn('[Prefetch] Billing prefetch failed:', error);
    }
  }

  async prefetchTeamMembers(orgId) {
    if (!orgId) return;

    const cacheKey = `team:${orgId}`;
    if (!this.shouldPrefetch(cacheKey, 'teamMembers')) return;

    try {
      const { data, error } = await supabase
        .from('team_members')
        .select('*, users(id, email, display_name)')
        .eq('organization_id', orgId);

      if (error) {
        console.warn('[Prefetch] Team prefetch failed:', error.message);
        return;
      }

      if (data) {
        this.markPrefetched(cacheKey, 'teamMembers');
        if (import.meta.env.DEV) {
          logger.log('[Prefetch] Cached team members');
        }
      }
    } catch (error) {
      console.warn('[Prefetch] Team prefetch failed:', error);
    }
  }

  async prefetchView(viewName, context = {}) {
    const { orgId, userRole } = context;
    if (!hasStrongConnection()) {
      if (import.meta.env.DEV) {
        logger.debug('[Prefetch] Skipping view prefetch on weak connection');
      }
      return;
    }

    switch (viewName) {
      case 'dashboard':
        await Promise.all([
          this.prefetchAIProviders(orgId),
          this.prefetchAIReadiness(orgId)
        ]);
        break;
      case 'integrations':
      case 'ai-settings':
        await this.prefetchAIProviders(orgId);
        break;
      case 'billing':
        await this.prefetchBilling(orgId);
        break;
      case 'team':
        if (userRole === 'admin' || userRole === 'owner') {
          await this.prefetchTeamMembers(orgId);
        }
        break;
      default:
        if (import.meta.env.DEV) {
          logger.debug('[Prefetch] Unknown view prefetch requested:', viewName);
        }
        break;
    }
  }

  async prefetchNavigation(user, organization) {
    if (!user || !organization) return;
    if (!isTabVisible() || !hasStrongConnection()) {
      if (import.meta.env.DEV) {
        logger.debug('[Prefetch] Skipping navigation prefetch (invisible tab or weak network)');
      }
      return;
    }

    // Run lightweight tasks during idle time to avoid jank
    scheduleIdle(() => this.prefetchAIProviders(organization.id));
    scheduleIdle(() => this.prefetchAIReadiness(organization.id));

    if (organization.subscription_tier === 'free' || organization.trial_ends_at) {
      scheduleIdle(() => this.prefetchBilling(organization.id));
    }

    if (user.role === 'admin' || user.role === 'owner') {
      scheduleIdle(() => this.prefetchTeamMembers(organization.id));
    }
  }

  clearCache() {
    this.prefetchCache.clear();
  }

  getStats() {
    return {
      cachedEntries: this.prefetchCache.size,
      cacheKeys: Array.from(this.prefetchCache.keys())
    };
  }
}

export const dataPrefetcher = new DataPrefetcher();

export const prefetchNavigation = (user, org) => dataPrefetcher.prefetchNavigation(user, org);
export const prefetchView = (view, context) => dataPrefetcher.prefetchView(view, context);

export default dataPrefetcher;
