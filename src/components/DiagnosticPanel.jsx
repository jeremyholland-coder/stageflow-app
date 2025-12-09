/**
 * DiagnosticPanel - SECTION F Debug Mode UI
 *
 * Displays real-time diagnostic information when ?debug=1 is in the URL.
 * Helps founders and support debug issues without console access.
 *
 * @author StageFlow Engineering
 * @date 2025-12-09
 */

import React, { useState } from 'react';
import { Bug, ChevronDown, ChevronUp, Copy, CheckCircle, XCircle, AlertTriangle, Wifi, WifiOff } from 'lucide-react';

/**
 * Status indicator component
 */
const StatusIndicator = ({ status, label }) => {
  const getIcon = () => {
    switch (status) {
      case 'ok': return <CheckCircle className="w-3 h-3 text-green-400" />;
      case 'error': return <XCircle className="w-3 h-3 text-rose-400" />;
      case 'warning': return <AlertTriangle className="w-3 h-3 text-amber-400" />;
      default: return <span className="w-3 h-3 rounded-full bg-gray-500" />;
    }
  };

  return (
    <div className="flex items-center gap-1.5">
      {getIcon()}
      <span className="text-xs text-white/70">{label}</span>
    </div>
  );
};

/**
 * DiagnosticPanel Component
 */
