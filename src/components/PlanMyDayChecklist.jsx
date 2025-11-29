import React, { useState, useEffect, useCallback } from 'react';
import { Check, Circle, TrendingUp, TrendingDown, Minus, Target, DollarSign, Briefcase } from 'lucide-react';

/**
 * PlanMyDayChecklist - Phase 17 Interactive Checklist Component
 *
 * Renders structured AI response with:
 * - Interactive checklist with localStorage persistence
 * - Metrics display with trends
 * - Priority-based task grouping
 *
 * Uses StageFlow design tokens for consistent UI
 */

// localStorage key for checklist persistence
const CHECKLIST_STORAGE_KEY = 'stageflow_plan_my_day_checklist';

/**
 * Get persisted checklist state from localStorage
 * @param {string} organizationId - Organization ID for scoping
 * @returns {Object} Map of task IDs to completion state
 */
const getPersistedChecklist = (organizationId) => {
  try {
    const stored = localStorage.getItem(`${CHECKLIST_STORAGE_KEY}_${organizationId}`);
    if (stored) {
      const data = JSON.parse(stored);
      // Check if data is from today (reset daily)
      const today = new Date().toDateString();
      if (data.date === today) {
        return data.items || {};
      }
    }
  } catch (err) {
    console.debug('[PlanMyDayChecklist] Error reading persisted checklist:', err);
  }
  return {};
};

/**
 * Persist checklist state to localStorage
 * @param {string} organizationId - Organization ID for scoping
 * @param {Object} items - Map of task IDs to completion state
 */
const persistChecklist = (organizationId, items) => {
  try {
    const data = {
      date: new Date().toDateString(),
      items,
      updatedAt: Date.now()
    };
    localStorage.setItem(`${CHECKLIST_STORAGE_KEY}_${organizationId}`, JSON.stringify(data));
  } catch (err) {
    console.debug('[PlanMyDayChecklist] Error persisting checklist:', err);
  }
};

/**
 * Metric Card Component
 */
const MetricCard = ({ metric }) => {
  const getTrendIcon = () => {
    switch (metric.trend) {
      case 'up':
        return <TrendingUp className="w-4 h-4 text-emerald-400" />;
      case 'down':
        return <TrendingDown className="w-4 h-4 text-red-400" />;
      default:
        return <Minus className="w-4 h-4 text-gray-400" />;
    }
  };

  const getIcon = () => {
    if (metric.label.toLowerCase().includes('close')) {
      return <Target className="w-4 h-4 text-teal-400" />;
    }
    if (metric.label.toLowerCase().includes('value') || metric.label.toLowerCase().includes('pipeline')) {
      return <DollarSign className="w-4 h-4 text-teal-400" />;
    }
    return <Briefcase className="w-4 h-4 text-teal-400" />;
  };

  return (
    <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-3 flex-1 min-w-[120px]">
      <div className="flex items-center gap-2 mb-1">
        {getIcon()}
        <span className="text-xs text-gray-400 font-medium">{metric.label}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-lg font-bold text-white">{metric.value}</span>
        {getTrendIcon()}
      </div>
      {metric.delta && (
        <span className="text-xs text-gray-500">{metric.delta}</span>
      )}
    </div>
  );
};

/**
 * Checklist Item Component
 */
