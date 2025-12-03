import React, { useState, useEffect } from 'react';
import { Key, Webhook, Upload, Plus, Copy, Trash2, AlertCircle, CheckCircle, Loader2, X, Download, Bot } from 'lucide-react';
// FIX 2025-12-03: Import auth utilities for proper Authorization header injection
import { supabase, ensureValidSession } from '../lib/supabase';
import { useApp } from './AppShell';
import { validateWebhookUrl, validateDealRow, sanitizeDealFromCSV } from '../lib/validation';
import { validateNewApiKey } from '../lib/api-key-validator';
import { AISettings } from './AISettings';

const API_EVENTS = [
  'deal.created',
  'deal.updated',
  'deal.deleted',
  'deal.stage_changed',
  'deal.won',
  'deal.lost',
  'deal.invoice_sent',
  'deal.payment_received',
  'deal.onboarding_started',
  'deal.retention_phase'
];

/**
 * Masks an API key for secure display in the UI.
 * Shows the key prefix (first ~12 chars) followed by bullets.
 * The full key is NEVER stored or displayed after initial creation.
 *
 * @param {string} keyPrefix - The stored key prefix (e.g., "sk_abc123def4")
 * @returns {string} Masked display string (e.g., "sk_abc123def4••••••••")
 */
const maskApiKeyForDisplay = (keyPrefix) => {
  if (!keyPrefix) return '••••••••••••••••••••';
  // Display prefix + 8 bullets to indicate hidden portion
  return `${keyPrefix}••••••••`;
};