export const DiagnosticPanel = ({ diagnostics }) => {
  const [isExpanded, setIsExpanded] = useState(true);
  const [copied, setCopied] = useState(false);

  if (!diagnostics) return null;

  const handleCopyDiagnostics = async () => {
    try {
      const text = JSON.stringify(diagnostics, null, 2);
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.error('Failed to copy:', e);
    }
  };

  // Calculate statuses
  const authStatus = diagnostics.auth.hasUser && diagnostics.auth.hasSession ? 'ok' :
                     diagnostics.auth.hasUser ? 'warning' : 'error';

  const aiStatus = diagnostics.ai.hasProvider ? 'ok' :
                   diagnostics.ai.providerFetchError ? 'error' : 'warning';

  const networkStatus = diagnostics.network.isOnline ? 'ok' : 'error';

  return (
    <div className="fixed bottom-4 right-4 z-[9999] max-w-md bg-gray-900/95 backdrop-blur-xl border border-teal-500/30 rounded-xl shadow-2xl overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between px-4 py-3 bg-teal-500/10 hover:bg-teal-500/20 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Bug className="w-4 h-4 text-teal-400" />
          <span className="text-sm font-semibold text-teal-300">Debug Mode</span>
        </div>
        <div className="flex items-center gap-3">
          <StatusIndicator status={authStatus} label="Auth" />
          <StatusIndicator status={aiStatus} label="AI" />
          <StatusIndicator status={networkStatus} label="Net" />
          {isExpanded ? (
            <ChevronDown className="w-4 h-4 text-teal-400" />
          ) : (
            <ChevronUp className="w-4 h-4 text-teal-400" />
          )}
        </div>
      </button>

      {/* Expanded content */}
      {isExpanded && (
        <div className="p-4 space-y-4 max-h-96 overflow-y-auto">
          {/* Quick Status */}
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="bg-gray-800/50 rounded-lg px-3 py-2">
              <span className="text-white/40">Version</span>
              <p className="text-white font-mono">{diagnostics.version}</p>
            </div>
            <div className="bg-gray-800/50 rounded-lg px-3 py-2">
              <span className="text-white/40">Timestamp</span>
              <p className="text-white font-mono text-[10px]">{diagnostics.timestamp}</p>
            </div>
          </div>

          {/* Auth Section */}
          <div className="space-y-1">
            <h4 className="text-[10px] uppercase tracking-wider text-teal-400 font-semibold">Auth</h4>
            <div className="bg-gray-800/50 rounded-lg p-2 text-xs font-mono space-y-1">
              <div className="flex justify-between">
                <span className="text-white/50">User:</span>
                <span className={diagnostics.auth.hasUser ? 'text-green-400' : 'text-rose-400'}>
                  {diagnostics.auth.userId || 'None'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/50">Org:</span>
                <span className={diagnostics.auth.hasOrg ? 'text-green-400' : 'text-rose-400'}>
                  {diagnostics.auth.orgId || 'None'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/50">Session:</span>
                <span className={diagnostics.auth.hasSession ? 'text-green-400' : 'text-rose-400'}>
                  {diagnostics.auth.hasSession ? 'Active' : 'None'}
                </span>
              </div>
              {diagnostics.auth.expiresAt && (
                <div className="flex justify-between">
                  <span className="text-white/50">Expires:</span>
                  <span className="text-white/70 text-[10px]">{diagnostics.auth.expiresAt}</span>
                </div>
              )}
            </div>
          </div>

          {/* AI Section */}
          <div className="space-y-1">
            <h4 className="text-[10px] uppercase tracking-wider text-teal-400 font-semibold">AI Provider</h4>
            <div className="bg-gray-800/50 rounded-lg p-2 text-xs font-mono space-y-1">
              <div className="flex justify-between">
                <span className="text-white/50">Loaded:</span>
                <span className={diagnostics.ai.providersLoaded ? 'text-green-400' : 'text-amber-400'}>
                  {diagnostics.ai.providersLoaded ? 'Yes' : 'Loading...'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/50">Has Provider:</span>
                <span className={diagnostics.ai.hasProvider ? 'text-green-400' : 'text-rose-400'}>
                  {diagnostics.ai.hasProvider ? 'Yes' : 'No'}
                </span>
              </div>
              {diagnostics.ai.providerFetchError && (
                <div className="flex justify-between">
                  <span className="text-white/50">Error:</span>
                  <span className="text-rose-400 text-[10px] max-w-[150px] truncate">
                    {diagnostics.ai.providerFetchError}
                  </span>
                </div>
              )}
              {diagnostics.ai.cachedValue && (
                <div className="flex justify-between">
                  <span className="text-white/50">Cache:</span>
                  <span className="text-white/70 text-[10px]">
                    {diagnostics.ai.cachedValue.hasProvider ? 'Connected' : 'None'} ({diagnostics.ai.cachedValue.age})
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Deals Section */}
          <div className="space-y-1">
            <h4 className="text-[10px] uppercase tracking-wider text-teal-400 font-semibold">Deals</h4>
            <div className="bg-gray-800/50 rounded-lg p-2 text-xs font-mono space-y-1">
              <div className="flex justify-between">
                <span className="text-white/50">Count:</span>
                <span className="text-white">{diagnostics.deals.count}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/50">Valid Array:</span>
                <span className={diagnostics.deals.isArray && !diagnostics.deals.hasNull ? 'text-green-400' : 'text-rose-400'}>
                  {diagnostics.deals.isArray && !diagnostics.deals.hasNull ? 'Yes' : 'Issues'}
                </span>
              </div>
            </div>
          </div>

          {/* Network Section */}
          <div className="space-y-1">
            <h4 className="text-[10px] uppercase tracking-wider text-teal-400 font-semibold">Network</h4>
            <div className="bg-gray-800/50 rounded-lg p-2 text-xs font-mono">
              <div className="flex items-center gap-2">
                {diagnostics.network.isOnline ? (
                  <Wifi className="w-3 h-3 text-green-400" />
                ) : (
                  <WifiOff className="w-3 h-3 text-rose-400" />
                )}
                <span className={diagnostics.network.isOnline ? 'text-green-400' : 'text-rose-400'}>
                  {diagnostics.network.isOnline ? 'Online' : 'Offline'}
                </span>
              </div>
            </div>
          </div>

          {/* Copy Button */}
          <button
            onClick={handleCopyDiagnostics}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-teal-500/10 hover:bg-teal-500/20 border border-teal-500/20 rounded-lg transition-colors"
          >
            <Copy className="w-3 h-3 text-teal-400" />
            <span className="text-xs text-teal-300">
              {copied ? 'Copied!' : 'Copy Diagnostics'}
            </span>
          </button>

          {/* Help text */}
          <p className="text-[10px] text-white/30 text-center">
            Remove ?debug=1 from URL to hide this panel
          </p>
        </div>
      )}
    </div>
  );
};

export default DiagnosticPanel;