const ChecklistItem = ({ item, isCompleted, onToggle }) => {
  const getPriorityStyles = () => {
    switch (item.priority) {
      case 'high':
        return 'border-l-red-500/50 bg-red-500/5';
      case 'medium':
        return 'border-l-amber-500/50 bg-amber-500/5';
      case 'low':
        return 'border-l-blue-500/50 bg-blue-500/5';
      default:
        return 'border-l-gray-500/50 bg-gray-500/5';
    }
  };

  const getPriorityBadge = () => {
    const badgeStyles = {
      high: 'bg-red-500/20 text-red-400',
      medium: 'bg-amber-500/20 text-amber-400',
      low: 'bg-blue-500/20 text-blue-400'
    };
    return (
      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${badgeStyles[item.priority] || 'bg-gray-500/20 text-gray-400'}`}>
        {item.priority?.toUpperCase()}
      </span>
    );
  };

  return (
    <div
      onClick={onToggle}
      role="checkbox"
      aria-checked={isCompleted}
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onToggle()}
      className={`
        flex items-start gap-3 p-3 rounded-lg border-l-4 cursor-pointer
        transition-all duration-200 ease-out
        hover:bg-gray-700/30
        ${getPriorityStyles()}
        ${isCompleted ? 'opacity-60' : ''}
      `}
    >
      {/* Checkbox */}
      <div className={`
        flex-shrink-0 w-5 h-5 mt-0.5 rounded-full border-2
        flex items-center justify-center
        transition-all duration-200
        ${isCompleted
          ? 'bg-teal-500 border-teal-500'
          : 'border-gray-500 hover:border-teal-400'
        }
      `}>
        {isCompleted ? (
          <Check className="w-3 h-3 text-white" />
        ) : (
          <Circle className="w-2 h-2 text-transparent" />
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p className={`text-sm text-white leading-relaxed ${isCompleted ? 'line-through text-gray-400' : ''}`}>
          {item.task}
        </p>
        <div className="flex items-center gap-2 mt-1">
          {getPriorityBadge()}
          {item.dealName && (
            <span className="text-xs text-gray-500 truncate max-w-[150px]">
              {item.dealName}
            </span>
          )}
        </div>
      </div>
    </div>
  );
};

/**
 * Main PlanMyDayChecklist Component
 */
export const PlanMyDayChecklist = ({ structuredResponse, organizationId }) => {
  // Initialize state from localStorage
  const [completedItems, setCompletedItems] = useState(() =>
    getPersistedChecklist(organizationId)
  );

  // Persist changes to localStorage
  useEffect(() => {
    if (organizationId) {
      persistChecklist(organizationId, completedItems);
    }
  }, [completedItems, organizationId]);

  // Toggle item completion
  const handleToggle = useCallback((itemId) => {
    setCompletedItems(prev => ({
      ...prev,
      [itemId]: !prev[itemId]
    }));
  }, []);

  // Guard: Return null if no structured response
  if (!structuredResponse || structuredResponse.response_type !== 'plan_my_day') {
    return null;
  }

  const { summary, checklist = [], metrics = [] } = structuredResponse;

  // Calculate completion percentage
  const completedCount = checklist.filter(item => completedItems[item.id]).length;
  const totalCount = checklist.length;
  const completionPercentage = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  return (
    <div className="bg-gradient-to-br from-gray-900/80 to-black/60 border border-teal-500/20 rounded-2xl p-5 mt-4 space-y-4">
      {/* Header with Progress */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-teal-500/20 flex items-center justify-center">
            <Target className="w-4 h-4 text-teal-400" />
          </div>
          <div>
            <h4 className="text-sm font-semibold text-white">Today's Action Plan</h4>
            <p className="text-xs text-gray-400">{completedCount} of {totalCount} completed</p>
          </div>
        </div>

        {/* Progress Ring */}
        <div className="relative w-12 h-12">
          <svg className="w-12 h-12 transform -rotate-90">
            <circle
              cx="24"
              cy="24"
              r="20"
              stroke="currentColor"
              strokeWidth="4"
              fill="transparent"
              className="text-gray-700"
            />
            <circle
              cx="24"
              cy="24"
              r="20"
              stroke="currentColor"
              strokeWidth="4"
              fill="transparent"
              strokeDasharray={`${completionPercentage * 1.26} 126`}
              strokeLinecap="round"
              className="text-teal-500 transition-all duration-500"
            />
          </svg>
          <span className="absolute inset-0 flex items-center justify-center text-xs font-bold text-white">
            {completionPercentage}%
          </span>
        </div>
      </div>

      {/* Metrics Row */}
      {metrics.length > 0 && (
        <div className="flex gap-3 overflow-x-auto pb-1 scrollbar-hide">
          {metrics.map((metric, idx) => (
            <MetricCard key={idx} metric={metric} />
          ))}
        </div>
      )}

      {/* Checklist */}
      {checklist.length > 0 && (
        <div className="space-y-2">
          {checklist.map((item) => (
            <ChecklistItem
              key={item.id}
              item={item}
              isCompleted={completedItems[item.id] || false}
              onToggle={() => handleToggle(item.id)}
            />
          ))}
        </div>
      )}

      {/* Empty State */}
      {checklist.length === 0 && (
        <div className="text-center py-6">
          <p className="text-sm text-gray-400">No action items detected. Try asking for a more specific plan.</p>
        </div>
      )}
    </div>
  );
};

export default PlanMyDayChecklist;
