import React, { useState, useEffect } from 'react';
import { BarChart, TrendingUp, Clock, Users, CheckCircle, XCircle, Activity } from 'lucide-react';
import { analytics } from '../lib/onboardingAnalytics';
import { performanceMonitor } from '../lib/onboardingPerformance';

/**
 * OnboardingAnalyticsDashboard Component
 * Visualizes onboarding analytics and performance metrics
 * For admin/developer use to optimize the onboarding experience
 */
export const OnboardingAnalyticsDashboard = ({ isOpen, onClose }) => {
  const [summary, setSummary] = useState(null);
  const [performanceData, setPerformanceData] = useState(null);
  const [events, setEvents] = useState([]);

  useEffect(() => {
    if (!isOpen) return;

    // Fetch analytics data
    const analyticsData = analytics.getSummary();
    setSummary(analyticsData);

    // Fetch performance data
    const perfData = performanceMonitor.getSummary();
    setPerformanceData(perfData);

    // Get recent events
    const allEvents = analyticsData.allEvents || [];
    setEvents(allEvents.slice(-20).reverse()); // Last 20 events
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/80 z-[100] flex items-center justify-center p-4">
      <div className="bg-[#0D1F2D] border-2 border-[#1ABC9C]/30 rounded-2xl shadow-2xl w-full max-w-6xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="bg-gradient-to-r from-[#1ABC9C]/20 to-[#16A085]/20 border-b border-[#1ABC9C]/20 p-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <BarChart className="w-6 h-6 text-[#1ABC9C]" />
            <div>
              <h2 className="text-2xl font-bold text-white">Onboarding Analytics</h2>
              <p className="text-sm text-white/60">Performance metrics and user insights</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-white/10 rounded-lg transition-all text-white/70 hover:text-white"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Overview Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <MetricCard
              icon={Users}
              label="Total Sessions"
              value={summary?.totalSessions || 0}
              color="blue"
            />
            <MetricCard
              icon={CheckCircle}
              label="Completed"
              value={summary?.completed || 0}
              color="green"
              subtitle={`${summary?.completionRate?.toFixed(1) || 0}% rate`}
            />
            <MetricCard
              icon={XCircle}
              label="Dismissed"
              value={summary?.dismissed || 0}
              color="red"
            />
            <MetricCard
              icon={Clock}
              label="Avg Time"
              value={formatTime(summary?.avgCompletionTime || 0)}
              color="purple"
            />
          </div>

          {/* Performance Metrics */}
          {performanceData && (
            <div className="bg-[#0A0F14] border border-white/10 rounded-xl p-6">
              <div className="flex items-center gap-2 mb-4">
                <Activity className="w-5 h-5 text-[#F39C12]" />
                <h3 className="text-lg font-bold text-white">Performance Metrics</h3>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <PerformanceMetric
                  label="FPS"
                  value={performanceData.fps.average}
                  min={performanceData.fps.min}
                  max={performanceData.fps.max}
                  optimal={60}
                  unit=""
                />
                <PerformanceMetric
                  label="Interaction Latency"
                  value={performanceData.interactionLatency.average}
                  min={performanceData.interactionLatency.min}
                  max={performanceData.interactionLatency.max}
                  optimal={50}
                  unit="ms"
                />
                <PerformanceMetric
                  label="Render Time"
                  value={parseFloat(performanceData.renderTime.average)}
                  min={parseFloat(performanceData.renderTime.min)}
                  max={parseFloat(performanceData.renderTime.max)}
                  optimal={16}
                  unit="ms"
                />
              </div>
            </div>
          )}

          {/* Event Log */}
          <div className="bg-[#0A0F14] border border-white/10 rounded-xl p-6">
            <div className="flex items-center gap-2 mb-4">
              <TrendingUp className="w-5 h-5 text-[#1ABC9C]" />
              <h3 className="text-lg font-bold text-white">Recent Events</h3>
            </div>

            <div className="space-y-2 max-h-96 overflow-y-auto">
              {events.length > 0 ? (
                events.map((event, index) => (
                  <EventRow key={index} event={event} />
                ))
              ) : (
                <p className="text-white/50 text-center py-8">No events recorded yet</p>
              )}
            </div>
          </div>

          {/* Export Button */}
          <div className="flex justify-end gap-3">
            <button
              onClick={() => {
                analytics.clear();
                performanceMonitor.clear();
                alert('Analytics cleared');
                onClose();
              }}
              className="px-4 py-2 border border-white/20 text-white/70 rounded-lg hover:bg-white/10 transition-all"
            >
              Clear Data
            </button>
            <button
              onClick={() => {
                const data = analytics.exportMetrics();
                const blob = new Blob([data], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `onboarding-analytics-${Date.now()}.json`;
                a.click();
              }}
              className="px-4 py-2 bg-gradient-to-r from-[#1ABC9C] to-[#16A085] text-white rounded-lg hover:shadow-lg transition-all"
            >
              Export Data
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// Helper Components

const MetricCard = ({ icon: Icon, label, value, color, subtitle }) => {
  const colorClasses = {
    blue: 'text-[#3498DB]',
    green: 'text-[#27AE60]',
    red: 'text-[#E74C3C]',
    purple: 'text-[#9B59B6]'
  };

  return (
    <div className="bg-[#0A0F14] border border-white/10 rounded-xl p-4">
      <div className="flex items-center gap-3 mb-2">
        <Icon className={`w-5 h-5 ${colorClasses[color]}`} />
        <span className="text-sm text-white/60">{label}</span>
      </div>
      <div className="text-2xl font-bold text-white">{value}</div>
      {subtitle && <div className="text-xs text-white/50 mt-1">{subtitle}</div>}
    </div>
  );
};

const PerformanceMetric = ({ label, value, min, max, optimal, unit }) => {
  const isGood = unit === 'ms' ? value <= optimal : value >= optimal;

  return (
    <div className="bg-[#0D1F2D] border border-white/10 rounded-lg p-4">
      <div className="text-sm text-white/60 mb-2">{label}</div>
      <div className={`text-xl font-bold ${isGood ? 'text-[#27AE60]' : 'text-[#F39C12]'}`}>
        {value}{unit}
      </div>
      <div className="text-xs text-white/40 mt-1">
        Min: {min}{unit} • Max: {max}{unit}
      </div>
      <div className="mt-2 h-1 bg-white/10 rounded-full overflow-hidden">
        <div
          className={`h-full ${isGood ? 'bg-[#27AE60]' : 'bg-[#F39C12]'}`}
          style={{ width: unit === 'ms' ? `${Math.min((optimal / value) * 100, 100)}%` : `${Math.min((value / optimal) * 100, 100)}%` }}
        />
      </div>
    </div>
  );
};

const EventRow = ({ event }) => {
  const eventIcons = {
    step_viewed: '👁️',
    step_completed: '✅',
    navigation_clicked: '🔄',
    hint_shown: '💡',
    onboarding_dismissed: '❌',
    onboarding_completed: '🎉',
    onboarding_replayed: '🔁'
  };

  return (
    <div className="flex items-center gap-3 p-3 bg-[#0D1F2D] border border-white/5 rounded-lg hover:border-white/10 transition-all">
      <span className="text-lg">{eventIcons[event.eventName] || '📊'}</span>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-white">{formatEventName(event.eventName)}</div>
        <div className="text-xs text-white/50 truncate">
          {JSON.stringify(event.properties)}
        </div>
      </div>
      <div className="text-xs text-white/40">
        {formatTimestamp(event.timestamp)}
      </div>
    </div>
  );
};

// Helper Functions

function formatTime(ms) {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

function formatEventName(name) {
  return name
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function formatTimestamp(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleTimeString();
}
