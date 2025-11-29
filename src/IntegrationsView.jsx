import React, { useState, useEffect } from 'react';
import { Key, Webhook, Zap, MessageSquare, Mail, Calendar, DollarSign, Users, Plus, Copy, X, Loader2, Check } from 'lucide-react';
import { supabase } from './lib/supabase'; // CRITICAL FIX: Use shared client to preserve session

const IntegrationsView = ({ organization, userRole, addNotification }) => {
  const [activeTab, setActiveTab] = useState('keys');
  const [apiKeys, setApiKeys] = useState([]);
  const [webhooks, setWebhooks] = useState([]);
  const [deliveries, setDeliveries] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showCreateKey, setShowCreateKey] = useState(false);
  const [showCreateWebhook, setShowCreateWebhook] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [generatedKey, setGeneratedKey] = useState(null);
  const [selectedWebhook, setSelectedWebhook] = useState(null);

  const [webhookForm, setWebhookForm] = useState({
    url: '',
    events: [],
    secret: ''
  });

  const webhookEvents = [
    'deal.created', 'deal.updated', 'deal.deleted',
    'deal.stage_changed', 'deal.won', 'deal.lost'
  ];

  useEffect(() => {
    if (organization) {
      fetchApiKeys();
      fetchWebhooks();
    }
  }, [organization]);

  useEffect(() => {
    if (selectedWebhook) {
      fetchWebhookDeliveries(selectedWebhook);
    }
  }, [selectedWebhook]);

  const fetchApiKeys = async () => {
    try {
      const { data, error } = await supabase
        .from('api_keys')
        .select('*')
        .eq('organization_id', organization.id)
        .is('revoked_at', null)
        .order('created_at', { ascending: false });
      if (error) throw error;
      setApiKeys(data || []);
    } catch (error) {
      console.error('Error fetching API keys:', error);
    }
  };

  const fetchWebhooks = async () => {
    try {
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
    }
  };

  const fetchWebhookDeliveries = async (webhookId) => {
    try {
      const { data, error } = await supabase
        .from('webhook_deliveries')
        .select('*')
        .eq('webhook_id', webhookId)
        .order('delivered_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      setDeliveries(data || []);
    } catch (error) {
      console.error('Error fetching webhook deliveries:', error);
    }
  };

  const createApiKey = async () => {
    if (!newKeyName.trim()) {
      addNotification('Please enter a key name', 'error');
      return;
    }

    try {
      setLoading(true);
      const key = `sk_${Math.random().toString(36).substring(2)}${Date.now().toString(36)}`;
      const keyHash = btoa(key);
      const keyPrefix = key.substring(0, 12);

      const { error } = await supabase
        .from('api_keys')
        .insert([{
          organization_id: organization.id,
          name: newKeyName,
          key_hash: keyHash,
          key_prefix: keyPrefix,
          created_by: (await supabase.auth.getUser()).data.user.id
        }]);

      if (error) throw error;

      setGeneratedKey(key);
      addNotification('API key created');
      fetchApiKeys();
      setNewKeyName('');
      setShowCreateKey(false);
    } catch (error) {
      console.error('Error creating API key:', error);
      addNotification('Failed to create API key', 'error');
    } finally {
      setLoading(false);
    }
  };

  const revokeApiKey = async (keyId) => {
    if (!window.confirm('Revoke this API key? This action cannot be undone.')) return;

    try {
      setLoading(true);
      const { error } = await supabase
        .from('api_keys')
        .update({ revoked_at: new Date().toISOString() })
        .eq('id', keyId);
      if (error) throw error;
      addNotification('API key revoked');
      fetchApiKeys();
    } catch (error) {
      console.error('Error revoking API key:', error);
      addNotification('Failed to revoke API key', 'error');
    } finally {
      setLoading(false);
    }
  };

  const createWebhook = async () => {
    if (!webhookForm.url.trim()) {
      addNotification('Please enter a webhook URL', 'error');
      return;
    }
    if (webhookForm.events.length === 0) {
      addNotification('Please select at least one event', 'error');
      return;
    }

    try {
      setLoading(true);
      const secret = webhookForm.secret || `whsec_${Math.random().toString(36).substring(2)}`;

      const { error } = await supabase
        .from('webhooks')
        .insert([{
          organization_id: organization.id,
          url: webhookForm.url,
          events: webhookForm.events,
          secret: secret,
          is_active: true
        }]);

      if (error) throw error;

      addNotification('Webhook created');
      fetchWebhooks();
      setWebhookForm({ url: '', events: [], secret: '' });
      setShowCreateWebhook(false);
    } catch (error) {
      console.error('Error creating webhook:', error);
      addNotification('Failed to create webhook', 'error');
    } finally {
      setLoading(false);
    }
  };

  const deleteWebhook = async (webhookId) => {
    if (!window.confirm('Delete this webhook? This action cannot be undone.')) return;

    try {
      setLoading(true);
      const { error } = await supabase
        .from('webhooks')
        .update({ is_active: false })
        .eq('id', webhookId);
      if (error) throw error;
      addNotification('Webhook deleted');
      fetchWebhooks();
    } catch (error) {
      console.error('Error deleting webhook:', error);
      addNotification('Failed to delete webhook', 'error');
    } finally {
      setLoading(false);
    }
  };

  const testWebhook = async (webhookId) => {
    // CRITICAL FIX: Add timeout protection
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

    try {
      setLoading(true);
      // FIX PHASE 11: Use dynamic URL instead of hardcoded production URL
      // Works in both development (localhost) and production (netlify.app)
      const baseUrl = window.location.origin;
      const response = await fetch(`${baseUrl}/.netlify/functions/webhook-trigger`, {
        method: 'POST',
        signal: controller.signal, // CRITICAL FIX: Add abort signal
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include', // Include HttpOnly auth cookies
        body: JSON.stringify({
          webhook_id: webhookId,
          event: 'webhook.test',
          data: { message: 'Test webhook delivery' }
        })
      });

      clearTimeout(timeoutId); // CRITICAL FIX: Clear timeout on success

      if (response.ok) {
        addNotification('Test webhook sent');
        if (selectedWebhook === webhookId) {
          fetchWebhookDeliveries(webhookId);
        }
      } else {
        throw new Error('Webhook test failed');
      }
    } catch (error) {
      clearTimeout(timeoutId); // CRITICAL FIX: Clear timeout on error
      console.error('Error testing webhook:', error);

      // CRITICAL FIX: Better error message for timeout
      if (error.name === 'AbortError') {
        addNotification('Webhook test timed out. Please try again.', 'error');
      } else {
        addNotification('Failed to send test webhook', 'error');
      }
    } finally {
      setLoading(false);
    }
  };

  const toggleWebhookEvent = (event) => {
    setWebhookForm(prev => ({
      ...prev,
      events: prev.events.includes(event)
        ? prev.events.filter(e => e !== event)
        : [...prev.events, event]
    }));
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    addNotification('Copied to clipboard');
  };

  const canManageIntegrations = ['owner', 'admin'].includes(userRole);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Integrations</h2>
        <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">Connect StageFlow with your tools</p>
      </div>

      {/* Tabs */}
      <div className="border-b border-slate-200 dark:border-slate-700">
        <div className="flex gap-6">
          {[
            { id: 'keys', label: 'API Keys', icon: Key },
            { id: 'webhooks', label: 'Webhooks', icon: Webhook },
            { id: 'connections', label: 'Connections', icon: Zap }
          ].map(tab => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`pb-3 px-1 border-b-2 transition flex items-center gap-2 ${
                  activeTab === tab.id
                    ? 'border-indigo-600 text-indigo-600 dark:border-indigo-400 dark:text-indigo-400'
                    : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span className="font-medium">{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* API Keys Tab */}
      {activeTab === 'keys' && (
        <div className="space-y-4">
          <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700">
            <div className="p-6 border-b border-slate-200 dark:border-slate-700">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-slate-900 dark:text-white">API Keys</h3>
                  <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                    Use API keys to integrate with external systems
                  </p>
                </div>
                {canManageIntegrations && (
                  <button
                    onClick={() => setShowCreateKey(true)}
                    className="bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 font-semibold flex items-center gap-2"
                  >
                    <Plus className="w-4 h-4" />
                    Create Key
                  </button>
                )}
              </div>
            </div>

            {showCreateKey && (
              <div className="p-6 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50">
                <div className="flex gap-3">
                  <input
                    type="text"
                    placeholder="Key name (e.g., Zapier Integration)"
                    value={newKeyName}
                    onChange={(e) => setNewKeyName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && createApiKey()}
                    className="flex-1 px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-indigo-500 dark:bg-slate-700 dark:text-white"
                  />
                  <button
                    onClick={createApiKey}
                    disabled={loading}
                    className="bg-indigo-600 text-white px-6 py-2 rounded-lg hover:bg-indigo-700 font-semibold disabled:opacity-50 flex items-center gap-2"
                  >
                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                    Create
                  </button>
                  <button
                    onClick={() => setShowCreateKey(false)}
                    className="px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {generatedKey && (
              <div className="p-6 border-b border-slate-200 dark:border-slate-700 bg-emerald-50 dark:bg-emerald-900/20">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 bg-emerald-100 dark:bg-emerald-900/40 rounded-lg flex items-center justify-center flex-shrink-0">
                    <Check className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                  </div>
                  <div className="flex-1">
                    <h4 className="font-semibold text-slate-900 dark:text-white mb-1">API Key Created</h4>
                    <p className="text-sm text-slate-600 dark:text-slate-400 mb-3">
                      Copy this key now. You won't be able to see it again.
                    </p>
                    <div className="flex gap-2">
                      <code className="flex-1 px-4 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm font-mono">
                        {generatedKey}
                      </code>
                      <button
                        onClick={() => copyToClipboard(generatedKey)}
                        className="px-4 py-2 bg-slate-800 dark:bg-slate-700 text-white rounded-lg hover:bg-slate-700 dark:hover:bg-slate-600 flex items-center gap-2"
                      >
                        <Copy className="w-4 h-4" />
                        Copy
                      </button>
                    </div>
                  </div>
                  <button
                    onClick={() => setGeneratedKey(null)}
                    className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>
            )}

            <div className="divide-y divide-slate-200 dark:divide-slate-700">
              {apiKeys.length === 0 ? (
                <div className="p-12 text-center">
                  <Key className="w-12 h-12 text-slate-300 dark:text-slate-600 mx-auto mb-3" />
                  <p className="text-slate-600 dark:text-slate-400">No API keys yet</p>
                </div>
              ) : (
                apiKeys.map(key => (
                  <div key={key.id} className="p-6 flex items-center justify-between">
                    <div className="flex-1">
                      <h4 className="font-semibold text-slate-900 dark:text-white">{key.name}</h4>
                      <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                        {key.key_prefix}••••••••
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-500 mt-1">
                        Created {new Date(key.created_at).toLocaleDateString()}
                      </p>
                    </div>
                    {canManageIntegrations && (
                      <button
                        onClick={() => revokeApiKey(key.id)}
                        disabled={loading}
                        className="px-4 py-2 border border-red-300 dark:border-red-600 text-red-600 dark:text-red-400 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 font-medium"
                      >
                        Revoke
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Connections Tab */}
      {activeTab === 'connections' && (
        <div className="space-y-4">
          <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700">
            <div className="p-6 border-b border-slate-200 dark:border-slate-700">
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white" style={{ fontFamily: 'Manrope, sans-serif' }}>
                OAuth Connections
              </h3>
              <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                Connect external platforms to sync data with StageFlow
              </p>
            </div>
            <div className="p-6">
              <div className="bg-white dark:bg-slate-800 rounded-xl border-2 border-slate-200 dark:border-slate-700 p-6 hover:border-teal-400 dark:hover:border-teal-500 transition">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-lg flex items-center justify-center" style={{
                      background: 'linear-gradient(135deg, #FF7A59, #FF5C35)'
                    }}>
                      <Users className="w-6 h-6 text-white" />
                    </div>
                    <div>
                      <h4 className="font-semibold text-slate-900 dark:text-white" style={{ fontFamily: 'Manrope, sans-serif' }}>
                        HubSpot
                      </h4>
                      <p className="text-sm text-slate-600 dark:text-slate-400">
                        Sync contacts and companies into StageFlow
                      </p>
                    </div>
                  </div>
                  <button 
                    className="text-white px-4 py-2 rounded-lg font-semibold hover:opacity-90 transition"
                    style={{ background: 'linear-gradient(135deg, #4FFFB0, #00D4AA)' }}
                  >
                    Connect
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-800 dark:to-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 p-6">
            <div className="flex items-start gap-3">
              <Zap className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: '#00D4AA' }} />
              <div>
                <h4 className="font-semibold text-slate-900 dark:text-white mb-2" style={{ fontFamily: 'Manrope, sans-serif' }}>
                  Need more integrations?
                </h4>
                <p className="text-sm text-slate-600 dark:text-slate-400 mb-3">
                  Use API Keys to let external apps write to StageFlow, and Webhooks to notify other services when deals change.
                </p>
                <div className="flex gap-2">
                  <button 
                    onClick={() => setActiveTab('keys')}
                    className="text-sm px-3 py-1.5 border border-slate-300 dark:border-slate-600 rounded-lg hover:bg-white dark:hover:bg-slate-800 transition"
                  >
                    View API Keys
                  </button>
                  <button 
                    onClick={() => setActiveTab('webhooks')}
                    className="text-sm px-3 py-1.5 border border-slate-300 dark:border-slate-600 rounded-lg hover:bg-white dark:hover:bg-slate-800 transition"
                  >
                    View Webhooks
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default IntegrationsView;
