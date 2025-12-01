import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Sparkles,
  Calendar,
  CheckSquare,
  TrendingUp,
  GraduationCap,
  Award,
  Clock,
  AlertTriangle,
  Target,
  DollarSign,
  RefreshCw,
  Plus,
  ChevronRight
} from 'lucide-react';
import { useApp } from './AppShell';
import { CustomQueryView } from './CustomQueryView';
import { PlanMyDayChecklist } from './PlanMyDayChecklist';
import { useMissionControlTasks } from '../hooks/useMissionControlTasks';
import { buildOfflineSnapshot, buildGoalProgress } from '../lib/offlineSnapshot';
import { formatCurrency, formatPercentage } from '../ai/stageflowConfig';

/**
 * MissionControlPanel - Phase 1 Unified AI Panel
 *
 * Apple-inspired "Mission Control" panel that combines:
 * - Today: AI narrative and daily plan
 * - Mission Control: Interactive task checklist
 * - Performance: Run-rate pulse vs targets
 * - Coach: Short coaching insights
 *
 * Features:
 * - Full horizontal width with premium glass styling
 * - Metric chips in header (Win Rate, Days to Close, At Risk)
 * - Tab-based navigation
 * - No DB changes (localStorage only for tasks)
 *
 * @author StageFlow Engineering
 */

// Tab configuration
// LAUNCH: Coach always visible; Tasks tab appears after Plan My Day is run
const TABS = [
  { id: 'tasks', label: 'Tasks', icon: CheckSquare, conditionalOnTasks: true },
  { id: 'coach', label: 'Coach', icon: GraduationCap, visible: true }
];

/**
 * Metric Chip Component - Glass pill for key metrics
 */
const MetricChip = ({ label, value, icon: Icon, color = 'emerald', loading = false }) => {
  const colorStyles = {
    emerald: 'from-emerald-500/20 to-emerald-600/10 border-emerald-500/30 text-emerald-400',
    teal: 'from-[#1ABC9C]/20 to-[#16A085]/10 border-[#1ABC9C]/30 text-[#1ABC9C]',
    blue: 'from-blue-500/20 to-blue-600/10 border-blue-500/30 text-blue-400',
    amber: 'from-amber-500/20 to-amber-600/10 border-amber-500/30 text-amber-400',
    rose: 'from-rose-500/20 to-rose-600/10 border-rose-500/30 text-rose-400'
  };

  const style = colorStyles[color] || colorStyles.teal;

  if (loading) {
    return (
      <div className={`flex items-center gap-2 px-3 py-2 rounded-xl bg-gradient-to-br ${style} border backdrop-blur-md animate-pulse`}>
        <div className="w-4 h-4 bg-white/10 rounded" />
        <div className="w-16 h-3 bg-white/10 rounded" />
      </div>
    );
  }

  return (
    <div
      className={`flex items-center gap-2 px-3 py-2 rounded-xl bg-gradient-to-br ${style} border backdrop-blur-md shadow-[0_2px_12px_rgba(0,0,0,0.08)] transition-all duration-300 hover:scale-[1.02] hover:shadow-[0_4px_16px_rgba(0,0,0,0.12)]`}
    >
      {Icon && <Icon className="w-3.5 h-3.5" />}
      <span className="text-[10px] text-white/60 font-medium uppercase tracking-wider">{label}</span>
      <span className="text-xs font-bold text-white">{value}</span>
    </div>
  );
};

/**
 * Tab Button Component - Glass design with conditional glow effects
 * - Tasks tab: mint glow when active (appears after Plan My Day)
 * - Coach tab: blue trust glow when active
 */
