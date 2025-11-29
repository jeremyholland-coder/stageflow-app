import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Check, Circle, TrendingUp, TrendingDown, Minus, Target, DollarSign, Briefcase, ChevronDown, ChevronRight, RotateCcw } from 'lucide-react';

/**
 * PlanMyDayChecklist - Phase 17/19B/20 Interactive Checklist Component
 *
 * PHASE 19B ENHANCEMENT: Visual upgrade with StageFlow card styling
 * PHASE 20 ENHANCEMENT: Carry-over incomplete tasks, expand/collapse sections
 *
 * Renders structured AI response with:
 * - Interactive checklist with localStorage persistence
 * - Metrics display with trends
 * - Priority-based task grouping
 * - Dark glass card styling with accent borders
 * - Daily auto-reset with incomplete task carry-over
 * - Expand/collapse sections by priority
 *
 * Uses StageFlow design tokens for consistent UI
 */

// localStorage key for checklist persistence
const CHECKLIST_STORAGE_KEY = 'stageflow_plan_my_day_checklist';
const CARRYOVER_STORAGE_KEY = 'stageflow_plan_my_day_carryover';

/**
 * PHASE 20: Get yesterday's incomplete tasks for carry-over
 * @param {string} organizationId - Organization ID for scoping
 * @returns {Array} Array of incomplete task objects from previous day
 */
const getCarryOverTasks = (organizationId) => {
  try {
    const stored = localStorage.getItem(`${CARRYOVER_STORAGE_KEY}_${organizationId}`);
    if (stored) {
      const data = JSON.parse(stored);
      // Only return if carryover data exists and is from previous day
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      if (data.date === yesterday.toDateString() && Array.isArray(data.tasks)) {
        return data.tasks;
      }
    }
  } catch (err) {
    console.debug('[PlanMyDayChecklist] Error reading carryover tasks:', err);
  }
  return [];
};

/**
 * PHASE 20: Save incomplete tasks for next day carry-over
 * @param {string} organizationId - Organization ID for scoping
 * @param {Array} incompleteTasks - Tasks that were not completed
 */
