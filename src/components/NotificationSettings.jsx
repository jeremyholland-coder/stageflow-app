import React, { useState, useEffect, memo } from 'react';
import { Bell, Mail, Monitor, Loader2, AlertCircle, CheckCircle2, Shield } from 'lucide-react';
import { useNotificationPreferences } from '../hooks/useNotificationPreferences';
import { GlassCard } from './ui/GlassCard';

/**
 * NotificationSettings Component
 *
 * Apple-grade notification preferences UI that allows users to:
 * - Enable/disable notification categories
 * - Choose delivery channels (email, in-app, push)
 * - See which notifications are critical vs optional
 */

// UI Components - Using GlassCard from shared UI for consistent glass-like styling

// Toggle Switch Component - Glass-themed with glow effect
const Toggle = ({ checked, onChange, disabled = false }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    disabled={disabled}
    onClick={() => !disabled && onChange(!checked)}
    className={`
      relative inline-flex h-6 w-11 items-center rounded-full transition-all duration-200
      focus:outline-none focus:ring-2 focus:ring-[#1ABC9C]/50 focus:ring-offset-2 focus:ring-offset-transparent
      ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
      ${checked
        ? 'bg-[#1ABC9C] shadow-lg shadow-[#1ABC9C]/30'
        : 'bg-white/10 border border-white/10'
      }
    `}
  >
    <span
      className={`
        inline-block h-4 w-4 transform rounded-full bg-white transition-transform shadow-sm
        ${checked ? 'translate-x-6' : 'translate-x-1'}
      `}
    />
  </button>
);

// Channel Toggle with Label - Glass-themed pills
// FIX ISSUE 2: Removed redundant onClick on div - the label naturally triggers checkbox onChange
// Having both onClick on div AND checkbox onChange caused double-fire, breaking toggle behavior
const ChannelToggle = ({ icon: Icon, label, checked, onChange, disabled = false }) => (
  <label className={`flex items-center gap-2 ${disabled ? 'opacity-50' : ''}`}>
    <input
      type="checkbox"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      disabled={disabled}
      className="sr-only"
    />
    <div
      className={`
        flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-all
        ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}
        ${checked
          ? 'bg-[#1ABC9C]/15 text-[#1ABC9C] border border-[#1ABC9C]/40'
          : 'bg-white/5 text-slate-500 border border-white/10 hover:border-white/20'
        }
      `}
    >
      <Icon className="w-3.5 h-3.5" />
      <span>{label}</span>
    </div>
  </label>
);

// Single Notification Category Row - Glass-themed styling
const NotificationCategoryRow = ({
  code,
  name,
  description,
  isCritical,
  enabled,
  channelEmail,
  channelInApp,
  channelPush,
  onToggleEnabled,
  onToggleChannel,
  isFirst = false
}) => (
  <div className={`py-3.5 ${!isFirst ? 'border-t border-white/5' : ''}`}>
    {/* Header Row */}
    <div className="flex items-start justify-between gap-4">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-slate-100">{name}</span>
          {isCritical && (
            <span className="flex items-center gap-1 px-2 py-0.5 bg-amber-500/10 text-amber-400 text-xs rounded-full border border-amber-500/20">
              <Shield className="w-3 h-3" />
              Critical
            </span>
          )}
        </div>
        <p className="text-xs text-slate-400 mt-1">{description}</p>
      </div>
      <div className="flex items-center gap-3 flex-shrink-0">
        {/* Channel pills - inline with toggle for cleaner layout */}
        {enabled && (
          <div className="flex gap-1.5">
            <ChannelToggle
              icon={Mail}
              label="Email"
              checked={channelEmail}
              onChange={(val) => onToggleChannel('channel_email', val)}
            />
            <ChannelToggle
              icon={Monitor}
              label="In-app"
              checked={channelInApp}
              onChange={(val) => onToggleChannel('channel_in_app', val)}
            />
          </div>
        )}
        <Toggle
          checked={enabled}
          onChange={onToggleEnabled}
          disabled={isCritical} // Critical notifications cannot be disabled
        />
      </div>
    </div>
  </div>
);