const TabButton = ({ tab, isActive, onClick }) => {
  const Icon = tab.icon;
  const isCoach = tab.id === 'coach';
  const isTasks = tab.id === 'tasks';

  // Determine active styling based on tab type
  const getActiveStyles = () => {
    if (!isActive) return 'text-white/40 hover:text-white/70 hover:bg-white/[0.04]';

    if (isCoach) {
      // Blue trust glow for Coach
      return 'bg-blue-500/15 text-blue-300 border border-blue-400/30 shadow-[0_0_12px_rgba(59,130,246,0.25)]';
    }
    if (isTasks) {
      // Mint glow for Tasks
      return 'bg-[#0CE3B1]/15 text-[#0CE3B1] border border-[#0CE3B1]/30 shadow-[0_0_12px_rgba(12,227,177,0.25)]';
    }
    return 'bg-white/[0.1] text-white border border-white/[0.15]';
  };

  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-300 ${getActiveStyles()}`}
      aria-selected={isActive}
      role="tab"
    >
      <Icon className="w-3.5 h-3.5" />
      <span>{tab.label}</span>
    </button>
  );
};

/**
 * Performance Card Component - For run-rate pulse
 */
const PerformanceCard = ({ title, current, target, period, daysElapsed, totalDays }) => {
  const percentage = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0;

  // Calculate run rate
  const runRate = daysElapsed > 0 && totalDays > 0
    ? Math.round((current / daysElapsed) * totalDays)
    : current;

  const onTrack = runRate >= target;

  return (
    <div className="bg-white/[0.03] backdrop-blur-md border border-white/[0.08] rounded-2xl p-5 shadow-[0_4px_20px_rgba(0,0,0,0.1)] hover:border-[#0CE3B1]/30 transition-all duration-300">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-semibold text-white">{title}</h4>
        <span className={`text-xs font-medium px-2 py-1 rounded-lg ${
          onTrack
            ? 'bg-emerald-500/20 text-emerald-400'
            : 'bg-amber-500/20 text-amber-400'
        }`}>
          {onTrack ? 'On Track' : 'Behind Pace'}
        </span>
      </div>

      {/* Progress bar */}
      <div className="h-2 bg-white/[0.06] rounded-full overflow-hidden mb-3">
        <div
          className={`h-full rounded-full transition-all duration-500 ${
            onTrack
              ? 'bg-gradient-to-r from-emerald-500 to-[#0CE3B1]'
              : 'bg-gradient-to-r from-amber-500 to-amber-400'
          }`}
          style={{ width: `${percentage}%` }}
        />
      </div>

      {/* Stats row */}
      <div className="flex items-center justify-between text-xs">
        <div>
          <span className="text-white/50">Closed: </span>
          <span className="text-white font-semibold">{formatCurrency(current)}</span>
        </div>
        <div>
          <span className="text-white/50">Goal: </span>
          <span className="text-white font-semibold">{formatCurrency(target)}</span>
        </div>
        <div>
          <span className="text-white/50">{percentage}%</span>
        </div>
      </div>

      {/* Run rate projection */}
      <div className="mt-3 pt-3 border-t border-white/[0.06] flex items-center gap-2">
        <TrendingUp className={`w-3.5 h-3.5 ${onTrack ? 'text-emerald-400' : 'text-amber-400'}`} />
        <span className="text-xs text-white/60">
          On track to <span className={`font-semibold ${onTrack ? 'text-emerald-400' : 'text-amber-400'}`}>{formatCurrency(runRate)}</span>
        </span>
      </div>
    </div>
  );
};

/**
 * Coach Card Component - For coaching insights
 */
const CoachCard = ({ headline, signals = [], suggestions = [] }) => {
  return (
    <div className="bg-white/[0.03] backdrop-blur-md border border-white/[0.08] rounded-2xl p-5 shadow-[0_4px_20px_rgba(0,0,0,0.1)]">
      {/* Headline */}
      {headline && (
        <div className="flex items-start gap-3 mb-4 pb-4 border-b border-white/[0.06]">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#0CE3B1]/20 to-[#0CE3B1]/5 flex items-center justify-center flex-shrink-0">
            <GraduationCap className="w-5 h-5 text-[#0CE3B1]" />
          </div>
          <p className="text-sm text-white font-medium leading-relaxed">{headline}</p>
        </div>
      )}

      {/* Signals */}
      {signals.length > 0 && (
        <div className="mb-4">
          <h5 className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-2">
            Signals We See
          </h5>
          <ul className="space-y-2">
            {signals.slice(0, 5).map((signal, idx) => (
              <li key={idx} className="flex items-start gap-2 text-xs text-white/70">
                <ChevronRight className="w-3 h-3 text-[#0CE3B1] mt-0.5 flex-shrink-0" />
                <span>{signal}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Suggestions */}
      {suggestions.length > 0 && (
        <div>
          <h5 className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-2">
            Coaching Suggestions
          </h5>
          <ul className="space-y-2">
            {suggestions.slice(0, 5).map((suggestion, idx) => (
              <li key={idx} className="flex items-start gap-2 text-xs text-white/70">
                <Target className="w-3 h-3 text-amber-400 mt-0.5 flex-shrink-0" />
                <span>{suggestion}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Empty state */}
      {!headline && signals.length === 0 && suggestions.length === 0 && (
        <div className="text-center py-8">
          <GraduationCap className="w-10 h-10 text-white/20 mx-auto mb-3" />
          <p className="text-sm text-white/40">
            Run "Plan My Day" to get personalized coaching insights.
          </p>
        </div>
      )}
    </div>
  );
};

/**
 * Mission Control Task Item Component
 */
const TaskItem = ({ task, isCompleted, onToggle }) => {
  const priorityStyles = {
    high: 'border-l-rose-400/70 bg-gradient-to-r from-rose-500/8 to-transparent',
    medium: 'border-l-amber-400/70 bg-gradient-to-r from-amber-500/8 to-transparent',
    low: 'border-l-sky-400/70 bg-gradient-to-r from-sky-500/8 to-transparent'
  };

  const priorityBadgeStyles = {
    high: 'bg-rose-500/15 text-rose-400 border-rose-400/25',
    medium: 'bg-amber-500/15 text-amber-400 border-amber-400/25',
    low: 'bg-sky-500/15 text-sky-400 border-sky-400/25'
  };

  return (
    <div
      onClick={onToggle}
      role="checkbox"
      aria-checked={isCompleted}
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onToggle()}
      className={`flex items-start gap-3 p-3 rounded-xl border-l-4 cursor-pointer transition-all duration-300 hover:bg-white/[0.04] ${
        priorityStyles[task.priority] || priorityStyles.medium
      } ${isCompleted ? 'opacity-40' : ''}`}
    >
      {/* Checkbox */}
      <div className={`flex-shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all duration-300 ${
        isCompleted
          ? 'bg-gradient-to-br from-[#0CE3B1] to-[#0CE3B1]/80 border-[#0CE3B1] shadow-[0_2px_8px_rgba(12,227,177,0.3)]'
          : 'border-white/20 hover:border-[#0CE3B1]/60'
      }`}>
        {isCompleted && (
          <svg className="w-3 h-3 text-white" viewBox="0 0 12 12" fill="none">
            <path d="M2 6L5 9L10 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p className={`text-sm text-white leading-relaxed ${isCompleted ? 'line-through text-white/40' : ''}`}>
          {task.label || task.task}
        </p>
        <div className="flex items-center gap-2 mt-1.5">
          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
            priorityBadgeStyles[task.priority] || priorityBadgeStyles.medium
          }`}>
            {(task.priority || 'medium').toUpperCase()}
          </span>
          {task.isCarryOver && (
            <span className="text-[10px] text-amber-400/70 flex items-center gap-1">
              <RefreshCw className="w-3 h-3" />
              Carried over
            </span>
          )}
          {task.dealName && (
            <span className="text-[10px] text-white/40 truncate max-w-[120px]">
              {task.dealName}
            </span>
          )}
        </div>
      </div>
    </div>
  );
};

