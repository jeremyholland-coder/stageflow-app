import React, { useState, useEffect, useRef, useCallback } from 'react';
import { LayoutGrid, GripVertical, Eye, EyeOff, RotateCcw, Loader2, Info, Check } from 'lucide-react';
import { DASHBOARD_CARDS } from '../config/dashboardCards';
import { useDashboardPreferences } from '../hooks/useDashboardPreferences';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragOverlay
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

/**
 * Sortable Card Item Component
 * Individual card with drag handle and toggle
 */
const SortableCardItem = ({ cardId, isVisible, onToggle, disabled, isOrgDefault }) => {
  const card = DASHBOARD_CARDS[cardId];
  if (!card) return null;

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id: cardId, disabled: disabled || isOrgDefault });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const Icon = card.icon;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-4 p-4 bg-gray-50 dark:bg-gray-900/50 rounded-lg border-2 transition-all ${
        isDragging
          ? 'border-[#1ABC9C] shadow-lg scale-105'
          : 'border-gray-200 dark:border-gray-700'
      } ${!disabled && !isOrgDefault ? 'cursor-grab active:cursor-grabbing' : ''}`}
    >
      {/* Drag Handle */}
      {!isOrgDefault && (
        <div
          {...attributes}
          {...listeners}
          className={`flex-shrink-0 ${
            disabled ? 'opacity-30 cursor-not-allowed' : 'cursor-grab active:cursor-grabbing'
          }`}
          title={disabled ? 'Enable custom preferences to reorder' : 'Drag to reorder'}
        >
          <GripVertical className={`w-5 h-5 ${
            disabled ? 'text-gray-400 dark:text-gray-600' : 'text-gray-400 dark:text-gray-500 hover:text-[#1ABC9C] dark:hover:text-[#1ABC9C]'
          } transition`} />
        </div>
      )}

      {/* Icon */}
      <div className={`w-10 h-10 rounded-lg flex items-center justify-center transition ${
        isVisible ? 'bg-[#1ABC9C]/10' : 'bg-gray-300 dark:bg-gray-700'
      }`}>
        <Icon className={`w-5 h-5 transition ${
          isVisible ? 'text-[#1ABC9C]' : 'text-gray-500 dark:text-gray-400'
        }`} />
      </div>

      {/* Card Info */}
      <div className="flex-1 min-w-0">
        <p className="font-medium text-[#1A1A1A] dark:text-[#E0E0E0]">{card.label}</p>
        <p className="text-xs text-[#6B7280] dark:text-[#9CA3AF] mt-0.5">{card.description}</p>
        {card.requiresFeature && (
          <p className="text-xs text-purple-600 dark:text-purple-400 mt-1 flex items-center gap-1">
            <Info className="w-3 h-3" />
            {card.requiresFeature}
          </p>
        )}
      </div>

      {/* Toggle */}
      {!isOrgDefault && (
        <button
          onClick={() => onToggle(cardId)}
          disabled={disabled}
          className={`relative w-12 h-6 rounded-full transition-all ${
            isVisible ? 'bg-[#1ABC9C]' : 'bg-gray-300 dark:bg-gray-600'
          } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:shadow-md'}`}
          title={isVisible ? 'Hide card' : 'Show card'}
        >
          <div className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform shadow-sm ${
            isVisible ? 'translate-x-6' : 'translate-x-0'
          }`} />
        </button>
      )}

      {/* Status indicator for org defaults view */}
      {isOrgDefault && (
        <div className={`px-3 py-1 rounded-full text-xs font-medium ${
          isVisible
            ? 'bg-[#1ABC9C]/10 text-[#1ABC9C]'
            : 'bg-gray-200 dark:bg-gray-700 text-[#6B7280] dark:text-[#9CA3AF]'
        }`}>
          {isVisible ? 'Visible' : 'Hidden'}
        </div>
      )}
    </div>
  );
};

/**
 * Dashboard Cards Settings Component
 * Allows users to customize which cards appear on their dashboard and their order
 */
export const DashboardCardsSettings = ({ user, organization, userRole, addNotification }) => {
  const {
    preferences,
    orgDefaults,
    loading,
    savePreferences,
    saveOrgDefaults,
    resetToOrgDefaults
  } = useDashboardPreferences(user?.id, organization?.id);

  const [localPrefs, setLocalPrefs] = useState(null);
  const [showOrgDefaults, setShowOrgDefaults] = useState(false);
  const [activeId, setActiveId] = useState(null);

  // UX FRICTION FIX: Auto-save state
  const [autoSaveStatus, setAutoSaveStatus] = useState('idle'); // 'idle' | 'saving' | 'saved'
  const autoSaveTimerRef = useRef(null);

  const isAdmin = ['owner', 'admin'].includes(userRole);

  // Drag and drop sensors with Apple-level precision
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // 8px movement required to start drag (prevents accidental drags)
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Initialize local preferences when loaded
  useEffect(() => {
    if (preferences) {
      setLocalPrefs(preferences);
    }
  }, [preferences]);

  if (loading || !localPrefs) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-[#1ABC9C]" />
        <span className="ml-2 text-[#6B7280] dark:text-[#9CA3AF]">Loading preferences...</span>
      </div>
    );
  }

  // UX FRICTION FIX: Auto-save function
  const performAutoSave = useCallback(async (prefsToSave) => {
    if (!prefsToSave) return;

    setAutoSaveStatus('saving');
    const result = await savePreferences(prefsToSave);

    if (result.success) {
      setAutoSaveStatus('saved');
      setTimeout(() => setAutoSaveStatus('idle'), 2000);
    } else {
      setAutoSaveStatus('idle');
      addNotification('Failed to save preferences', 'error');
    }
  }, [savePreferences, addNotification]);

  // UX FRICTION FIX: Toggle card with auto-save
  const handleToggleCard = useCallback((cardId) => {
    setLocalPrefs(prev => {
      const updated = {
        ...prev,
        [`show_${cardId}`]: !prev[`show_${cardId}`],
        use_org_defaults: false
      };

      // Clear existing timer and trigger auto-save
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = setTimeout(() => performAutoSave(updated), 500);

      return updated;
    });
  }, [performAutoSave]);

  const handleToggleUseOrgDefaults = async () => {
    const newValue = !localPrefs.use_org_defaults;
    setLocalPrefs(prev => ({ ...prev, use_org_defaults: newValue }));

    if (newValue) {
      setAutoSaveStatus('saving');
      const result = await resetToOrgDefaults();
      if (result.success) {
        setAutoSaveStatus('saved');
        setTimeout(() => setAutoSaveStatus('idle'), 2000);
        addNotification('Reset to organization defaults', 'success');
      } else {
        setAutoSaveStatus('idle');
        addNotification('Failed to reset preferences', 'error');
      }
    }
  };

  const handleResetToDefaults = async () => {
    setAutoSaveStatus('saving');
    const result = await resetToOrgDefaults();
    if (result.success) {
      setAutoSaveStatus('saved');
      setTimeout(() => setAutoSaveStatus('idle'), 2000);
      addNotification('Reset to default settings', 'success');
    } else {
      setAutoSaveStatus('idle');
      addNotification('Failed to reset preferences', 'error');
    }
  };

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    };
  }, []);

  // Drag and drop handlers
  const handleDragStart = (event) => {
    setActiveId(event.active.id);
  };

  // UX FRICTION FIX: Drag end with auto-save
  const handleDragEnd = (event) => {
    const { active, over } = event;

    if (active.id !== over?.id) {
      setLocalPrefs(prev => {
        const oldIndex = prev.card_order.indexOf(active.id);
        const newIndex = prev.card_order.indexOf(over.id);
        const newOrder = arrayMove(prev.card_order, oldIndex, newIndex);

        const updated = {
          ...prev,
          card_order: newOrder,
          use_org_defaults: false
        };

        // Auto-save after reorder
        if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = setTimeout(() => performAutoSave(updated), 500);

        return updated;
      });
    }

    setActiveId(null);
  };

  const handleDragCancel = () => {
    setActiveId(null);
  };


  return (
    <div className="space-y-6">
      {/* User Preferences */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold text-[#1A1A1A] dark:text-[#E0E0E0]">Your Dashboard Cards</h3>
            <p className="text-sm text-[#6B7280] dark:text-[#9CA3AF] mt-1">
              Customize which cards appear on your dashboard
            </p>
          </div>
          {/* UX FRICTION FIX: Auto-save status indicator */}
          <div className="flex items-center gap-2">
            {autoSaveStatus === 'saving' && (
              <span className="flex items-center gap-2 text-sm text-[#6B7280] dark:text-[#9CA3AF]">
                <Loader2 className="w-4 h-4 animate-spin" />
                Saving...
              </span>
            )}
            {autoSaveStatus === 'saved' && (
              <span className="flex items-center gap-2 text-sm text-[#1ABC9C]">
                <Check className="w-4 h-4" />
                Saved
              </span>
            )}
            {autoSaveStatus === 'idle' && (
              <span className="text-xs text-[#9CA3AF]">Changes auto-save</span>
            )}
          </div>
        </div>

        {/* Use Org Defaults Toggle */}
        <div className="mb-4 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={localPrefs.use_org_defaults}
              onChange={handleToggleUseOrgDefaults}
              className="w-5 h-5 text-[#1ABC9C] border-gray-300 rounded focus:ring-[#1ABC9C]"
            />
            <div className="flex-1">
              <p className="font-medium text-[#1A1A1A] dark:text-[#E0E0E0]">Use organization defaults</p>
              <p className="text-xs text-[#6B7280] dark:text-[#9CA3AF] mt-0.5">
                When enabled, your dashboard will match the settings configured by your administrator
              </p>
            </div>
          </label>
        </div>

        {/* Card List with Drag and Drop */}
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
        >
          <SortableContext
            items={localPrefs.card_order || ['dashboard_stats', 'revenue_targets', 'ai_insights', 'pipeline_health']}
            strategy={verticalListSortingStrategy}
          >
            <div className="space-y-3">
              {(localPrefs.card_order || ['dashboard_stats', 'revenue_targets', 'ai_insights', 'pipeline_health']).map(cardId => (
                <SortableCardItem
                  key={cardId}
                  cardId={cardId}
                  isVisible={localPrefs[`show_${cardId}`]}
                  onToggle={handleToggleCard}
                  disabled={localPrefs.use_org_defaults}
                  isOrgDefault={false}
                />
              ))}
            </div>
          </SortableContext>

          {/* Drag Overlay for smooth dragging experience */}
          <DragOverlay>
            {activeId ? (
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow-2xl border-2 border-[#1ABC9C] p-4 opacity-90">
                <div className="flex items-center gap-4">
                  <GripVertical className="w-5 h-5 text-[#1ABC9C]" />
                  <div className="w-10 h-10 bg-[#1ABC9C]/10 rounded-lg flex items-center justify-center">
                    {(() => {
                      const card = DASHBOARD_CARDS[activeId];
                      const Icon = card?.icon;
                      return Icon ? <Icon className="w-5 h-5 text-[#1ABC9C]" /> : null;
                    })()}
                  </div>
                  <p className="font-medium text-[#1A1A1A] dark:text-[#E0E0E0]">
                    {DASHBOARD_CARDS[activeId]?.label}
                  </p>
                </div>
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>

        {!localPrefs.use_org_defaults && (
          <div className="mt-4 flex justify-end">
            <button
              onClick={handleResetToDefaults}
              disabled={saving}
              className="flex items-center gap-2 px-4 py-2 text-[#6B7280] hover:text-[#1A1A1A] dark:text-[#9CA3AF] dark:hover:text-[#E0E0E0] transition"
            >
              <RotateCcw className="w-4 h-4" />
              Reset to Defaults
            </button>
          </div>
        )}
      </div>

      {/* Admin: Organization Defaults */}
      {isAdmin && (
        <div className="pt-6 border-t border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-lg font-semibold text-[#1A1A1A] dark:text-[#E0E0E0] flex items-center gap-2">
                Organization Defaults
                <span className="px-2 py-0.5 bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400 text-xs font-medium rounded">
                  Admin Only
                </span>
              </h3>
              <p className="text-sm text-[#6B7280] dark:text-[#9CA3AF] mt-1">
                Set default card visibility for all team members. Individual users can override these settings.
              </p>
            </div>
            <button
              onClick={() => setShowOrgDefaults(!showOrgDefaults)}
              className="px-4 py-2 text-sm text-[#1ABC9C] hover:text-[#16A085] font-medium transition"
            >
              {showOrgDefaults ? 'Hide' : 'Show'} Defaults
            </button>
          </div>

          {showOrgDefaults && (
            <div className="space-y-3">
              {(orgDefaults?.card_order || ['dashboard_stats', 'revenue_targets', 'ai_insights', 'pipeline_health']).map(cardId => (
                <SortableCardItem
                  key={cardId}
                  cardId={cardId}
                  isVisible={orgDefaults?.[`show_${cardId}`] ?? true}
                  onToggle={() => {}}
                  disabled={true}
                  isOrgDefault={true}
                />
              ))}
              <div className="mt-4 p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
                <p className="text-sm text-amber-800 dark:text-amber-200">
                  <strong>Note:</strong> Organization defaults will be fully configurable in a future update. For now, all cards are visible by default for all team members.
                </p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