const saveCarryOverTasks = (organizationId, incompleteTasks) => {
  try {
    const data = {
      date: new Date().toDateString(),
      tasks: incompleteTasks,
      savedAt: Date.now()
    };
    localStorage.setItem(`${CARRYOVER_STORAGE_KEY}_${organizationId}`, JSON.stringify(data));
  } catch (err) {
    console.debug('[PlanMyDayChecklist] Error saving carryover tasks:', err);
  }
};

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
      // PHASE 20: If data is from yesterday, save incomplete tasks before reset
      if (data.date && data.items && data.checklist) {
        const incompleteTasks = data.checklist.filter(task => !data.items[task.id]);
        if (incompleteTasks.length > 0) {
          saveCarryOverTasks(organizationId, incompleteTasks);
        }
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
 * @param {Array} checklist - Full checklist for carry-over tracking
 */
const persistChecklist = (organizationId, items, checklist = []) => {
  try {
    const data = {
      date: new Date().toDateString(),
      items,
      checklist, // PHASE 20: Store full checklist for carry-over tracking
      updatedAt: Date.now()
    };
    localStorage.setItem(`${CHECKLIST_STORAGE_KEY}_${organizationId}`, JSON.stringify(data));

    // PHASE 20: Also save incomplete tasks to carryover storage at end of day
    const incompleteTasks = checklist.filter(task => !items[task.id]);
    if (incompleteTasks.length > 0) {
      saveCarryOverTasks(organizationId, incompleteTasks);
    }
  } catch (err) {
    console.debug('[PlanMyDayChecklist] Error persisting checklist:', err);
  }
};

/**
 * PHASE 19B: Metric Card Component with enhanced visual styling
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

  // PHASE 19B: Enhanced card styling with gradient accent
  return (
    <div className="bg-gradient-to-br from-gray-800/60 to-gray-900/40 border border-[#1ABC9C]/20 rounded-xl p-3 flex-1 min-w-[120px] backdrop-blur-sm hover:border-[#1ABC9C]/40 transition-colors">
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
 * PHASE 19B: Checklist Item Component with enhanced visual styling
 */
const ChecklistItem = ({ item, isCompleted, onToggle }) => {
  const getPriorityStyles = () => {
    switch (item.priority) {
      case 'high':
        return 'border-l-red-500/60 bg-gradient-to-r from-red-500/10 to-transparent';
      case 'medium':
        return 'border-l-amber-500/60 bg-gradient-to-r from-amber-500/10 to-transparent';
      case 'low':
        return 'border-l-blue-500/60 bg-gradient-to-r from-blue-500/10 to-transparent';
      default:
        return 'border-l-[#1ABC9C]/60 bg-gradient-to-r from-[#1ABC9C]/10 to-transparent';
    }
  };

  const getPriorityBadge = () => {
    const badgeStyles = {
      high: 'bg-red-500/20 text-red-400 border border-red-500/30',
      medium: 'bg-amber-500/20 text-amber-400 border border-amber-500/30',
      low: 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
    };
    return (
      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${badgeStyles[item.priority] || 'bg-gray-500/20 text-gray-400 border border-gray-500/30'}`}>
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
        flex items-start gap-3 p-3.5 rounded-xl border-l-4 cursor-pointer
        transition-all duration-200 ease-out
        hover:bg-white/5 hover:translate-x-0.5
        ${getPriorityStyles()}
        ${isCompleted ? 'opacity-50' : ''}
      `}
    >
      {/* Checkbox */}
      <div className={`
        flex-shrink-0 w-5 h-5 mt-0.5 rounded-full border-2
        flex items-center justify-center
        transition-all duration-200
        ${isCompleted
          ? 'bg-[#1ABC9C] border-[#1ABC9C] shadow-lg shadow-[#1ABC9C]/30'
          : 'border-gray-500 hover:border-[#1ABC9C] hover:shadow-lg hover:shadow-[#1ABC9C]/20'
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
        <div className="flex items-center gap-2 mt-1.5">
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
 * PHASE 20: Enhanced with carry-over logic and expand/collapse sections
 */
export const PlanMyDayChecklist = ({ structuredResponse, organizationId }) => {
  // Initialize state from localStorage
  const [completedItems, setCompletedItems] = useState(() =>
    getPersistedChecklist(organizationId)
  );

  // PHASE 20: Track collapsed sections (by priority)
  const [collapsedSections, setCollapsedSections] = useState({});

  // PHASE 20: Track carry-over tasks
  const [carryOverTasks, setCarryOverTasks] = useState([]);

  // PHASE 20: Load carry-over tasks on mount
  useEffect(() => {
    if (organizationId) {
      const tasks = getCarryOverTasks(organizationId);
      if (tasks.length > 0) {
        setCarryOverTasks(tasks);
      }
    }
  }, [organizationId]);

  // CROSS-TAB SYNC FIX: Re-read from localStorage when window gains focus
  // This ensures Tab B sees changes made in Tab A after refresh or tab switch
  useEffect(() => {
    if (!organizationId) return;

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        // Re-read from localStorage when tab becomes visible
        const freshData = getPersistedChecklist(organizationId);
        setCompletedItems(freshData);
      }
    };

    const handleFocus = () => {
      // Re-read from localStorage when window gains focus
      const freshData = getPersistedChecklist(organizationId);
      setCompletedItems(freshData);
    };

    // Listen for tab visibility changes and window focus
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleFocus);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
    };
  }, [organizationId]);

  // Guard: Return null if no structured response
  if (!structuredResponse || structuredResponse.response_type !== 'plan_my_day') {
    return null;
  }

  const { summary, checklist = [], metrics = [] } = structuredResponse;

  // PHASE 20: Merge carry-over tasks with current checklist
  const mergedChecklist = useMemo(() => {
    // Mark carry-over tasks with a flag
    const carryOverWithFlag = carryOverTasks.map(task => ({
      ...task,
      isCarryOver: true,
      id: `carryover-${task.id}` // Ensure unique ID
    }));

    // Combine: carry-over first (high priority), then today's tasks
    return [...carryOverWithFlag, ...checklist];
  }, [checklist, carryOverTasks]);

  // Persist changes to localStorage (with full checklist for carry-over)
  useEffect(() => {
    if (organizationId && mergedChecklist.length > 0) {
      persistChecklist(organizationId, completedItems, mergedChecklist);
    }
  }, [completedItems, organizationId, mergedChecklist]);

  // Toggle item completion
  const handleToggle = useCallback((itemId) => {
    setCompletedItems(prev => ({
      ...prev,
      [itemId]: !prev[itemId]
    }));
  }, []);

  // PHASE 20: Toggle section collapse
  const toggleSection = useCallback((priority) => {
    setCollapsedSections(prev => ({
      ...prev,
      [priority]: !prev[priority]
    }));
  }, []);

  // PHASE 20: Dismiss carry-over tasks
  const dismissCarryOver = useCallback(() => {
    setCarryOverTasks([]);
    // Clear from storage
    try {
      localStorage.removeItem(`${CARRYOVER_STORAGE_KEY}_${organizationId}`);
    } catch (err) {
      console.debug('[PlanMyDayChecklist] Error clearing carryover:', err);
    }
  }, [organizationId]);

  // PHASE 20: Group tasks by priority for collapsible sections
  const tasksByPriority = useMemo(() => {
    const grouped = { high: [], medium: [], low: [], carryover: [] };
    for (const task of mergedChecklist) {
      if (task.isCarryOver) {
        grouped.carryover.push(task);
      } else if (grouped[task.priority]) {
        grouped[task.priority].push(task);
      } else {
        grouped.medium.push(task);
      }
    }
    return grouped;
  }, [mergedChecklist]);

  // Calculate completion percentage
  const completedCount = checklist.filter(item => completedItems[item.id]).length;
  const totalCount = checklist.length;
  const completionPercentage = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  // PHASE 19B: Enhanced container with dark glass card styling
  return (
    <div className="bg-gradient-to-br from-gray-900/90 to-black/70 border border-[#1ABC9C]/30 rounded-2xl p-5 mt-4 space-y-4 backdrop-blur-sm shadow-xl shadow-black/20">
      {/* Header with Progress */}
      <div className="flex items-center justify-between pb-3 border-b border-white/10">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#1ABC9C]/30 to-[#16A085]/20 border border-[#1ABC9C]/30 flex items-center justify-center shadow-lg shadow-[#1ABC9C]/10">
            <Target className="w-5 h-5 text-[#1ABC9C]" />
          </div>
          <div>
            <h4 className="text-sm font-bold text-white tracking-wide">Today's Action Plan</h4>
            <p className="text-xs text-gray-400">{completedCount} of {totalCount} completed</p>
          </div>
        </div>

        {/* Progress Ring - Enhanced */}
        <div className="relative w-14 h-14">
          <svg className="w-14 h-14 transform -rotate-90">
            <circle
              cx="28"
              cy="28"
              r="24"
              stroke="currentColor"
              strokeWidth="4"
              fill="transparent"
              className="text-gray-700/50"
            />
            <circle
              cx="28"
              cy="28"
              r="24"
              stroke="currentColor"
              strokeWidth="4"
              fill="transparent"
              strokeDasharray={`${completionPercentage * 1.51} 151`}
              strokeLinecap="round"
              className="text-[#1ABC9C] transition-all duration-500 drop-shadow-[0_0_8px_rgba(26,188,156,0.5)]"
            />
          </svg>
          <span className="absolute inset-0 flex items-center justify-center text-sm font-bold text-white">
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

      {/* PHASE 20: Carry-over tasks section */}
      {tasksByPriority.carryover.length > 0 && (
        <div className="space-y-2">
          <div
            className="flex items-center justify-between cursor-pointer group"
            onClick={() => toggleSection('carryover')}
          >
            <div className="flex items-center gap-2">
              {collapsedSections.carryover ? (
                <ChevronRight className="w-4 h-4 text-amber-400" />
              ) : (
                <ChevronDown className="w-4 h-4 text-amber-400" />
              )}
              <span className="text-xs font-semibold text-amber-400 uppercase tracking-wide flex items-center gap-2">
                <RotateCcw className="w-3 h-3" />
                Carried Over ({tasksByPriority.carryover.length})
              </span>
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); dismissCarryOver(); }}
              className="text-xs text-gray-500 hover:text-white transition-colors"
            >
              Dismiss all
            </button>
          </div>
          {!collapsedSections.carryover && tasksByPriority.carryover.map((item) => (
            <ChecklistItem
              key={item.id}
              item={{ ...item, priority: 'high' }}
              isCompleted={completedItems[item.id] || false}
              onToggle={() => handleToggle(item.id)}
            />
          ))}
        </div>
      )}

      {/* PHASE 20: High priority section */}
      {tasksByPriority.high.length > 0 && (
        <div className="space-y-2">
          <div
            className="flex items-center gap-2 cursor-pointer"
            onClick={() => toggleSection('high')}
          >
            {collapsedSections.high ? (
              <ChevronRight className="w-4 h-4 text-red-400" />
            ) : (
              <ChevronDown className="w-4 h-4 text-red-400" />
            )}
            <span className="text-xs font-semibold text-red-400 uppercase tracking-wide">
              High Priority ({tasksByPriority.high.length})
            </span>
          </div>
          {!collapsedSections.high && tasksByPriority.high.map((item) => (
            <ChecklistItem
              key={item.id}
              item={item}
              isCompleted={completedItems[item.id] || false}
              onToggle={() => handleToggle(item.id)}
            />
          ))}
        </div>
      )}

      {/* PHASE 20: Medium priority section */}
      {tasksByPriority.medium.length > 0 && (
        <div className="space-y-2">
          <div
            className="flex items-center gap-2 cursor-pointer"
            onClick={() => toggleSection('medium')}
          >
            {collapsedSections.medium ? (
              <ChevronRight className="w-4 h-4 text-amber-400" />
            ) : (
              <ChevronDown className="w-4 h-4 text-amber-400" />
            )}
            <span className="text-xs font-semibold text-amber-400 uppercase tracking-wide">
              Medium Priority ({tasksByPriority.medium.length})
            </span>
          </div>
          {!collapsedSections.medium && tasksByPriority.medium.map((item) => (
            <ChecklistItem
              key={item.id}
              item={item}
              isCompleted={completedItems[item.id] || false}
              onToggle={() => handleToggle(item.id)}
            />
          ))}
        </div>
      )}

      {/* PHASE 20: Low priority section */}
      {tasksByPriority.low.length > 0 && (
        <div className="space-y-2">
          <div
            className="flex items-center gap-2 cursor-pointer"
            onClick={() => toggleSection('low')}
          >
            {collapsedSections.low ? (
              <ChevronRight className="w-4 h-4 text-blue-400" />
            ) : (
              <ChevronDown className="w-4 h-4 text-blue-400" />
            )}
            <span className="text-xs font-semibold text-blue-400 uppercase tracking-wide">
              Low Priority ({tasksByPriority.low.length})
            </span>
          </div>
          {!collapsedSections.low && tasksByPriority.low.map((item) => (
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
      {mergedChecklist.length === 0 && (
        <div className="text-center py-6">
          <p className="text-sm text-gray-400">No action items detected. Try asking for a more specific plan.</p>
        </div>
      )}
    </div>
  );
};

export default PlanMyDayChecklist;