/**
 * Main MissionControlPanel Component
 */
export const MissionControlPanel = ({
  deals = [],
  healthAlert = null,
  orphanedDealIds = new Set(),
  onDismissAlert = () => {},
  targets = {},
  coachingData = null
}) => {
  const { user, organization } = useApp();
  const [activeTab, setActiveTab] = useState('coach'); // Default to Coach; Tasks appears after Plan My Day
  const [newTaskInput, setNewTaskInput] = useState('');
  const [aiTasks, setAiTasks] = useState([]);

  // Build metrics from deals
  const metrics = useMemo(() => {
    if (!deals || deals.length === 0) {
      return { orgWinRate: null, avgDaysToClose: null, highValueAtRisk: null };
    }
    const snapshot = buildOfflineSnapshot(deals, { userId: user?.id });
    return snapshot.metrics || {};
  }, [deals, user?.id]);

  // Task management hook
  const {
    tasks,
    completedIds,
    carryOverTasks,
    toggleTask,
    addTask,
    removeTask,
    dismissCarryOver,
    isCompleted,
    stats
  } = useMissionControlTasks({
    userId: user?.id,
    orgId: organization?.id,
    aiTasks
  });

  // Performance data
  const performanceData = useMemo(() => {
    const now = new Date();

    // Days in current month
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const daysInMonth = endOfMonth.getDate();
    const dayOfMonth = now.getDate();

    // Days in current quarter
    const quarterMonth = Math.floor(now.getMonth() / 3) * 3;
    const startOfQuarter = new Date(now.getFullYear(), quarterMonth, 1);
    const endOfQuarter = new Date(now.getFullYear(), quarterMonth + 3, 0);
    const daysInQuarter = Math.floor((endOfQuarter - startOfQuarter) / (1000 * 60 * 60 * 24)) + 1;
    const dayOfQuarter = Math.floor((now - startOfQuarter) / (1000 * 60 * 60 * 24)) + 1;

    // Days in year
    const startOfYear = new Date(now.getFullYear(), 0, 1);
    const endOfYear = new Date(now.getFullYear(), 11, 31);
    const daysInYear = Math.floor((endOfYear - startOfYear) / (1000 * 60 * 60 * 24)) + 1;
    const dayOfYear = Math.floor((now - startOfYear) / (1000 * 60 * 60 * 24)) + 1;

    // Calculate revenue from won deals
    const wonDeals = deals.filter(d => d.status === 'won' || d.stage === 'closed_won');

    const revenueThisMonth = wonDeals
      .filter(d => {
        const closedAt = d.closed_at ? new Date(d.closed_at) : new Date(d.last_activity);
        return closedAt >= startOfMonth;
      })
      .reduce((sum, d) => sum + (parseFloat(d.value) || 0), 0);

    const revenueThisQuarter = wonDeals
      .filter(d => {
        const closedAt = d.closed_at ? new Date(d.closed_at) : new Date(d.last_activity);
        return closedAt >= startOfQuarter;
      })
      .reduce((sum, d) => sum + (parseFloat(d.value) || 0), 0);

    const revenueThisYear = wonDeals
      .filter(d => {
        const closedAt = d.closed_at ? new Date(d.closed_at) : new Date(d.last_activity);
        return closedAt >= startOfYear;
      })
      .reduce((sum, d) => sum + (parseFloat(d.value) || 0), 0);

    return {
      month: {
        current: revenueThisMonth,
        target: targets.monthlyTarget || 0,
        daysElapsed: dayOfMonth,
        totalDays: daysInMonth
      },
      quarter: {
        current: revenueThisQuarter,
        target: targets.quarterlyTarget || 0,
        daysElapsed: dayOfQuarter,
        totalDays: daysInQuarter
      },
      year: {
        current: revenueThisYear,
        target: targets.annualTarget || 0,
        daysElapsed: dayOfYear,
        totalDays: daysInYear
      }
    };
  }, [deals, targets]);

  // Handle add task
  const handleAddTask = useCallback(() => {
    if (newTaskInput.trim()) {
      addTask(newTaskInput.trim(), 'medium');
      setNewTaskInput('');
    }
  }, [newTaskInput, addTask]);

  // Handle key press for task input
  const handleTaskKeyPress = useCallback((e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddTask();
    }
  }, [handleAddTask]);

  // Check if targets are configured
  const hasTargets = targets.monthlyTarget || targets.quarterlyTarget || targets.annualTarget;

  // Auto-switch to Tasks tab when Plan My Day generates tasks
  useEffect(() => {
    if (tasks.length > 0 && activeTab === 'coach') {
      setActiveTab('tasks');
    }
  }, [tasks.length, activeTab]);

  return (
    <div className="bg-white/[0.03] backdrop-blur-xl border border-white/[0.08] rounded-2xl shadow-[0_8px_40px_rgba(0,0,0,0.25)] overflow-hidden">
      {/* Header */}
      <div className="px-6 py-5 bg-gradient-to-r from-[#0D1419] to-[#0A0F14] border-b border-white/[0.07]">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          {/* Title and description */}
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-[#0CE3B1]/25 to-[#0CE3B1]/5 border border-[#0CE3B1]/20 flex items-center justify-center shadow-[0_4px_20px_rgba(12,227,177,0.15)]">
              <Sparkles className="w-6 h-6 text-[#0CE3B1]" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white tracking-tight">
                StageFlow AI Mission Control
              </h2>
              <p className="text-sm text-white/50 mt-0.5">
                Your daily plan, performance pulse, and coaching in one place.
              </p>
            </div>
          </div>

          {/* Tab Navigation - Subtle segmented control */}
          {/* Tasks tab only appears after Plan My Day generates tasks */}
          <div className="flex items-center gap-0.5 bg-white/[0.02] rounded-lg p-0.5 border border-white/[0.05]" role="tablist">
            {TABS.filter(tab => {
              // Tasks tab only visible when there are tasks
              if (tab.conditionalOnTasks) return tasks.length > 0;
              return tab.visible !== false;
            }).map(tab => (
              <TabButton
                key={tab.id}
                tab={tab}
                isActive={activeTab === tab.id}
                onClick={() => setActiveTab(tab.id)}
              />
            ))}
          </div>
        </div>

      </div>

      {/* Tab Content - Expanded padding for larger AI window */}
      <div className="p-6 pt-8 pb-10">
        {/* TASKS TAB - Shows AI-generated tasks after Plan My Day */}
        {activeTab === 'tasks' && tasks.length > 0 && (
          <div className="space-y-5">
            {/* Progress header */}
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-semibold text-white">Today's Tasks</h3>
                <p className="text-xs text-white/50 mt-0.5">
                  {stats.completed} of {stats.total} completed ({stats.percentage}%)
                </p>
              </div>

              {/* Progress ring */}
              <div className="relative w-14 h-14">
                <svg className="w-14 h-14 transform -rotate-90">
                  <circle
                    cx="28" cy="28" r="22"
                    stroke="currentColor" strokeWidth="4" fill="transparent"
                    className="text-white/[0.06]"
                  />
                  <circle
                    cx="28" cy="28" r="22"
                    stroke="currentColor" strokeWidth="4" fill="transparent"
                    strokeDasharray={`${stats.percentage * 1.38} 138`}
                    strokeLinecap="round"
                    className="text-[#0CE3B1] transition-all duration-500 drop-shadow-[0_0_8px_rgba(12,227,177,0.5)]"
                  />
                </svg>
                <span className="absolute inset-0 flex items-center justify-center text-xs font-bold text-white">
                  {stats.percentage}%
                </span>
              </div>
            </div>

            {/* Carry-over tasks */}
            {carryOverTasks.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-amber-400 uppercase tracking-wider flex items-center gap-2">
                    <RefreshCw className="w-3.5 h-3.5" />
                    Carried Over ({carryOverTasks.length})
                  </span>
                  <button
                    onClick={dismissCarryOver}
                    className="text-xs text-white/40 hover:text-amber-400 transition-colors"
                  >
                    Dismiss all
                  </button>
                </div>
                {carryOverTasks.map(task => (
                  <TaskItem
                    key={task.id}
                    task={task}
                    isCompleted={isCompleted(task.id)}
                    onToggle={() => toggleTask(task.id)}
                  />
                ))}
              </div>
            )}

            {/* Main task list */}
            <div className="space-y-2">
              {tasks.filter(t => !t.isCarryOver).map(task => (
                <TaskItem
                  key={task.id}
                  task={task}
                  isCompleted={isCompleted(task.id)}
                  onToggle={() => toggleTask(task.id)}
                />
              ))}
            </div>
          </div>
        )}

        {/* COACH TAB - CustomQueryView with AI conversation */}
        {activeTab === 'coach' && (
          <CustomQueryView
            deals={deals}
            healthAlert={healthAlert}
            orphanedDealIds={orphanedDealIds}
            onDismissAlert={onDismissAlert}
          />
        )}

        {/* MISSION CONTROL TAB */}
        {activeTab === 'mission_control' && (
          <div className="space-y-5">
            {/* Progress header */}
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-semibold text-white">Task Checklist</h3>
                <p className="text-xs text-white/50 mt-0.5">
                  {stats.completed} of {stats.total} completed ({stats.percentage}%)
                </p>
              </div>

              {/* Progress ring */}
              <div className="relative w-14 h-14">
                <svg className="w-14 h-14 transform -rotate-90">
                  <circle
                    cx="28" cy="28" r="22"
                    stroke="currentColor" strokeWidth="4" fill="transparent"
                    className="text-white/[0.06]"
                  />
                  <circle
                    cx="28" cy="28" r="22"
                    stroke="currentColor" strokeWidth="4" fill="transparent"
                    strokeDasharray={`${stats.percentage * 1.38} 138`}
                    strokeLinecap="round"
                    className="text-[#0CE3B1] transition-all duration-500 drop-shadow-[0_0_8px_rgba(12,227,177,0.5)]"
                  />
                </svg>
                <span className="absolute inset-0 flex items-center justify-center text-xs font-bold text-white">
                  {stats.percentage}%
                </span>
              </div>
            </div>

            {/* Add task input */}
            <div className="flex gap-2">
              <input
                type="text"
                value={newTaskInput}
                onChange={(e) => setNewTaskInput(e.target.value)}
                onKeyDown={handleTaskKeyPress}
                placeholder="Add a task..."
                className="flex-1 px-4 py-2.5 bg-white/[0.03] border border-white/[0.1] rounded-xl text-sm text-white placeholder-white/40 focus:ring-2 focus:ring-[#0CE3B1]/50 focus:border-[#0CE3B1]/40 transition-all duration-300"
              />
              <button
                onClick={handleAddTask}
                disabled={!newTaskInput.trim()}
                className="px-4 py-2.5 bg-gradient-to-br from-[#0CE3B1] to-[#0CE3B1]/80 text-white rounded-xl font-medium text-sm hover:shadow-[0_4px_16px_rgba(12,227,177,0.3)] transition-all duration-300 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>

            {/* Carry-over tasks */}
            {carryOverTasks.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-amber-400 uppercase tracking-wider flex items-center gap-2">
                    <RefreshCw className="w-3.5 h-3.5" />
                    Carried Over ({carryOverTasks.length})
                  </span>
                  <button
                    onClick={dismissCarryOver}
                    className="text-xs text-white/40 hover:text-amber-400 transition-colors"
                  >
                    Dismiss all
                  </button>
                </div>
                {carryOverTasks.map(task => (
                  <TaskItem
                    key={task.id}
                    task={task}
                    isCompleted={isCompleted(task.id)}
                    onToggle={() => toggleTask(task.id)}
                  />
                ))}
              </div>
            )}

            {/* Main task list */}
            {tasks.filter(t => !t.isCarryOver).length > 0 ? (
              <div className="space-y-2">
                {tasks.filter(t => !t.isCarryOver).map(task => (
                  <TaskItem
                    key={task.id}
                    task={task}
                    isCompleted={isCompleted(task.id)}
                    onToggle={() => toggleTask(task.id)}
                  />
                ))}
              </div>
            ) : (
              <div className="text-center py-10 border border-dashed border-white/[0.1] rounded-2xl">
                <CheckSquare className="w-10 h-10 text-white/20 mx-auto mb-3" />
                <p className="text-sm text-white/40">
                  Run "Plan My Day" in the Today tab to generate your task list.
                </p>
                <p className="text-xs text-white/30 mt-2">
                  Or add tasks manually above.
                </p>
              </div>
            )}
          </div>
        )}

        {/* PERFORMANCE TAB */}
        {activeTab === 'performance' && (
          <div className="space-y-5">
            {hasTargets ? (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {performanceData.month.target > 0 && (
                  <PerformanceCard
                    title="This Month"
                    current={performanceData.month.current}
                    target={performanceData.month.target}
                    period="month"
                    daysElapsed={performanceData.month.daysElapsed}
                    totalDays={performanceData.month.totalDays}
                  />
                )}
                {performanceData.quarter.target > 0 && (
                  <PerformanceCard
                    title="This Quarter"
                    current={performanceData.quarter.current}
                    target={performanceData.quarter.target}
                    period="quarter"
                    daysElapsed={performanceData.quarter.daysElapsed}
                    totalDays={performanceData.quarter.totalDays}
                  />
                )}
                {performanceData.year.target > 0 && (
                  <PerformanceCard
                    title="Year-to-Date"
                    current={performanceData.year.current}
                    target={performanceData.year.target}
                    period="year"
                    daysElapsed={performanceData.year.daysElapsed}
                    totalDays={performanceData.year.totalDays}
                  />
                )}
              </div>
            ) : (
              <div className="bg-white/[0.03] backdrop-blur-md border border-white/[0.08] rounded-2xl p-8 text-center">
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#0CE3B1]/20 to-[#0CE3B1]/5 flex items-center justify-center mx-auto mb-4">
                  <Target className="w-7 h-7 text-[#0CE3B1]" />
                </div>
                <h3 className="text-lg font-semibold text-white mb-2">Performance View Coming Soon</h3>
                <p className="text-sm text-white/50 max-w-md mx-auto">
                  Set up your revenue targets in Settings to see your run-rate performance here.
                </p>
                {/* TODO (future): Link to settings page for target configuration */}
              </div>
            )}
          </div>
        )}

        {/* COACH TAB */}
        {activeTab === 'coach' && (
          <div className="space-y-5">
            <CoachCard
              headline={coachingData?.headline || null}
              signals={coachingData?.signals || []}
              suggestions={coachingData?.suggestions || []}
            />

            {/* Quick coaching tips (always shown) */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Clock className="w-4 h-4 text-blue-400" />
                  <h5 className="text-xs font-semibold text-white/70">Pipeline Velocity</h5>
                </div>
                <p className="text-xs text-white/50 leading-relaxed">
                  Deals moving faster through stages typically close at higher rates. Focus on deals that show momentum.
                </p>
              </div>
              <div className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-4">
                <div className="flex items-center gap-2 mb-2">
                  <DollarSign className="w-4 h-4 text-emerald-400" />
                  <h5 className="text-xs font-semibold text-white/70">High-Value Focus</h5>
                </div>
                <p className="text-xs text-white/50 leading-relaxed">
                  Deals over $10k that haven't been touched in 14+ days need attention. Don't let them go cold.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default MissionControlPanel;
