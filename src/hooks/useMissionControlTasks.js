/**
 * useMissionControlTasks - Phase 1 localStorage-based task management
 *
 * Manages interactive task list for Mission Control panel.
 * Tasks persist via localStorage only (no DB changes in Phase 1).
 *
 * Features:
 * - Task completion tracking
 * - Manual task addition
 * - Daily auto-reset with carry-over
 * - Keyed by user ID + date
 *
 * @author StageFlow Engineering
 */

import { useState, useEffect, useCallback, useMemo } from 'react';

const STORAGE_KEY_PREFIX = 'stageflow_mission_control_tasks';

/**
 * Get storage key for user/org/date
 */
function getStorageKey(userId, orgId) {
  const dateKey = new Date().toDateString();
  return `${STORAGE_KEY_PREFIX}_${orgId || 'default'}_${userId || 'default'}_${dateKey}`;
}

/**
 * Get yesterday's storage key for carry-over
 */
function getYesterdayStorageKey(userId, orgId) {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const dateKey = yesterday.toDateString();
  return `${STORAGE_KEY_PREFIX}_${orgId || 'default'}_${userId || 'default'}_${dateKey}`;
}

/**
 * Load tasks from localStorage
 */
function loadTasks(storageKey) {
  try {
    const stored = localStorage.getItem(storageKey);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (err) {
    console.debug('[useMissionControlTasks] Error loading tasks:', err);
  }
  return null;
}

/**
 * Save tasks to localStorage
 */
function saveTasks(storageKey, data) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(data));
  } catch (err) {
    console.debug('[useMissionControlTasks] Error saving tasks:', err);
  }
}

/**
 * Generate unique task ID
 */
function generateTaskId() {
  return `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * useMissionControlTasks hook
 *
 * @param {Object} options
 * @param {string} options.userId - Current user ID
 * @param {string} options.orgId - Organization ID
 * @param {Array} options.aiTasks - Tasks from AI response (Plan My Day)
 * @returns {Object} Task management interface
 */
export function useMissionControlTasks({ userId, orgId, aiTasks = [] } = {}) {
  const storageKey = useMemo(() => getStorageKey(userId, orgId), [userId, orgId]);
  const yesterdayKey = useMemo(() => getYesterdayStorageKey(userId, orgId), [userId, orgId]);

  // State for tasks and completions
  const [tasks, setTasks] = useState([]);
  const [completedIds, setCompletedIds] = useState(new Set());
  const [carryOverTasks, setCarryOverTasks] = useState([]);
  const [manualTasks, setManualTasks] = useState([]);

  // Load tasks on mount and when key changes
  useEffect(() => {
    const stored = loadTasks(storageKey);

    if (stored) {
      setCompletedIds(new Set(stored.completedIds || []));
      setManualTasks(stored.manualTasks || []);
    } else {
      // Fresh day - check for carry-over tasks from yesterday
      const yesterdayData = loadTasks(yesterdayKey);
      if (yesterdayData) {
        const allYesterdayTasks = [
          ...(yesterdayData.aiTasks || []),
          ...(yesterdayData.manualTasks || [])
        ];
        const completedYesterday = new Set(yesterdayData.completedIds || []);

        // Get incomplete tasks from yesterday
        const incomplete = allYesterdayTasks.filter(
          task => !completedYesterday.has(task.id)
        ).map(task => ({
          ...task,
          isCarryOver: true,
          originalDate: yesterdayData.date || 'yesterday'
        }));

        if (incomplete.length > 0) {
          setCarryOverTasks(incomplete);
        }
      }

      // Reset for new day
      setCompletedIds(new Set());
      setManualTasks([]);
    }
  }, [storageKey, yesterdayKey]);

  // Merge AI tasks with manual tasks and carry-overs
  useEffect(() => {
    const allTasks = [
      ...carryOverTasks,
      ...aiTasks.map(task => ({
        ...task,
        id: task.id || generateTaskId(),
        source: 'ai'
      })),
      ...manualTasks
    ];
    setTasks(allTasks);
  }, [aiTasks, manualTasks, carryOverTasks]);

  // Persist to localStorage when state changes
  useEffect(() => {
    const data = {
      date: new Date().toDateString(),
      aiTasks: aiTasks.map(t => ({ ...t, id: t.id || generateTaskId() })),
      manualTasks,
      completedIds: Array.from(completedIds),
      updatedAt: Date.now()
    };
    saveTasks(storageKey, data);
  }, [aiTasks, manualTasks, completedIds, storageKey]);

  // Toggle task completion
  const toggleTask = useCallback((taskId) => {
    setCompletedIds(prev => {
      const next = new Set(prev);
      if (next.has(taskId)) {
        next.delete(taskId);
      } else {
        next.add(taskId);
      }
      return next;
    });
  }, []);

  // Add manual task
  const addTask = useCallback((label, priority = 'medium') => {
    if (!label || typeof label !== 'string' || !label.trim()) {
      return null;
    }

    const newTask = {
      id: generateTaskId(),
      label: label.trim(),
      priority,
      source: 'manual',
      createdAt: Date.now()
    };

    setManualTasks(prev => [...prev, newTask]);
    return newTask;
  }, []);

  // Remove manual task
  const removeTask = useCallback((taskId) => {
    setManualTasks(prev => prev.filter(t => t.id !== taskId));
    setCompletedIds(prev => {
      const next = new Set(prev);
      next.delete(taskId);
      return next;
    });
  }, []);

  // Dismiss all carry-over tasks
  const dismissCarryOver = useCallback(() => {
    setCarryOverTasks([]);
  }, []);

  // Clear all tasks (for new plan)
  const clearTasks = useCallback(() => {
    setTasks([]);
    setCompletedIds(new Set());
    setManualTasks([]);
    setCarryOverTasks([]);
    localStorage.removeItem(storageKey);
  }, [storageKey]);

  // Calculate completion stats
  const stats = useMemo(() => {
    const total = tasks.length;
    const completed = tasks.filter(t => completedIds.has(t.id)).length;
    const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;

    const byPriority = {
      high: tasks.filter(t => t.priority === 'high'),
      medium: tasks.filter(t => t.priority === 'medium'),
      low: tasks.filter(t => t.priority === 'low')
    };

    return {
      total,
      completed,
      remaining: total - completed,
      percentage,
      byPriority
    };
  }, [tasks, completedIds]);

  return {
    // Task data
    tasks,
    completedIds,
    carryOverTasks,

    // Actions
    toggleTask,
    addTask,
    removeTask,
    dismissCarryOver,
    clearTasks,

    // Helpers
    isCompleted: (taskId) => completedIds.has(taskId),
    stats
  };
}

export default useMissionControlTasks;