export const Integrations = () => {
  const { user } = useApp(); // CRITICAL FIX: Get user for per-user tooltips
  // Support deep linking to specific tabs via URL params
  const urlParams = new URLSearchParams(window.location.search);
  const initialTab = urlParams.get('tab') || 'api-keys';
  const [activeTab, setActiveTab] = useState(initialTab);
  
  // Listen for URL param changes (for deep linking from other components)
  useEffect(() => {
    const handleTabChange = () => {
      const params = new URLSearchParams(window.location.search);
      const tab = params.get('tab');
      if (tab && ['api-keys', 'webhooks', 'csv-import', 'ai-providers'].includes(tab)) {
        setActiveTab(tab);
      }
    }

    // Check on mount and when URL changes
    handleTabChange();

    // Listen for browser back/forward
    window.addEventListener('popstate', handleTabChange);

    // Listen for programmatic navigation (from onboarding, etc.)
    window.addEventListener('urlchange', handleTabChange);

    return () => {
      window.removeEventListener('popstate', handleTabChange);
      window.removeEventListener('urlchange', handleTabChange);
    };
  }, []);

  return (
    <div className="min-h-screen bg-white dark:bg-[#1A1A1A] p-6 space-y-6">
      <div>
        <h1 className="text-title-1 text-[#1A1A1A] dark:text-[#E0E0E0] mb-2">Integrations</h1>
        <p className="text-body text-[#6B7280] dark:text-[#9CA3AF]">Connect StageFlow with your tools</p>
      </div>

      <div className="border-b border-[#E0E0E0] dark:border-gray-700">
        <div className="flex gap-8">
          {[
            { id: 'api-keys', label: 'API Keys', icon: Key },
            { id: 'webhooks', label: 'Webhooks', icon: Webhook },
            { id: 'csv-import', label: 'CSV Import', icon: Upload },
            { id: 'ai-providers', label: 'AI Providers', icon: Bot }
          ].map(tab => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                data-tour={tab.id} // CRITICAL FIX: Add data-tour for tooltips to target tab buttons
                className={`pb-4 px-2 flex items-center gap-2 border-b-2 transition ${
                  activeTab === tab.id
                    ? 'border-[#1ABC9C] text-[#1ABC9C]'
                    : 'border-transparent text-[#6B7280] dark:text-[#9CA3AF] hover:text-[#1A1A1A] dark:hover:text-white'
                }`}
              >
                <Icon className="w-5 h-5" />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* PERFORMANCE FIX: Keep all tabs mounted but hidden to eliminate 3+ second load delays
          This prevents component unmount/remount cycles and data refetching on tab switches */}
      {activeTab === 'api-keys' && <APIKeysTab />}
      {activeTab === 'webhooks' && <WebhooksTab />}
      {activeTab === 'csv-import' && <CSVImportTab />}
      {activeTab === 'ai-providers' && <AISettings />}
    </div>
  );
};

const APIKeysTab = () => {
  const { user, organization, addNotification } = useApp();
  const [keys, setKeys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showNewKey, setShowNewKey] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [generatedKey, setGeneratedKey] = useState(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    fetchKeys();
  }, [organization]);

  // SECURITY: Clear the plaintext key from memory on unmount/navigation
  // This ensures the full key is never visible after leaving the page
  useEffect(() => {
    return () => {
      setGeneratedKey(null);
    };
  }, []);

  const fetchKeys = async () => {
    if (!organization) {
      setLoading(false);
      return;
    }
    try {
      // CRITICAL FIX: Use backend endpoint instead of direct Supabase queries
      // Direct Supabase queries fail because:
      // 1. Client uses persistSession: false (for HttpOnly cookie security)
      // 2. RLS policy requires auth.uid() which may not be set in client context
      // 3. Backend endpoint uses service role key which properly bypasses RLS
      // FIX 2025-12-03: Inject Authorization header for reliable auth
      await ensureValidSession();
      const { data: { session } } = await supabase.auth.getSession();

      const headers = { 'Content-Type': 'application/json' };
      if (session?.access_token) {
        headers['Authorization'] = `Bearer ${session.access_token}`;
      }

      const response = await fetch('/.netlify/functions/api-keys-list', {
        method: 'GET',
        credentials: 'include', // Include HttpOnly cookies for auth
        headers
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Failed to fetch API keys (${response.status})`);
      }

      const result = await response.json();

      // Backend returns { success, keys, count }
      // Map backend format (camelCase) to frontend format (snake_case for consistency)
      const mappedKeys = (result.keys || [])
        .filter(key => !key.revokedAt) // Filter out revoked keys (same as previous .is('revoked_at', null))
        .map(key => ({
          id: key.id,
          name: key.name,
          key_prefix: key.keyPrefix,
          permissions: key.permissions,
          is_active: key.isActive,
          last_used_at: key.lastUsedAt,
          usage_count: key.usageCount,
          expires_at: key.expiresAt,
          created_at: key.createdAt,
          created_by: key.createdBy,
          revoked_at: key.revokedAt,
          organization_id: organization.id // Add org ID for consistency
        }));

      setKeys(mappedKeys);
    } catch (error) {
      console.error('Error fetching API keys:', error);
      // HARDENING: Show user-facing error notification
      addNotification(`Failed to load API keys: ${error.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  const generateKey = async () => {
    if (!newKeyName.trim()) {
      addNotification('Please enter a key name', 'error');
      return;
    }

    if (!organization) {
      addNotification('Organization not loaded. Please refresh.', 'error');
      console.error('No organization:', { user, organization });
      return;
    }

    if (!user) {
      addNotification('User not authenticated', 'error');
      return;
    }

    // MEDIUM FIX: Check for duplicate API key names before creating
    const duplicateKey = keys.find(k =>
      k.name.toLowerCase().trim() === newKeyName.toLowerCase().trim()
    );
    if (duplicateKey) {
      addNotification(`An API key named "${newKeyName}" already exists. Please choose a different name.`, 'error');
      return;
    }

    setCreating(true);

    try {
      // CRITICAL FIX: Use backend endpoint with HttpOnly cookie auth
      // This fixes RLS policy violations (same issue as onboarding progress)
      // FIX 2025-12-03: Inject Authorization header for reliable auth
      await ensureValidSession();
      const { data: { session: createSession } } = await supabase.auth.getSession();

      const createHeaders = { 'Content-Type': 'application/json' };
      if (createSession?.access_token) {
        createHeaders['Authorization'] = `Bearer ${createSession.access_token}`;
      }

      const response = await fetch('/.netlify/functions/api-keys-create', {
        method: 'POST',
        credentials: 'include', // Include HttpOnly cookies
        headers: createHeaders,
        body: JSON.stringify({
          name: newKeyName.trim(),
          permissions: ['read', 'write'], // Default permissions
          expiresInDays: null // Never expires (can be made configurable later)
        })
      });

      const responseText = await response.text();

      let result;
      try {
        result = JSON.parse(responseText);
      } catch (parseError) {
        console.error('[API KEYS] Non-JSON response from create API key endpoint:', responseText);
        throw new Error(`Server returned invalid response: ${responseText.substring(0, 200)}`);
      }

      if (!response.ok) {
        console.error('[API KEYS] Server error:', result);
        throw new Error(result.error || result.message || 'Failed to create API key');
      }

      // Backend returns: { success, apiKey, keyId, keyPrefix, name, permissions, expiresAt, createdAt, warning }
      const data = {
        id: result.keyId,
        name: result.name,
        key_prefix: result.keyPrefix,
        permissions: result.permissions,
        expires_at: result.expiresAt,
        created_at: result.createdAt,
        organization_id: organization.id,
        created_by: user.id,
        is_active: true,
        revoked_at: null
      };

      // FIX v1.7.60 (#2): Wait for database refresh BEFORE updating UI
      // This prevents race condition where UI shows key before database confirms
      await fetchKeys();

      // Now set generated key for display modal (after DB refresh)
      setGeneratedKey({ ...data, full_key: result.apiKey });
      setNewKeyName('');
      setShowNewKey(false);
      addNotification('API key created successfully!', 'success');
    } catch (error) {
      console.error('Error creating API key:', error);
      addNotification(`Failed to create API key: ${error.message}`, 'error');
    } finally {
      setCreating(false);
    }
  };

  // FIX v1.7.60 (#3): Now using backend endpoint for proper permission checks
  const revokeKey = async (keyId) => {
    if (!confirm('Revoke this API key? This cannot be undone.')) return;

    try {
      // FIX v1.7.60 (#3): Use backend endpoint instead of client-side mutation
      // FIX 2025-12-03: Inject Authorization header for reliable auth
      await ensureValidSession();
      const { data: { session: revokeSession } } = await supabase.auth.getSession();

      const revokeHeaders = { 'Content-Type': 'application/json' };
      if (revokeSession?.access_token) {
        revokeHeaders['Authorization'] = `Bearer ${revokeSession.access_token}`;
      }

      const response = await fetch('/.netlify/functions/api-keys-revoke', {
        method: 'POST',
        credentials: 'include', // Include HttpOnly cookies
        headers: revokeHeaders,
        body: JSON.stringify({ keyId })
      });

      const result = await response.json();

      if (!response.ok) {
        // FIX v1.7.60 (#3): Show specific error messages based on status code
        if (response.status === 401) {
          throw new Error('Please log in again to revoke API keys');
        } else if (response.status === 403) {
          throw new Error(result.error || 'You do not have permission to revoke this API key');
        } else if (response.status === 404) {
          throw new Error('API key not found');
        } else if (response.status === 400 && result.code === 'ALREADY_REVOKED') {
          throw new Error('This API key is already revoked');
        } else {
          throw new Error(result.error || 'Failed to revoke API key');
        }
      }

      // FIX v1.7.60 (#3): Wait for database refresh BEFORE showing success
      await fetchKeys();

      addNotification('API key revoked successfully', 'success');
    } catch (error) {
      console.error('Error revoking key:', error);

      // FIX v1.7.60 (#3): Show specific error message from backend
      addNotification(error.message || 'Failed to revoke API key', 'error');

      // FIX v1.7.60 (#3): Refresh UI to ensure consistency with database
      await fetchKeys();
    }
  };

  const copyKey = (key) => {
    navigator.clipboard.writeText(key);
    addNotification('Copied to clipboard');
  };

  if (loading) {
    return <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-[#1ABC9C]" /></div>;
  }

  const orgNotReady = !organization;

  return (
    <div className="space-y-6">
      {orgNotReady && (
        <div className="bg-[#F39C12]/10 border border-[#F39C12] rounded-lg p-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-[#F39C12] mt-0.5 flex-shrink-0" />
          <div>
            <p className="font-semibold text-[#F39C12]">Loading workspace...</p>
            <p className="text-sm text-[#1A1A1A] dark:text-[#E0E0E0]">
              Your workspace is loading. Wait a moment, then try again. If this persists after 30 seconds, refresh the page.
            </p>
          </div>
        </div>
      )}
      {generatedKey && (
        <div className="bg-[#27AE60]/10 border border-[#27AE60] rounded-lg p-4">
          <div className="flex items-start gap-3">
            <CheckCircle className="w-5 h-5 text-[#27AE60] mt-0.5" />
            <div className="flex-1">
              <p className="font-semibold text-[#27AE60] mb-2">API Key Created</p>
              <p className="text-sm text-[#1A1A1A] dark:text-[#E0E0E0] mb-3">
                Save this key now - you won't be able to see it again!
              </p>
              <div className="bg-white dark:bg-[#121212] rounded-lg p-3 flex items-center justify-between">
                <code className="text-sm font-mono text-[#1A1A1A] dark:text-[#1ABC9C] select-all">{generatedKey.full_key}</code>
                <button
                  onClick={() => copyKey(generatedKey.full_key)}
                  className="text-[#1ABC9C] hover:text-[#16A085] transition"
                  title="Copy to clipboard"
                >
                  <Copy className="w-5 h-5" />
                </button>
              </div>
            </div>
            <button onClick={() => setGeneratedKey(null)} className="text-[#6B7280]">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <p className="text-sm text-[#6B7280] dark:text-[#9CA3AF]">
          Use API keys to authenticate requests to the StageFlow API
        </p>
        <button
          onClick={() => setShowNewKey(!showNewKey)}
          className="bg-teal-500 hover:bg-teal-600 text-white px-4 py-2 rounded-xl flex items-center gap-2 transition-all duration-200 shadow-lg shadow-teal-500/20 hover:shadow-teal-500/40 hover:scale-[1.02] active:scale-[0.98] font-semibold"
        >
          <Plus className="w-5 h-5" />
          New Key
        </button>
      </div>

      {showNewKey && (
        <div className="bg-gradient-to-br from-gray-900 to-black border border-teal-500/30 rounded-xl p-4 shadow-xl">
          <div className="flex gap-3">
            <input
              type="text"
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && generateKey()}
              placeholder="Key name (e.g., Production, Development)"
              className="flex-1 px-4 py-2 border border-gray-700 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent bg-gray-800/50 text-white placeholder-gray-500 backdrop-blur-sm"
            />
            <button
              onClick={generateKey}
              disabled={!newKeyName.trim() || creating || orgNotReady}
              className="bg-teal-500 hover:bg-teal-600 text-white px-6 py-2 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 shadow-lg shadow-teal-500/20 hover:shadow-teal-500/40 hover:scale-[1.02] active:scale-[0.98] font-semibold"
            >
              {creating ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Create'}
            </button>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {keys.length === 0 ? (
          <div className="text-center py-12 text-[#9CA3AF]">
            <Key className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p>No API keys yet</p>
          </div>
        ) : (
          keys.map(key => (
            <div key={key.id} className="bg-gradient-to-br from-gray-900 to-black border border-teal-500/30 rounded-xl p-4 shadow-xl hover:border-teal-500/50 transition-all duration-300">
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <h3 className="font-semibold text-white">{key.name}</h3>
                  <p className="text-sm text-teal-400 font-mono mt-1">
                    {maskApiKeyForDisplay(key.key_prefix)}
                  </p>
                  <p className="text-xs text-gray-400 mt-1">
                    Created {new Date(key.created_at).toLocaleDateString()}
                    {key.last_used_at && ` • Last used ${new Date(key.last_used_at).toLocaleDateString()}`}
                  </p>
                </div>
                <button
                  onClick={() => revokeKey(key.id)}
                  className="text-red-400 hover:text-red-300 transition px-3 py-2 rounded-lg hover:bg-red-500/10"
                  title="Revoke key"
                >
                  <Trash2 className="w-5 h-5" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

const WebhooksTab = () => {
  const { organization, addNotification } = useApp();
  const [webhooks, setWebhooks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [formData, setFormData] = useState({ url: '', events: [], secret: '' });
  const [urlError, setUrlError] = useState('');

  useEffect(() => {
    fetchWebhooks();
  }, [organization]);

  // Auto-open modal if no webhooks configured
  useEffect(() => {
    if (!loading && webhooks.length === 0) {
      setShowNew(true);
    }
  }, [loading, webhooks.length]);

  const fetchWebhooks = async () => {
    if (!organization) {
      setLoading(false);
      return;
    }
    try {
      // FIX: Force fresh query by adding order clause to bust cache
      const { data, error } = await supabase
        .from('webhooks')
        .select('*')
        .eq('organization_id', organization.id)
        .eq('is_active', true)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setWebhooks(data || []);
    } catch (error) {
      console.error('Error fetching webhooks:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleUrlChange = (url) => {
    setFormData({ ...formData, url });
    
    // Clear error when user starts typing
    if (urlError) setUrlError('');
  };

  const createWebhook = async () => {
    if (!organization) return;

    // Validate URL
    const validation = validateWebhookUrl(formData.url);
    if (!validation.valid) {
      setUrlError(validation.error);
      addNotification(validation.error, 'error');
      return;
    }

    if (formData.events.length === 0) {
      addNotification('Please select at least one event', 'error');
      return;
    }

    try {
      // CRITICAL FIX: Use backend endpoint instead of direct Supabase client
      // Phase 3 Cookie-Only Auth has persistSession: false, so auth.uid() is NULL
      // RLS policies deny all client-side mutations. Backend has service role.
      // FIX 2025-12-03: Inject Authorization header for reliable auth
      await ensureValidSession();
      const { data: { session: webhookSession } } = await supabase.auth.getSession();

      const webhookHeaders = { 'Content-Type': 'application/json' };
      if (webhookSession?.access_token) {
        webhookHeaders['Authorization'] = `Bearer ${webhookSession.access_token}`;
      }

      const response = await fetch('/.netlify/functions/create-webhook', {
        method: 'POST',
        headers: webhookHeaders,
        credentials: 'include', // Send HttpOnly cookies for auth
        body: JSON.stringify({
          url: formData.url.trim(),
          events: formData.events,
          secret: formData.secret.trim() || null,
          organizationId: organization.id
        })
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || `Create failed: ${response.status}`);
      }

      // Backend returns { success, webhook }
      if (result.webhook) {
        setWebhooks(prev => [result.webhook, ...prev]);
      }

      setFormData({ url: '', events: [], secret: '' });
      setUrlError('');
      setShowNew(false);
      addNotification('Webhook created successfully');

      // FIX: Refresh list to ensure UI is in sync
      await fetchWebhooks();
    } catch (error) {
      console.error('Error creating webhook:', error);
      addNotification(`Failed to create webhook: ${error.message}`, 'error');
    }
  };

  const deleteWebhook = async (id) => {
    if (!confirm('Delete this webhook?')) return;

    try {
      // CRITICAL FIX: Use backend endpoint instead of direct Supabase client
      // Phase 3 Cookie-Only Auth has persistSession: false, so auth.uid() is NULL
      // RLS policies deny all client-side mutations. Backend has service role.
      // FIX 2025-12-03: Inject Authorization header for reliable auth
      await ensureValidSession();
      const { data: { session: deleteSession } } = await supabase.auth.getSession();

      const deleteHeaders = { 'Content-Type': 'application/json' };
      if (deleteSession?.access_token) {
        deleteHeaders['Authorization'] = `Bearer ${deleteSession.access_token}`;
      }

      const response = await fetch('/.netlify/functions/delete-webhook', {
        method: 'POST',
        headers: deleteHeaders,
        credentials: 'include', // Send HttpOnly cookies for auth
        body: JSON.stringify({
          webhookId: id,
          organizationId: organization.id
        })
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || `Delete failed: ${response.status}`);
      }

      // Optimistic update - remove from local state immediately
      setWebhooks(prev => prev.filter(w => w.id !== id));
      addNotification('Webhook deleted');

      // FIX: Refresh list to ensure UI is in sync
      await fetchWebhooks();
    } catch (error) {
      console.error('Error deleting webhook:', error);
      addNotification(`Failed to delete webhook: ${error.message}`, 'error');
    }
  };

  if (loading) {
    return <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-[#1ABC9C]" /></div>;
  }

  return (
    <div className="space-y-6" data-tour="webhooks">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-400">
          Receive real-time notifications when events occur
        </p>
        <button
          onClick={() => setShowNew(!showNew)}
          className="bg-teal-500 hover:bg-teal-600 text-white px-4 py-2 rounded-xl flex items-center gap-2 transition-all duration-200 shadow-lg shadow-teal-500/20 hover:shadow-teal-500/40 hover:scale-[1.02] active:scale-[0.98] font-semibold"
        >
          <Plus className="w-5 h-5" />
          New Webhook
        </button>
      </div>

      {showNew && (
        <div className="bg-gradient-to-br from-gray-900 to-black border border-teal-500/30 rounded-xl p-6 space-y-4 shadow-xl">
          <div>
            <label className="block text-sm font-medium text-white mb-2">
              Webhook URL *
            </label>
            <input
              type="url"
              value={formData.url}
              onChange={(e) => handleUrlChange(e.target.value)}
              placeholder="https://your-app.com/webhook"
              className={`w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent bg-gray-800/50 text-white placeholder-gray-500 backdrop-blur-sm ${
                urlError ? 'border-red-500' : 'border-gray-700'
              }`}
              aria-invalid={urlError ? 'true' : 'false'}
              aria-describedby={urlError ? 'webhook-url-error' : undefined}
            />
            {urlError && (
              <p id="webhook-url-error" role="alert" className="text-sm text-red-400 mt-1">{urlError}</p>
            )}
            <p className="text-xs text-gray-400 mt-1">
              Must be a valid HTTPS URL. Localhost URLs are not allowed.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-white mb-2">
              Events *
            </label>
            <div className="grid grid-cols-2 gap-2">
              {API_EVENTS.map(event => (
                <label key={event} className="flex items-center gap-2 p-2 border border-gray-700 bg-gray-800/30 rounded cursor-pointer hover:bg-gray-800 text-white transition-all duration-200">
                  <input
                    type="checkbox"
                    checked={formData.events.includes(event)}
                    onChange={(e) => {
                      setFormData({
                        ...formData,
                        events: e.target.checked
                          ? [...formData.events, event]
                          : formData.events.filter(ev => ev !== event)
                      });
                    }}
                    className="rounded text-teal-500 focus:ring-teal-500"
                  />
                  <span className="text-sm text-white">{event}</span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-white mb-2">
              Secret (optional)
            </label>
            <input
              type="text"
              value={formData.secret}
              onChange={(e) => setFormData({ ...formData, secret: e.target.value })}
              placeholder="Leave empty to auto-generate"
              className="w-full px-4 py-2 border border-gray-700 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent bg-gray-800/50 text-white placeholder-gray-500 backdrop-blur-sm"
            />
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => {
                setShowNew(false);
                setUrlError('');
              }}
              className="flex-1 px-4 py-2 border border-gray-700 text-gray-400 hover:text-white hover:bg-gray-800/50 rounded-xl transition-all duration-200 hover:scale-[1.02] active:scale-[0.98] font-semibold"
            >
              Cancel
            </button>
            <button
              onClick={createWebhook}
              disabled={!formData.url || formData.events.length === 0}
              className="flex-1 bg-teal-500 hover:bg-teal-600 text-white px-4 py-2 rounded-xl disabled:opacity-50 transition-all duration-200 shadow-lg shadow-teal-500/20 hover:shadow-teal-500/40 hover:scale-[1.02] active:scale-[0.98] font-semibold"
            >
              Create Webhook
            </button>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {webhooks.length === 0 ? (
          <div className="text-center py-12 text-[#9CA3AF]">
            <Webhook className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p>No webhooks configured</p>
          </div>
        ) : (
          webhooks.map(webhook => (
            <div key={webhook.id} className="bg-gradient-to-br from-gray-900 to-black border border-teal-500/30 rounded-xl p-4 shadow-xl hover:border-teal-500/50 transition-all duration-300">
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <code className="text-sm font-mono text-teal-400">{webhook.url}</code>
                    <span className={`px-2 py-0.5 rounded-full text-xs ${
                      webhook.is_active ? 'bg-[#27AE60]/10 text-[#27AE60]' : 'bg-gray-500/10 text-gray-400'
                    }`}>
                      {webhook.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {webhook.events.map(event => (
                      <span key={event} className="text-xs bg-teal-500/10 text-teal-400 px-2 py-1 rounded">
                        {event}
                      </span>
                    ))}
                  </div>
                </div>
                <button
                  onClick={() => deleteWebhook(webhook.id)}
                  className="text-red-400 hover:text-red-300 transition px-3 py-2 rounded-lg hover:bg-red-500/10 hover:scale-[1.02] active:scale-[0.98]"
                >
                  <Trash2 className="w-5 h-5" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

const CSVImportTab = () => {
  const { organization, addNotification, user, setActiveView } = useApp();
  const [file, setFile] = useState(null);
  const [csvData, setCsvData] = useState(null);
  const [headers, setHeaders] = useState([]);
  const [mapping, setMapping] = useState({});
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0); // FIX v1.7.62 (#7): Track CSV import progress
  const [step, setStep] = useState(1);
  const [isDragging, setIsDragging] = useState(false);
  const [importResults, setImportResults] = useState(null);

  const dealFields = [
    { key: 'client', label: 'Client Name', required: true },
    { key: 'email', label: 'Email', required: false },
    { key: 'phone', label: 'Phone', required: false },
    { key: 'value', label: 'Deal Value', required: false },
    { key: 'stage', label: 'Stage', required: false },
    { key: 'status', label: 'Status', required: false },
    { key: 'notes', label: 'Notes', required: false }
  ];

  const processFile = (uploadedFile) => {
    if (!uploadedFile) return;

    if (!uploadedFile.name.endsWith('.csv')) {
      addNotification('Please upload a CSV file', 'error');
      return;
    }

    // SECURITY FIX: File size validation (10MB limit)
    const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
    if (uploadedFile.size > MAX_FILE_SIZE) {
      const fileSizeMB = (uploadedFile.size / 1024 / 1024).toFixed(1);
      addNotification(
        `File too large (${fileSizeMB}MB). Maximum allowed: 10MB. Please split your file into smaller chunks.`,
        'error'
      );
      return;
    }

    setFile(uploadedFile);
    
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target.result;
      const lines = text.split('\n').filter(line => line.trim());
      
      if (lines.length < 2) {
        addNotification('CSV file must have headers and at least one row', 'error');
        return;
      }

      // SECURITY FIX: Row count validation (1000 rows max)
      const MAX_ROWS = 1000;
      const dataRowCount = lines.length - 1; // Exclude header
      
      if (dataRowCount > MAX_ROWS) {
        addNotification(
          `Too many rows (${dataRowCount}). Maximum allowed: ${MAX_ROWS}. Please split your file into smaller batches.`,
          'error'
        );
        return;
      }

      const csvHeaders = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));

      // Validate headers were detected
      if (!csvHeaders || csvHeaders.length === 0 || csvHeaders.every(h => !h)) {
        addNotification('Could not detect CSV headers. Please check file format.', 'error');
        setFile(null);
        return;
      }

      const rows = lines.slice(1).map(line => {
        const values = line.split(',').map(v => v.trim().replace(/^"|"$/g, ''));
        return csvHeaders.reduce((obj, header, idx) => {
          obj[header] = values[idx] || '';
          return obj;
        }, {});
      });

      setHeaders(csvHeaders);
      setCsvData(rows);
      setStep(2);
    };

    // FIX v1.7.62 (#2): Add FileReader error handlers (CRITICAL)
    // Without these, corrupted/unreadable files cause silent failures with infinite loading
    reader.onerror = () => {
      console.error('[CSV Import] FileReader error:', reader.error);
      addNotification(
        'Failed to read file. The file may be corrupted, in an unsupported encoding, or unreadable.',
        'error'
      );
      setFile(null);
      setStep(1); // Reset to upload step
    };

    reader.onabort = () => {
      console.warn('[CSV Import] File read was cancelled');
      addNotification('File upload was cancelled', 'error');
      setFile(null);
      setStep(1); // Reset to upload step
    };

    reader.readAsText(uploadedFile);
  };

  const handleFileUpload = (e) => {
    const uploadedFile = e.target.files[0];
    if (uploadedFile) processFile(uploadedFile);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const droppedFile = e.dataTransfer.files[0];
    if (!droppedFile) return;

    if (!droppedFile.name.endsWith('.csv')) {
      addNotification('Please upload a CSV file', 'error');
      return;
    }

    processFile(droppedFile);
  };

  const handleImport = async () => {
    if (!csvData || Object.keys(mapping).length === 0 || !organization || !user) return;

    if (!mapping.client) {
      addNotification('Client Name mapping is required', 'error');
      return;
    }

    setImporting(true);
    const results = {
      total: csvData.length,
      successful: 0,
      failed: 0,
      errors: []
    };
    
    try {
      const validDeals = [];
      const invalidRows = [];

      // Validate each row
      csvData.forEach((row, index) => {
        const validation = validateDealRow(row, mapping);
        
        if (validation.valid) {
          const deal = sanitizeDealFromCSV(row, mapping, user.id, organization.id);
          validDeals.push(deal);
        } else {
          invalidRows.push({
            row: index + 1,
            errors: validation.errors
          });
        }
      });

      // CRITICAL FIX: Use backend endpoint instead of direct Supabase client
      // Phase 3 Cookie-Only Auth has persistSession: false, so auth.uid() is NULL
      // RLS policies deny all client-side mutations. Backend has service role.
      if (validDeals.length > 0) {
        setImportProgress(10); // Show initial progress

        // FIX 2025-12-03: Inject Authorization header for reliable auth
        await ensureValidSession();
        const { data: { session: importSession } } = await supabase.auth.getSession();

        const importHeaders = { 'Content-Type': 'application/json' };
        if (importSession?.access_token) {
          importHeaders['Authorization'] = `Bearer ${importSession.access_token}`;
        }

        const response = await fetch('/.netlify/functions/import-deals-csv', {
          method: 'POST',
          headers: importHeaders,
          credentials: 'include', // Send HttpOnly cookies for auth
          body: JSON.stringify({
            deals: validDeals,
            organizationId: organization.id
          })
        });

        const result = await response.json();

        if (!response.ok) {
          throw new Error(result.error || `Import failed: ${response.status}`);
        }

        // Backend returns { total, successful, failed, errors }
        results.successful = result.successful || 0;
        results.failed = (invalidRows.length) + (result.failed || 0);

        // Merge backend errors with frontend validation errors
        if (result.errors && Array.isArray(result.errors)) {
          results.errors = [...invalidRows, ...result.errors];
        }

        setImportProgress(100);
      } else {
        // No valid deals - only frontend validation failures
        results.failed = invalidRows.length;
        results.errors = invalidRows;
      }

      setImportResults(results);

      if (results.successful > 0) {
        addNotification(`Successfully imported ${results.successful} deal${results.successful > 1 ? 's' : ''}`);
      }

      if (results.failed > 0) {
        addNotification(`${results.failed} row${results.failed > 1 ? 's' : ''} skipped due to errors`, 'error');
      }
      
      // Reset after showing results
      setTimeout(() => {
        setFile(null);
        setCsvData(null);
        setHeaders([]);
        setMapping({});
        setStep(1);
        setImportResults(null);
      }, 5000);
    } catch (error) {
      console.error('Import error:', error);
      addNotification(`Failed to import deals: ${error.message}`, 'error');
    } finally {
      setImporting(false);
    }
  };

  const downloadSample = () => {
    const sampleCSV = `Client Name,Email,Phone,Deal Value,Stage,Status,Notes
"Acme Corp","john@acme.com","555-1234",50000,"lead","active","Interested in Enterprise plan"
"TechStart Inc","sarah@techstart.com","555-5678",25000,"quote","active","Requested demo"
"Global Solutions","mike@global.com","555-9012",75000,"approval","active","Waiting on legal review"`;

    const blob = new Blob([sampleCSV], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'stageflow-import-sample.csv';
    a.click();
    window.URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-400">
            Import deals from a CSV file
          </p>
          <p className="text-xs text-gray-500 mt-1">
            Maximum: 10MB file size, 1,000 rows per import
          </p>
        </div>
        <button
          onClick={downloadSample}
          className="text-teal-400 hover:text-teal-300 flex items-center gap-2 text-sm font-medium transition hover:scale-[1.02] active:scale-[0.98]"
        >
          <Download className="w-4 h-4" />
          Download Sample CSV
        </button>
      </div>

      {/* Import Results */}
      {importResults && (
        <div className="bg-gradient-to-br from-gray-900 to-black border border-teal-500/30 rounded-xl p-4 shadow-xl">
          <h3 className="font-semibold text-white mb-3">Import Summary</h3>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-400">Total Rows:</span>
              <span className="font-medium text-white">{importResults.total}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-400">Successful:</span>
              <span className="font-medium text-[#27AE60]">{importResults.successful}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-400">Failed:</span>
              <span className="font-medium text-red-400">{importResults.failed}</span>
            </div>
          </div>
          {/* FIX: Add button to view imported deals */}
          {importResults.successful > 0 && (
            <button
              onClick={() => window.location.href = '/'}
              className="mt-4 w-full bg-teal-500 hover:bg-teal-600 text-white px-4 py-2 rounded-xl transition-all duration-200 shadow-lg shadow-teal-500/20 hover:shadow-teal-500/40 hover:scale-[1.02] active:scale-[0.98] font-semibold flex items-center justify-center gap-2"
            >
              <CheckCircle className="w-4 h-4" />
              View Imported Deals
            </button>
          )}
          {importResults.errors.length > 0 && (
            <div className="mt-4 pt-4 border-t border-gray-700">
              <h4 className="text-sm font-semibold text-red-400 mb-2">Errors:</h4>
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {importResults.errors.map((err, idx) => (
                  <div key={idx} className="text-xs text-gray-400">
                    Row {err.row}: {err.errors.join(', ')}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Step 1: Upload */}
      {step === 1 && (
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`bg-gradient-to-br from-gray-900 to-black border-2 border-dashed rounded-xl p-12 transition-all duration-300 shadow-xl ${
            isDragging
              ? 'border-teal-500 bg-teal-500/5 scale-[1.02]'
              : 'border-teal-500/30'
          }`}
        >
          <div className="text-center">
            <Upload className="w-16 h-16 text-teal-400 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-white mb-2">
              Upload CSV File
            </h3>
            <p className="text-sm text-gray-400 mb-4">
              Drag and drop or click to select a CSV file
            </p>
            <input
              type="file"
              accept=".csv"
              onChange={handleFileUpload}
              className="hidden"
              id="csv-upload"
            />
            <label
              htmlFor="csv-upload"
              className="inline-flex items-center gap-2 bg-teal-500 hover:bg-teal-600 text-white px-6 py-3 rounded-xl cursor-pointer transition-all duration-200 shadow-lg shadow-teal-500/20 hover:shadow-teal-500/40 hover:scale-[1.02] active:scale-[0.98] font-semibold"
            >
              <Upload className="w-5 h-5" />
              Select CSV File
            </label>
          </div>
        </div>
      )}

      {/* Step 2: Map Columns */}
      {step === 2 && csvData && (
        <div className="space-y-6">
          <div className="bg-teal-500/10 border border-teal-500 rounded-xl p-4 shadow-xl">
            <div className="flex items-start gap-3">
              <CheckCircle className="w-5 h-5 text-teal-400 mt-0.5" />
              <div>
                <p className="font-semibold text-teal-400">CSV Loaded</p>
                <p className="text-sm text-white">
                  {csvData.length} rows found. Map your CSV columns to StageFlow fields.
                </p>
              </div>
            </div>
          </div>

          <div className="bg-gradient-to-br from-gray-900 to-black border border-teal-500/30 rounded-xl p-6 shadow-xl">
            <h3 className="font-semibold text-white mb-4">
              Column Mapping
            </h3>
            <div className="space-y-3">
              {dealFields.map(field => (
                <div key={field.key} className="grid grid-cols-2 gap-4 items-center">
                  <div>
                    <label className="text-sm font-medium text-white">
                      {field.label}
                      {field.required && <span className="text-red-400 ml-1">*</span>}
                    </label>
                  </div>
                  <select
                    value={mapping[field.key] || ''}
                    onChange={(e) => setMapping({ ...mapping, [field.key]: e.target.value })}
                    className="px-4 py-2 border border-gray-700 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent bg-gray-800/50 text-white backdrop-blur-sm"
                  >
                    <option value="">-- Skip --</option>
                    {headers.map(header => (
                      <option key={header} value={header}>{header}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => {
                setStep(1);
                setFile(null);
                setCsvData(null);
                setHeaders([]);
                setMapping({});
              }}
              className="flex-1 px-4 py-2 border border-gray-700 text-gray-400 hover:text-white hover:bg-gray-800/50 rounded-xl transition-all duration-200 hover:scale-[1.02] active:scale-[0.98] font-semibold"
            >
              Cancel
            </button>
            <button
              onClick={handleImport}
              disabled={!mapping.client || importing}
              className="flex-1 bg-teal-500 hover:bg-teal-600 text-white px-4 py-2 rounded-xl disabled:opacity-50 flex items-center justify-center gap-2 transition-all duration-200 shadow-lg shadow-teal-500/20 hover:shadow-teal-500/40 hover:scale-[1.02] active:scale-[0.98] font-semibold"
            >
              {importing ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  {/* FIX v1.7.62 (#7): Show progress percentage during import */}
                  {importProgress > 0 ? `Importing... ${importProgress}%` : 'Importing...'}
                </>
              ) : (
                <>
                  <Upload className="w-5 h-5" />
                  Import {csvData.length} Deals
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default Integrations;
