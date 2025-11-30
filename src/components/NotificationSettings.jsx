import React, { useState, useEffect, memo } from 'react';
import { Bell, Mail, Monitor, Loader2, AlertCircle, CheckCircle2, Shield } from 'lucide-react';
import { useNotificationPreferences } from '../hooks/useNotificationPreferences';

/**
 * NotificationSettings Component
 *
 * Apple-grade notification preferences UI that allows users to:
 * - Enable/disable notification categories
 * - Choose delivery channels (email, in-app, push)
 * - See which notifications are critical vs optional
 */

// UI Components
const SettingCard = ({ children, className = '' }) => (
  <div className={`bg-white dark:bg-[#0D1F2D] rounded-2xl p-6 border border-[#E0E0E0] dark:border-gray-700 ${className}`}>
    {children}
  </div>
);

const SectionTitle = ({ children, icon: Icon }) => (
  <div className="flex items-center gap-2 mb-4">
    <Icon className="w-5 h-5 text-[#1ABC9C]" />
    <h3 className="text-lg font-semibold text-[#1A1A1A] dark:text-[#E0E0E0]">{children}</h3>
  </div>
);

// Toggle Switch Component
const Toggle = ({ checked, onChange, disabled = false }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    disabled={disabled}
    onClick={() => !disabled && onChange(!checked)}
    className={`
      relative inline-flex h-6 w-11 items-center rounded-full transition-colors
      focus:outline-none focus:ring-2 focus:ring-[#1ABC9C] focus:ring-offset-2 dark:focus:ring-offset-[#0D1F2D]
      ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
      ${checked ? 'bg-[#1ABC9C]' : 'bg-gray-300 dark:bg-gray-600'}
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

// Channel Toggle with Label
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
      onClick={() => !disabled && onChange(!checked)}
      className={`
        flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-all
        ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}
        ${checked
          ? 'bg-[#1ABC9C]/10 text-[#1ABC9C] border border-[#1ABC9C]'
          : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 border border-transparent'
        }
      `}
    >
      <Icon className="w-4 h-4" />
      <span>{label}</span>
    </div>
  </label>
);

// Single Notification Category Row
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
  onToggleChannel
}) => (
  <div className="border border-gray-200 dark:border-gray-700 rounded-xl p-4 space-y-3">
    {/* Header Row */}
    <div className="flex items-start justify-between gap-4">
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium text-[#1A1A1A] dark:text-[#E0E0E0]">{name}</span>
          {isCritical && (
            <span className="flex items-center gap-1 px-2 py-0.5 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 text-xs rounded-full">
              <Shield className="w-3 h-3" />
              Critical
            </span>
          )}
        </div>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{description}</p>
      </div>
      <Toggle
        checked={enabled}
        onChange={onToggleEnabled}
        disabled={isCritical} // Critical notifications cannot be disabled
      />
    </div>

    {/* Channel Selection */}
    {enabled && (
      <div className="flex flex-wrap gap-2 pt-2 border-t border-gray-100 dark:border-gray-700/50">
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
        {/* Push toggle intentionally hidden - not yet supported */}
      </div>
    )}
  </div>
);

// Main Component
const NotificationSettingsComponent = ({ addNotification }) => {
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
        addNotification({
          type: 'success',
          title: 'Preferences saved',
          message: 'Your notification preferences have been updated.'
        });
      }
    } else {
      if (addNotification) {
        addNotification({
          type: 'error',
          title: 'Failed to save',
          message: result.error || 'Could not save notification preferences.'
        });
      }
    }
  };

  // Loading state
  if (loading) {
    return (
      <SettingCard>
        <SectionTitle icon={Bell}>Notification Preferences</SectionTitle>
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-[#1ABC9C]" />
          <span className="ml-2 text-gray-500 dark:text-gray-400">Loading notification settings...</span>
        </div>
      </SettingCard>
    );
  }

  // Error state
  if (error && localPrefs.length === 0) {
    return (
      <SettingCard>
        <SectionTitle icon={Bell}>Notification Preferences</SectionTitle>
        <div className="flex items-center gap-3 p-4 bg-red-50 dark:bg-red-900/20 rounded-xl text-red-600 dark:text-red-400">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <div>
            <p className="font-medium">Failed to load preferences</p>
            <p className="text-sm opacity-80">{error}</p>
          </div>
        </div>
      </SettingCard>
    );
  }

  return (
    <SettingCard>
      <div className="flex items-center justify-between mb-6">
        <SectionTitle icon={Bell}>Notification Preferences</SectionTitle>
        {hasChanges && (
          <span className="text-sm text-amber-600 dark:text-amber-400">Unsaved changes</span>
        )}
      </div>

      <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
        Choose how StageFlow notifies you about important activity. Critical notifications cannot be disabled.
      </p>

      {/* Error banner if there was a save error */}
      {error && (
        <div className="flex items-center gap-3 p-3 mb-4 bg-red-50 dark:bg-red-900/20 rounded-lg text-red-600 dark:text-red-400 text-sm">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Notification Categories */}
      <div className="space-y-3">
        {localPrefs.map(pref => (
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
          />
        ))}
      </div>

      {/* Empty state */}
      {localPrefs.length === 0 && !loading && (
        <div className="text-center py-8 text-gray-500 dark:text-gray-400">
          <Bell className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p>No notification categories available.</p>
        </div>
      )}

      {/* Save Button */}
      {localPrefs.length > 0 && (
        <div className="flex items-center justify-between mt-6 pt-4 border-t border-gray-100 dark:border-gray-700">
          <p className="text-xs text-gray-400">
            Push notifications coming soon
          </p>
          <button
            onClick={handleSave}
            disabled={saving || !hasChanges}
            className={`
              flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-sm transition-all
              ${hasChanges
                ? 'bg-gradient-to-r from-[#2C3E50] via-[#34495E] to-[#1ABC9C] text-white hover:opacity-90'
                : 'bg-gray-100 dark:bg-gray-800 text-gray-400 cursor-not-allowed'
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
    </SettingCard>
  );
};

// Export memoized component
export const NotificationSettings = memo(NotificationSettingsComponent);
export default NotificationSettings;
