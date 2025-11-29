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
  // PHASE A: Apple-grade glass card with premium depth
  return (
    <div className="bg-white/[0.04] backdrop-blur-md border border-white/[0.08] rounded-2xl p-4 flex-1 min-w-[130px] shadow-[0_4px_20px_rgba(0,0,0,0.1)] hover:border-[#0CE3B1]/30 hover:shadow-[0_6px_24px_rgba(12,227,177,0.08)] transition-all duration-300 ease-out hover:translate-y-[-2px]">
      <div className="flex items-center gap-2.5 mb-2">
        {getIcon()}
        <span className="text-xs text-white/60 font-medium tracking-wide">{metric.label}</span>
      </div>
      <div className="flex items-center gap-2.5">
        <span className="text-xl font-bold text-white tracking-tight">{metric.value}</span>
        {getTrendIcon()}
      </div>
      {metric.delta && (
        <span className="text-xs text-white/40 mt-1">{metric.delta}</span>
      )}
    </div>
  );
};

/**
 * PHASE 19B: Checklist Item Component with enhanced visual styling
 * PHASE A: Apple-grade styling with premium animations
 */
const ChecklistItem = ({ item, isCompleted, onToggle }) => {
  const getPriorityStyles = () => {
    switch (item.priority) {
      case 'high':
        return 'border-l-rose-400/70 bg-gradient-to-r from-rose-500/8 to-transparent';
      case 'medium':
        return 'border-l-amber-400/70 bg-gradient-to-r from-amber-500/8 to-transparent';
      case 'low':
        return 'border-l-sky-400/70 bg-gradient-to-r from-sky-500/8 to-transparent';
      default:
        return 'border-l-[#0CE3B1]/70 bg-gradient-to-r from-[#0CE3B1]/8 to-transparent';
    }
  };

  const getPriorityBadge = () => {
    const badgeStyles = {
      high: 'bg-rose-500/15 text-rose-400 border border-rose-400/25',
      medium: 'bg-amber-500/15 text-amber-400 border border-amber-400/25',
      low: 'bg-sky-500/15 text-sky-400 border border-sky-400/25'
    };
    return (
      <span className={`text-[10px] font-semibold px-2.5 py-1 rounded-full ${badgeStyles[item.priority] || 'bg-white/10 text-white/50 border border-white/10'}`}>
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
        flex items-start gap-4 p-4 rounded-2xl border-l-4 cursor-pointer
        transition-all duration-300 ease-out
        hover:bg-white/[0.04] hover:translate-x-1 hover:shadow-[0_4px_16px_rgba(0,0,0,0.1)]
        ${getPriorityStyles()}
        ${isCompleted ? 'opacity-40' : ''}
      `}
    >
      {/* Checkbox - Apple-style with bounce animation */}
      <div className={`
        flex-shrink-0 w-6 h-6 mt-0.5 rounded-full border-2
        flex items-center justify-center
        transition-all duration-300 ease-out
        ${isCompleted
          ? 'bg-gradient-to-br from-[#0CE3B1] to-[#0CE3B1]/80 border-[#0CE3B1] shadow-[0_4px_12px_rgba(12,227,177,0.35)] scale-110'
          : 'border-white/20 hover:border-[#0CE3B1]/60 hover:shadow-[0_4px_12px_rgba(12,227,177,0.15)] hover:scale-105'
        }
      `}>
        {isCompleted ? (
          <Check className="w-3.5 h-3.5 text-white" strokeWidth={3} />
        ) : (
          <Circle className="w-2 h-2 text-transparent" />
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p className={`text-sm text-white leading-relaxed ${isCompleted ? 'line-through text-white/40' : ''}`}>
          {item.task}
        </p>
        <div className="flex items-center gap-2.5 mt-2">
          {getPriorityBadge()}
          {item.dealName && (
            <span className="text-xs text-white/40 truncate max-w-[150px]">
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
  // PHASE A: Apple-grade glass container with premium depth
  return (
    <div className="bg-white/[0.03] backdrop-blur-xl border border-white/[0.08] rounded-2xl p-6 mt-5 space-y-5 shadow-[0_8px_40px_rgba(0,0,0,0.2)]">
      {/* Header with Progress */}
      <div className="flex items-center justify-between pb-4 border-b border-white/[0.07]">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-[#0CE3B1]/25 to-[#0CE3B1]/5 border border-[#0CE3B1]/20 flex items-center justify-center shadow-[0_4px_16px_rgba(12,227,177,0.15)]">
            <Target className="w-6 h-6 text-[#0CE3B1]" />
          </div>
          <div>
            <h4 className="text-base font-semibold text-white tracking-tight">Today's Action Plan</h4>
            <p className="text-xs text-white/50 mt-0.5">{completedCount} of {totalCount} completed</p>
          </div>
        </div>

        {/* Progress Ring - Enhanced with glow */}
        <div className="relative w-16 h-16">
          <svg className="w-16 h-16 transform -rotate-90">
            <circle
              cx="32"
              cy="32"
              r="26"
              stroke="currentColor"
              strokeWidth="4"
              fill="transparent"
              className="text-white/[0.06]"
            />
            <circle
              cx="32"
              cy="32"
              r="26"
              stroke="currentColor"
              strokeWidth="4"
              fill="transparent"
              strokeDasharray={`${completionPercentage * 1.63} 163`}
              strokeLinecap="round"
              className="text-[#0CE3B1] transition-all duration-500 drop-shadow-[0_0_12px_rgba(12,227,177,0.6)]"
            />
          </svg>
          <span className="absolute inset-0 flex items-center justify-center text-sm font-bold text-white tracking-tight">
            {completionPercentage}%
          </span>
        </div>
      </div>

      {/* Metrics Row */}
      {metrics.length > 0 && (
        <div className="flex gap-3.5 overflow-x-auto pb-2 scrollbar-hide -mx-1 px-1">
          {metrics.map((metric, idx) => (
            <MetricCard key={idx} metric={metric} />
          ))}
        </div>
      )}

      {/* PHASE 20: Carry-over tasks section */}
      {tasksByPriority.carryover.length > 0 && (
        <div className="space-y-3">
          <div
            className="flex items-center justify-between cursor-pointer group py-2 px-3 rounded-xl hover:bg-white/[0.03] transition-all duration-300"
            onClick={() => toggleSection('carryover')}
          >
            <div className="flex items-center gap-2.5">
              {collapsedSections.carryover ? (
                <ChevronRight className="w-4 h-4 text-amber-400 transition-transform duration-300" />
              ) : (
                <ChevronDown className="w-4 h-4 text-amber-400 transition-transform duration-300" />
              )}
              <span className="text-xs font-semibold text-amber-400 uppercase tracking-wider flex items-center gap-2">
                <RotateCcw className="w-3.5 h-3.5" />
                Carried Over ({tasksByPriority.carryover.length})
              </span>
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); dismissCarryOver(); }}
              className="text-xs text-white/40 hover:text-amber-400 transition-all duration-300 px-2 py-1 rounded-lg hover:bg-amber-400/10"
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
        <div className="space-y-3">
          <div
            className="flex items-center gap-2.5 cursor-pointer py-2 px-3 rounded-xl hover:bg-white/[0.03] transition-all duration-300"
            onClick={() => toggleSection('high')}
          >
            {collapsedSections.high ? (
              <ChevronRight className="w-4 h-4 text-rose-400 transition-transform duration-300" />
            ) : (
              <ChevronDown className="w-4 h-4 text-rose-400 transition-transform duration-300" />
            )}
            <span className="text-xs font-semibold text-rose-400 uppercase tracking-wider">
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
        <div className="space-y-3">
          <div
            className="flex items-center gap-2.5 cursor-pointer py-2 px-3 rounded-xl hover:bg-white/[0.03] transition-all duration-300"
            onClick={() => toggleSection('medium')}
          >
            {collapsedSections.medium ? (
              <ChevronRight className="w-4 h-4 text-amber-400 transition-transform duration-300" />
            ) : (
              <ChevronDown className="w-4 h-4 text-amber-400 transition-transform duration-300" />
            )}
            <span className="text-xs font-semibold text-amber-400 uppercase tracking-wider">
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
        <div className="space-y-3">
          <div
            className="flex items-center gap-2.5 cursor-pointer py-2 px-3 rounded-xl hover:bg-white/[0.03] transition-all duration-300"
            onClick={() => toggleSection('low')}
          >
            {collapsedSections.low ? (
              <ChevronRight className="w-4 h-4 text-sky-400 transition-transform duration-300" />
            ) : (
              <ChevronDown className="w-4 h-4 text-sky-400 transition-transform duration-300" />
            )}
            <span className="text-xs font-semibold text-sky-400 uppercase tracking-wider">
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
        <div className="text-center py-10">
          <p className="text-sm text-white/40 leading-relaxed">No action items detected. Try asking for a more specific plan.</p>
        </div>
      )}
    </div>
  );
};

export default PlanMyDayChecklist;