// Main Component
// bare prop: when true, renders content without GlassCard wrapper (for unified card in Settings)
const NotificationSettingsComponent = ({ addNotification, bare = false }) => {
  const {
    categories,
    loading,
    saving,
    error,
    savePreferences,
    updateCategoryLocally
  } = useNotificationPreferences();

  // Track if there are unsaved changes
  const [hasChanges, setHasChanges] = useState(false);

  // Local state for editable preferences
  const [localPrefs, setLocalPrefs] = useState([]);

  // Sync local state when data loads
  useEffect(() => {
    if (categories.length > 0) {
      setLocalPrefs(categories.map(cat => ({
        code: cat.code,
        name: cat.name,
        description: cat.description,
        isCritical: cat.is_critical,
        enabled: cat.userPreference?.enabled ?? cat.default_enabled,
        channel_email: cat.userPreference?.channel_email ?? true,
        channel_in_app: cat.userPreference?.channel_in_app ?? true,
        channel_push: cat.userPreference?.channel_push ?? false
      })));
      setHasChanges(false);
    }
  }, [categories]);

  // Handle toggling a category's enabled state
  const handleToggleEnabled = (code, newValue) => {
    setLocalPrefs(prev => prev.map(p =>
      p.code === code ? { ...p, enabled: newValue } : p
    ));
    setHasChanges(true);
  };

  // Handle toggling a channel
  const handleToggleChannel = (code, channelKey, newValue) => {
    setLocalPrefs(prev => prev.map(p =>
      p.code === code ? { ...p, [channelKey]: newValue } : p
    ));
    setHasChanges(true);
  };

  // Save preferences
  const handleSave = async () => {
    const payload = localPrefs.map(p => ({
      categoryCode: p.code,
      enabled: p.enabled,
      channel_email: p.channel_email,
      channel_in_app: p.channel_in_app,
      channel_push: p.channel_push
    }));

    const result = await savePreferences(payload);

    if (result.success) {
      setHasChanges(false);
      if (addNotification) {
        // FIX: addNotification expects (message: string, type: string), not an object
        // Passing an object caused React error #31 (Objects are not valid as React children)
        addNotification('Your notification preferences have been updated.', 'success');
      }
    } else {
      if (addNotification) {
        // FIX: addNotification expects (message: string, type: string)
        addNotification(result.error || 'Could not save notification preferences.', 'error');
      }
    }
  };

  // Loading state
  if (loading) {
    const loadingContent = (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-5 h-5 animate-spin text-[#1ABC9C]" />
        <span className="ml-2 text-slate-400 text-sm">Loading...</span>
      </div>
    );

    if (bare) return loadingContent;

    return (
      <GlassCard
        title="Activity Notifications"
        description="Loading notification settings..."
      >
        {loadingContent}
      </GlassCard>
    );
  }

  // Error state
  if (error && localPrefs.length === 0) {
    const errorContent = (
      <div className="flex items-center gap-3 p-3 bg-red-500/10 rounded-xl text-red-400 border border-red-500/20">
        <AlertCircle className="w-5 h-5 flex-shrink-0" />
        <div>
          <p className="font-medium text-sm">Failed to load preferences</p>
          <p className="text-xs opacity-80">{error}</p>
        </div>
      </div>
    );

    if (bare) return errorContent;

    return (
      <GlassCard
        title="Activity Notifications"
        description="Choose how StageFlow keeps you updated on important activity."
      >
        {errorContent}
      </GlassCard>
    );
  }

  // Main content (used in both bare and wrapped modes)
  const mainContent = (
    <>
      {/* Unsaved changes indicator */}
      {hasChanges && (
        <div className="mb-4 px-3 py-2 bg-amber-500/10 rounded-lg border border-amber-500/20">
          <span className="text-xs text-amber-400">You have unsaved changes</span>
        </div>
      )}

      {/* Error banner if there was a save error */}
      {error && (
        <div className="flex items-center gap-3 p-3 mb-4 bg-red-500/10 rounded-lg text-red-400 text-sm border border-red-500/20">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Notification Categories */}
      <div>
        {localPrefs.map((pref, index) => (
          <NotificationCategoryRow
            key={pref.code}
            code={pref.code}
            name={pref.name}
            description={pref.description}
            isCritical={pref.isCritical}
            enabled={pref.enabled}
            channelEmail={pref.channel_email}
            channelInApp={pref.channel_in_app}
            channelPush={pref.channel_push}
            onToggleEnabled={(val) => handleToggleEnabled(pref.code, val)}
            onToggleChannel={(key, val) => handleToggleChannel(pref.code, key, val)}
            isFirst={index === 0}
          />
        ))}
      </div>

      {/* Empty state */}
      {localPrefs.length === 0 && !loading && (
        <div className="text-center py-8 text-slate-400">
          <Bell className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">No notification categories available.</p>
        </div>
      )}

      {/* Save Button */}
      {localPrefs.length > 0 && (
        <div className="flex items-center justify-between mt-4 pt-4 border-t border-white/5">
          <p className="text-xs text-slate-500">
            Push notifications coming soon
          </p>
          <button
            onClick={handleSave}
            disabled={saving || !hasChanges}
            className={`
              flex items-center gap-2 px-4 py-2 rounded-xl font-semibold text-sm transition-all
              ${hasChanges
                ? 'bg-[#1ABC9C] text-white hover:bg-[#16a085] shadow-lg shadow-[#1ABC9C]/20'
                : 'bg-white/5 text-slate-500 cursor-not-allowed border border-white/10'
              }
              ${saving ? 'opacity-70' : ''}
            `}
          >
            {saving ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <CheckCircle2 className="w-4 h-4" />
                Save preferences
              </>
            )}
          </button>
        </div>
      )}
    </>
  );

  // Bare mode: return content without GlassCard wrapper (for unified Settings card)
  if (bare) {
    return mainContent;
  }

  return (
    <GlassCard
      title="Activity Notifications"
      description="Choose how StageFlow keeps you updated on important activity."
    >
      {mainContent}
    </GlassCard>
  );
};

// Export memoized component
export const NotificationSettings = memo(NotificationSettingsComponent);
export default NotificationSettings;
