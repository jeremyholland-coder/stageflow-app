/**
 * AI Skeleton Loading Components
 *
 * Apple-Grade Engineering: Smooth loading states that match AI response layouts.
 * Never show empty/broken states - always show meaningful placeholders.
 *
 * @author StageFlow Engineering
 * @date 2025-12-09
 */

import React from 'react';

/**
 * Shimmer animation for skeleton elements
 */
const ShimmerOverlay = () => (
  <div className="absolute inset-0 -translate-x-full animate-[shimmer_2s_infinite] bg-gradient-to-r from-transparent via-white/20 to-transparent" />
);

/**
 * Base skeleton box with shimmer
 */
const SkeletonBox = ({ className = '', children }) => (
  <div className={`relative overflow-hidden rounded bg-gray-200 dark:bg-gray-700 ${className}`}>
    <ShimmerOverlay />
    {children}
  </div>
);

/**
 * Plan My Day skeleton - shows 3 action items placeholder
 */
export function PlanMyDaySkeleton() {
  return (
    <div className="space-y-4 p-4">
      {/* Header */}
      <div className="flex items-center space-x-3">
        <SkeletonBox className="h-8 w-8 rounded-full" />
        <SkeletonBox className="h-6 w-48" />
      </div>

      {/* Summary text */}
      <SkeletonBox className="h-4 w-full" />
      <SkeletonBox className="h-4 w-3/4" />

      {/* Action items */}
      <div className="mt-6 space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex items-start space-x-3 rounded-lg border border-gray-100 p-3 dark:border-gray-700">
            <SkeletonBox className="h-5 w-5 flex-shrink-0 rounded" />
            <div className="flex-1 space-y-2">
              <SkeletonBox className="h-4 w-full" />
              <SkeletonBox className="h-3 w-2/3" />
            </div>
            <SkeletonBox className="h-6 w-16 rounded-full" />
          </div>
        ))}
      </div>

      {/* Footer hint */}
      <div className="mt-4 flex items-center justify-center">
        <SkeletonBox className="h-3 w-32" />
      </div>
    </div>
  );
}

/**
 * Chat response skeleton - shows message placeholder
 */
export function ChatResponseSkeleton() {
  return (
    <div className="flex space-x-3 p-4">
      {/* Avatar */}
      <SkeletonBox className="h-8 w-8 flex-shrink-0 rounded-full" />

      {/* Message content */}
      <div className="flex-1 space-y-2">
        <SkeletonBox className="h-4 w-24" /> {/* Provider name */}
        <div className="space-y-2 rounded-lg bg-gray-50 p-3 dark:bg-gray-800">
          <SkeletonBox className="h-4 w-full" />
          <SkeletonBox className="h-4 w-full" />
          <SkeletonBox className="h-4 w-3/4" />
        </div>
      </div>
    </div>
  );
}

/**
 * Chart insight skeleton - shows chart area + insight text
 */
export function ChartInsightSkeleton() {
  return (
    <div className="space-y-4 p-4">
      {/* Chart placeholder */}
      <SkeletonBox className="h-48 w-full rounded-lg" />

      {/* Insight text */}
      <div className="space-y-2">
        <SkeletonBox className="h-5 w-48" /> {/* Heading */}
        <SkeletonBox className="h-4 w-full" />
        <SkeletonBox className="h-4 w-5/6" />
      </div>

      {/* Key metrics */}
      <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="space-y-1 text-center">
            <SkeletonBox className="mx-auto h-8 w-16" />
            <SkeletonBox className="mx-auto h-3 w-12" />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Inline loading indicator with progressive messages
 */
export function AILoadingIndicator({ startTime, className = '' }) {
  const [message, setMessage] = React.useState('Connecting to AI...');

  React.useEffect(() => {
    const elapsed = Date.now() - (startTime || Date.now());

    const updateMessage = () => {
      const now = Date.now();
      const elapsedMs = now - (startTime || now);

      if (elapsedMs > 15000) {
        setMessage('Taking longer than usual. Preparing backup plan...');
      } else if (elapsedMs > 8000) {
        setMessage('Almost there...');
      } else if (elapsedMs > 3000) {
        setMessage('Building your personalized insights...');
      } else {
        setMessage('Connecting to AI...');
      }
    };

    updateMessage();
    const interval = setInterval(updateMessage, 1000);
    return () => clearInterval(interval);
  }, [startTime]);

  return (
    <div className={`flex items-center space-x-2 text-sm text-gray-500 dark:text-gray-400 ${className}`}>
      {/* Animated dots */}
      <div className="flex space-x-1">
        <span className="animate-[bounce_1s_ease-in-out_infinite]" style={{ animationDelay: '0ms' }}>●</span>
        <span className="animate-[bounce_1s_ease-in-out_infinite]" style={{ animationDelay: '150ms' }}>●</span>
        <span className="animate-[bounce_1s_ease-in-out_infinite]" style={{ animationDelay: '300ms' }}>●</span>
      </div>
      <span>{message}</span>
    </div>
  );
}

/**
 * AI Status Badge - Only shows when AI is degraded
 */
export function AIStatusBadge({ status, className = '' }) {
  if (status === 'healthy' || !status) {
    return null; // Don't show anything when healthy (Apple-style)
  }

  const statusConfig = {
    degraded: {
      bg: 'bg-yellow-50 dark:bg-yellow-900/20',
      border: 'border-yellow-200 dark:border-yellow-800',
      text: 'text-yellow-700 dark:text-yellow-300',
      icon: '⚠️',
      message: 'AI is experiencing delays. Your request may take longer than usual.',
    },
    critical: {
      bg: 'bg-red-50 dark:bg-red-900/20',
      border: 'border-red-200 dark:border-red-800',
      text: 'text-red-700 dark:text-red-300',
      icon: '🔴',
      message: 'AI is temporarily unavailable. Showing your pipeline summary instead.',
    },
  };

  const config = statusConfig[status] || statusConfig.degraded;

  return (
    <div className={`flex items-center space-x-2 rounded-lg border px-3 py-2 text-sm ${config.bg} ${config.border} ${config.text} ${className}`}>
      <span>{config.icon}</span>
      <span>{config.message}</span>
    </div>
  );
}

/**
 * Full Mission Control skeleton (Plan My Day area)
 */
export function MissionControlSkeleton() {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-gray-800">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <SkeletonBox className="h-10 w-10 rounded-lg" />
          <div className="space-y-1">
            <SkeletonBox className="h-5 w-32" />
            <SkeletonBox className="h-3 w-24" />
          </div>
        </div>
        <SkeletonBox className="h-9 w-28 rounded-lg" />
      </div>

      {/* Content area */}
      <PlanMyDaySkeleton />
    </div>
  );
}

// Add shimmer keyframe to tailwind (add to your CSS or tailwind.config.js)
// @keyframes shimmer { 100% { transform: translateX(100%); } }

export default {
  PlanMyDaySkeleton,
  ChatResponseSkeleton,
  ChartInsightSkeleton,
  AILoadingIndicator,
  AIStatusBadge,
  MissionControlSkeleton,
};
